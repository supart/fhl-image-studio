// Package backend exposes the GUI-facing bindings for the Wails app.
// All gptcodex-specific logic lives in github.com/yuanhua/image-gptcodex/pkg/client;
// this package only wires it into Wails (context, events, file dialogs).
//
// File layout:
//
//	service.go   — Service struct, lifecycle, generation orchestration (Generate / Edit / Cancel)
//	types.go     — JSON-bound structs shared with the TS frontend
//	dialogs.go   — file picker / save / open URL / read image / import-export history
//	imports.go   — drag-drop / paste import + filename sanitisation
//	imageops.go  — rotate / flip / crop on disk via Go image stdlib
//	paths.go     — output / import dir resolution + filename helpers
//	open.go      — cross-platform "open in OS" shell-out
package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const finalImageRequiredMessage = "上游只返回了中间预览图，没有返回完整 final 图。已保留日志，请重试或降低分辨率/质量。"

// Service is the Wails-bound struct. Methods on it are exposed to the frontend
// via runtime/window/bindings.
type Service struct {
	ctx context.Context

	mu                 sync.Mutex
	lifecycleCtx       context.Context
	lifecycleCancel    context.CancelFunc
	operationCount     int
	operationsDone     chan struct{}
	operationsDoneOnce sync.Once
	shuttingDown       bool
	jobManager         *jobManager
	jobRunner          JobRunner
	mediaSlots         chan struct{}
	outputDir          string // 用户自定义输出目录;空时回退到 defaultOutputDir()
	apiKeys            apiKeyStore
	automationStatus   AutomationStatus
	psBridge           *PSBridge

	trustedOutputRoots map[string]struct{}
	mediaAssets        map[string]mediaAsset
	eventSink          EventSink
}

// EventSink mirrors Wails runtime events for tests and the desktop E2E bridge.
type EventSink func(eventName string, args ...any)

// JobRunner makes the upstream execution path replaceable in lifecycle tests.
// Production uses serviceJobRunner, which delegates to the existing client.
type JobRunner interface {
	Run(ctx context.Context, jobID string, opts GenerateOptions) error
}

type serviceJobRunner struct {
	service *Service
}

func (r serviceJobRunner) Run(ctx context.Context, jobID string, opts GenerateOptions) error {
	return r.service.executeJob(ctx, jobID, opts)
}

// NewService constructs a fresh Service ready to be passed to wails.Run Bind.
func NewService() *Service {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	s := &Service{
		lifecycleCtx:       lifecycleCtx,
		lifecycleCancel:    lifecycleCancel,
		operationsDone:     make(chan struct{}),
		jobManager:         newJobManager(maxConcurrentNetworkJobs),
		mediaSlots:         make(chan struct{}, maxConcurrentMediaEncodes),
		apiKeys:            keyringAPIKeyStore{},
		trustedOutputRoots: map[string]struct{}{},
		mediaAssets:        map[string]mediaAsset{},
	}
	s.jobRunner = serviceJobRunner{service: s}
	s.psBridge = NewPSBridge(s)
	return s
}

func (s *Service) SetEventSink(sink EventSink) {
	s.mu.Lock()
	s.eventSink = sink
	s.mu.Unlock()
}

func (s *Service) emit(eventName string, args ...any) {
	s.mu.Lock()
	ctx := s.ctx
	sink := s.eventSink
	bridge := s.psBridge
	e2eOnly := s.automationStatus.E2EOnly
	s.mu.Unlock()
	if ctx != nil && !e2eOnly {
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					s.appendRuntimeLog("runtime.EventsEmit panic event=%s panic=%v\n%s", eventName, recovered, debug.Stack())
				}
			}()
			runtime.EventsEmit(ctx, eventName, args...)
		}()
	}
	if sink != nil {
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					s.appendRuntimeLog("event sink panic event=%s panic=%v\n%s", eventName, recovered, debug.Stack())
				}
			}()
			sink(eventName, args...)
		}()
	}
	if bridge != nil {
		bridge.ObserveServiceEvent(eventName, args...)
	}
}

func (s *Service) appendRuntimeLog(format string, args ...any) {
	if s.isE2EOnly() {
		return
	}
	root, err := defaultOutputDir()
	if err != nil || strings.TrimSpace(root) == "" {
		root = filepath.Join(".", "output")
	}
	dir := logSubdir(root)
	if err := os.MkdirAll(dir, secureDirMode); err != nil {
		return
	}
	line := time.Now().Format(time.RFC3339) + " " + fmt.Sprintf(format, args...)
	if !strings.HasSuffix(line, "\n") {
		line += "\n"
	}
	f, err := os.OpenFile(filepath.Join(dir, "e2e-runtime.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, secureFileMode)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(line)
}

func (s *Service) isE2EOnly() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.automationStatus.E2EOnly
}

// Startup is wired into wails.Options OnStartup; persists the runtime context.
func (s *Service) Startup(ctx context.Context) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(ctx)
	s.mu.Lock()
	previousCancel := s.lifecycleCancel
	s.ctx = ctx
	s.lifecycleCtx = lifecycleCtx
	s.lifecycleCancel = lifecycleCancel
	s.shuttingDown = false
	s.mu.Unlock()
	if previousCancel != nil {
		previousCancel()
	}
}

// Shutdown cancels all accepted work and waits for workers for a bounded time.
func (s *Service) Shutdown(_ context.Context) {
	s.StopPSBridge()
	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return
	}
	s.shuttingDown = true
	cancelLifecycle := s.lifecycleCancel
	noOperations := s.operationCount == 0
	s.mu.Unlock()
	if noOperations {
		s.operationsDoneOnce.Do(func() { close(s.operationsDone) })
	}
	timer := time.NewTimer(jobShutdownTimeout)
	defer timer.Stop()
	s.jobManager.beginShutdown()
	if cancelLifecycle != nil {
		cancelLifecycle()
	}

	workersDone, cancellationsDone := s.jobManager.shutdownSignals()
	operationsDone := s.operationsDone

	workersSettled := false
	cancellationsSettled := false
	operationsSettled := false
	for !workersSettled || !cancellationsSettled || !operationsSettled {
		select {
		case <-workersDone:
			workersSettled = true
			workersDone = nil
		case <-cancellationsDone:
			cancellationsSettled = true
			cancellationsDone = nil
		case <-operationsDone:
			operationsSettled = true
			operationsDone = nil
		case <-timer.C:
			s.appendRuntimeLog("service shutdown timed out after %s", jobShutdownTimeout)
			return
		}
	}
}

func (s *Service) beginOperation(requireStartup bool) (context.Context, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if requireStartup && s.ctx == nil {
		return nil, nil, errors.New("服务未启动")
	}
	if s.shuttingDown || s.lifecycleCtx == nil {
		return nil, nil, errors.New("服务正在关闭")
	}
	s.operationCount++
	var finishOnce sync.Once
	return s.lifecycleCtx, func() { finishOnce.Do(s.finishOperation) }, nil
}

func (s *Service) finishOperation() {
	s.mu.Lock()
	if s.operationCount > 0 {
		s.operationCount--
	}
	finished := s.shuttingDown && s.operationCount == 0
	s.mu.Unlock()
	if finished {
		s.operationsDoneOnce.Do(func() { close(s.operationsDone) })
	}
}

func (s *Service) acquireMediaSlot(ctx context.Context) (func(), error) {
	select {
	case s.mediaSlots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-s.mediaSlots
			return nil, err
		}
		return func() { <-s.mediaSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Service) withMediaSlot(ctx context.Context, work func() error) error {
	release, err := s.acquireMediaSlot(ctx)
	if err != nil {
		return err
	}
	defer release()
	return work()
}

// resolvedOutputDir 返回当前生效的输出目录:用户自定义优先,否则默认。
// 不存在则尝试创建。
func (s *Service) resolvedOutputDir() (string, error) {
	s.mu.Lock()
	custom := s.outputDir
	s.mu.Unlock()
	if custom != "" {
		if err := os.MkdirAll(custom, secureDirMode); err != nil {
			return "", fmt.Errorf("无法创建输出目录 %s: %w", custom, err)
		}
		return custom, nil
	}
	return defaultOutputDir()
}

// SetOutputDir 由前端调用以应用用户选择的输出目录。空串表示恢复默认。
// 路径会被 MkdirAll 兜底创建;创建失败则不接受。
func (s *Service) SetOutputDir(path string) error {
	if strings.TrimSpace(path) == "" {
		s.mu.Lock()
		s.outputDir = ""
		s.mu.Unlock()
		return nil
	}
	clean, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("路径无效:%w", err)
	}
	if err := os.MkdirAll(clean, secureDirMode); err != nil {
		return fmt.Errorf("无法创建输出目录 %s: %w", clean, err)
	}
	s.mu.Lock()
	s.outputDir = clean
	s.mu.Unlock()
	return nil
}

// ChooseOutputDir 弹出系统目录选择对话框,选中后立刻应用并返回新路径。
// 用户取消时返回空串(不报错)。
func (s *Service) ChooseOutputDir() (string, error) {
	if s.ctx == nil {
		return "", errors.New("服务未启动")
	}
	chosen, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择生成图片的保存目录",
	})
	if err != nil {
		return "", err
	}
	if chosen == "" {
		return "", nil // 用户取消
	}
	if err := s.SetOutputDir(chosen); err != nil {
		return "", err
	}
	return chosen, nil
}

func (s *Service) ChooseBatchOutputDir() (string, error) {
	if s.ctx == nil {
		return "", errors.New("服务未启动")
	}
	chosen, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择批处理输出目录",
	})
	if err != nil || chosen == "" {
		return "", err
	}
	abs, err := filepath.Abs(chosen)
	if err != nil {
		return "", err
	}
	s.addTrustedOutputRoot(abs)
	return abs, nil
}

func (s *Service) BuildBatchOutputPath(sourcePath, outputDir, prefix string) (string, error) {
	cleanSource := strings.TrimSpace(sourcePath)
	if cleanSource == "" {
		return "", errors.New("源文件不能为空")
	}
	targetRoot := strings.TrimSpace(outputDir)
	if targetRoot == "" {
		targetRoot = filepath.Dir(cleanSource)
	}
	root, err := s.ensureManagedWritableDirectory(targetRoot)
	if err != nil {
		return "", err
	}
	return uniquePrefixedTargetPath(root, filepath.Base(cleanSource), prefix)
}

// --- Generation entry points -----------------------------------------------

// Generate starts a text-to-image job and returns its ID immediately. Progress
// and final result arrive as Wails events.
func (s *Service) Generate(opts GenerateOptions) (JobStarted, error) {
	opts.Mode = "generate"
	return s.startJob(opts)
}

// Edit starts an image-to-image job. opts.ImagePaths must list one or more
// existing local files (the frontend writes imports/generated PNGs to disk
// so we never push raw base64 across the JSON bridge for large files).
func (s *Service) Edit(opts GenerateOptions) (JobStarted, error) {
	opts.Mode = "edit"
	if len(opts.collectPaths()) == 0 {
		return JobStarted{}, errors.New("edit 模式必须提供至少一张源图片")
	}
	return s.startJob(opts)
}

// OptimizePrompt uses the configured LLM to rewrite the current prompt into a
// cleaner image prompt. If edit source images are provided, they are included
// as visual context. The original prompt is not mutated by the backend.
func (s *Service) OptimizePrompt(opts PromptOptimizeOptions) (string, error) {
	parent, finishOperation, err := s.beginOperation(true)
	if err != nil {
		return "", err
	}
	defer finishOperation()
	if strings.TrimSpace(opts.APIKey) == "" {
		return "", errors.New("API Key 不能为空")
	}
	if strings.TrimSpace(opts.Prompt) == "" {
		return "", errors.New("提示词不能为空")
	}
	baseURL, err := client.ValidateBaseURL(opts.BaseURL)
	if err != nil {
		return "", err
	}
	var refPaths []string
	var cleanup func()
	err = s.withMediaSlot(parent, func() error {
		var prepErr error
		refPaths, _, cleanup, prepErr = prepareTextModelUploadSourcePaths(opts.collectPaths(), "optimize")
		return prepErr
	})
	if err != nil {
		return "", err
	}
	defer cleanup()
	modelID := strings.TrimSpace(opts.TextModelID)
	if modelID == "" {
		modelID = client.TextModel
	}
	proxyConfig, err := client.NormalizeProxyConfig(opts.ProxyMode, opts.ProxyURL)
	if err != nil {
		return "", err
	}
	releaseNetwork, err := s.jobManager.acquireNetwork(parent)
	if err != nil {
		return "", err
	}
	defer releaseNetwork()
	return optimizePromptWithLLM(parent, baseURL, opts.APIKey, modelID, opts.Mode, opts.Prompt, opts.OptimizationGuidance, refPaths, proxyConfig)
}

// ReversePrompt asks the configured text model to describe an image as a
// text-to-image prompt. It returns text only and does not generate an image.
func (s *Service) ReversePrompt(opts PromptReverseOptions) (string, error) {
	parent, finishOperation, err := s.beginOperation(true)
	if err != nil {
		return "", err
	}
	defer finishOperation()
	if strings.TrimSpace(opts.APIKey) == "" {
		return "", errors.New("API Key 不能为空")
	}
	baseURL, err := client.ValidateBaseURL(opts.BaseURL)
	if err != nil {
		return "", err
	}
	var refPaths []string
	var cleanup func()
	err = s.withMediaSlot(parent, func() error {
		var prepErr error
		refPaths, _, cleanup, prepErr = prepareTextModelUploadSourcePaths(opts.collectPaths(), "reverse")
		return prepErr
	})
	if err != nil {
		return "", err
	}
	defer cleanup()
	if len(refPaths) == 0 {
		return "", errors.New("先选择或生成一张图片")
	}
	modelID := strings.TrimSpace(opts.TextModelID)
	if modelID == "" {
		modelID = client.TextModel
	}
	proxyConfig, err := client.NormalizeProxyConfig(opts.ProxyMode, opts.ProxyURL)
	if err != nil {
		return "", err
	}
	releaseNetwork, err := s.jobManager.acquireNetwork(parent)
	if err != nil {
		return "", err
	}
	defer releaseNetwork()
	return reversePromptWithLLM(parent, baseURL, opts.APIKey, modelID, refPaths, proxyConfig)
}

// Cancel terminates a running job. Safe to call with unknown IDs.
func (s *Service) Cancel(jobID string) error {
	s.jobManager.cancel(jobID)
	return nil
}

// emitJobEventUnlessCancelled gates every job event and attaches monotonic
// lifecycle metadata. The per-job lock makes cancellation and delivery
// linearizable without blocking unrelated jobs.
func (s *Service) emitJobEventUnlessCancelled(jobID, eventName string, payload any) bool {
	nextState := jobLifecycleState("")
	if strings.HasPrefix(eventName, "result:") {
		nextState = jobStateSucceeded
	} else if strings.HasPrefix(eventName, "error:") {
		nextState = jobStateFailed
	}
	return s.jobManager.emit(jobID, nextState, func(meta JobEventMeta) {
		s.emit(eventName, payload, meta)
	})
}

// collectPaths merges legacy ImagePath into ImagePaths and drops blanks.
func (o GenerateOptions) collectPaths() []string {
	paths := make([]string, 0, len(o.ImagePaths)+1)
	for _, p := range o.ImagePaths {
		if strings.TrimSpace(p) != "" {
			paths = append(paths, p)
		}
	}
	if strings.TrimSpace(o.ImagePath) != "" {
		paths = append(paths, o.ImagePath)
	}
	return paths
}

// --- Internal job lifecycle ------------------------------------------------

func (s *Service) startJob(opts GenerateOptions) (JobStarted, error) {
	if strings.TrimSpace(opts.APIKey) == "" {
		return JobStarted{}, errors.New("API Key 不能为空")
	}
	if strings.TrimSpace(opts.Prompt) == "" {
		return JobStarted{}, errors.New("提示词/修改要求不能为空")
	}
	apiMode := normaliseAPIMode(opts.APIMode)
	concurrencyKey := concurrencyBucketKey(apiMode, opts.APIProfileID)
	limit := normaliseConcurrencyLimit(opts.ConcurrencyLimit)
	parent, finishOperation, err := s.beginOperation(true)
	if err != nil {
		return JobStarted{}, err
	}
	defer finishOperation()

	jobID := strings.TrimSpace(opts.RequestedJobID)
	if jobID == "" {
		var err error
		jobID, err = newJobID()
		if err != nil {
			return JobStarted{}, err
		}
	}
	opts.APIMode = apiMode
	opts.APIProfileID = strings.TrimSpace(opts.APIProfileID)
	opts.ConcurrencyLimit = limit
	opts.RequestedJobID = jobID
	opts.ImagePaths = opts.collectPaths()
	opts.ImagePath = ""
	j, err := s.jobManager.accept(parent, jobID, concurrencyKey, limit, opts)
	if errors.Is(err, errConcurrencyLimitReached) {
		return JobStarted{}, fmt.Errorf("%s 已达到并发限制 %d,请等待当前任务完成后再提交", apiModeLabel(apiMode), limit)
	}
	if errors.Is(err, errJobIDExists) {
		return JobStarted{}, errors.New("job id 已存在,请稍后重试")
	}
	if errors.Is(err, errJobManagerClosed) {
		return JobStarted{}, errors.New("服务正在关闭")
	}
	if err != nil {
		return JobStarted{}, err
	}

	go s.runManagedJob(j)

	return JobStarted{JobID: jobID}, nil
}

func (s *Service) canStartJobLocked(concurrencyKey string, limit int) bool {
	return s.jobManager.canStart(concurrencyKey, limit)
}

func (s *Service) runManagedJob(j *managedJob) {
	var runErr error
	defer func() {
		if recovered := recover(); recovered != nil {
			s.appendRuntimeLog("runJob panic job=%s panic=%v\n%s", j.id, recovered, debug.Stack())
			runErr = fmt.Errorf("生成任务异常退出: %v", recovered)
		}
		if runErr != nil && !errors.Is(runErr, errJobManagerClosed) &&
			!(j.ctx.Err() != nil && errors.Is(runErr, j.ctx.Err())) {
			var executionErr *jobExecutionError
			if errors.As(runErr, &executionErr) {
				s.emitErrorWithRaw(j.id, executionErr.err, executionErr.rawPath)
			} else {
				s.emitError(j.id, runErr)
			}
		}
		s.jobManager.complete(j, runErr)
		s.jobManager.settle(j, func(meta JobEventMeta) {
			s.emit("settled:"+j.id, nil, meta)
		})
	}()

	releaseNetwork, err := s.jobManager.acquireNetwork(j.ctx)
	if err != nil {
		runErr = err
		return
	}
	defer releaseNetwork()
	if !s.jobManager.markRunning(j) {
		runErr = j.ctx.Err()
		if runErr == nil {
			runErr = context.Canceled
		}
		return
	}
	runErr = s.jobRunner.Run(j.ctx, j.id, cloneGenerateOptions(j.options))
}

type jobExecutionError struct {
	err     error
	rawPath string
}

func (e *jobExecutionError) Error() string { return e.err.Error() }
func (e *jobExecutionError) Unwrap() error { return e.err }

func executionErrorWithRaw(err error, rawPath string) error {
	return &jobExecutionError{err: err, rawPath: rawPath}
}

func (s *Service) executeJob(ctx context.Context, jobID string, opts GenerateOptions) error {

	mode := client.ModeGenerate
	if opts.Mode == "edit" {
		mode = client.ModeEdit
	}
	if s.isE2EOnly() {
		s.appendRuntimeLog("job start job=%s mode=%s apiMode=%s images=%d", jobID, mode, opts.APIMode, len(opts.collectPaths()))
	}

	apiMode := client.APIMode(opts.APIMode)
	if apiMode == "" {
		apiMode = client.APIModeResponses
	}

	clientOpts := client.Options{
		APIKey:             opts.APIKey,
		Prompt:             opts.Prompt,
		Mode:               mode,
		Size:               opts.Size,
		Quality:            opts.Quality,
		OutputFormat:       opts.OutputFormat,
		MaskB64:            opts.MaskB64,
		Seed:               opts.Seed,
		NegativePrompt:     opts.NegativePrompt,
		BaseURL:            opts.BaseURL,
		TextModelID:        opts.TextModelID,
		ImageModelID:       opts.ImageModelID,
		Proxy:              client.ProxyConfig{Mode: opts.ProxyMode, URL: opts.ProxyURL},
		APIMode:            apiMode,
		RequestPolicy:      client.RequestPolicy(strings.TrimSpace(opts.RequestPolicy)),
		ImagesNewAPICompat: opts.ImagesNewAPICompat,
		NoPromptRevision:   opts.NoPromptRevision,
		PartialImages:      opts.PartialImages,
	}
	if mode == client.ModeEdit {
		var paths []string
		var cleanup func()
		prepErr := s.withMediaSlot(ctx, func() error {
			var err error
			paths, cleanup, err = prepareUploadSourcePaths(opts.collectPaths())
			return err
		})
		if prepErr != nil {
			return prepErr
		}
		defer cleanup()
		clientOpts.ImagePaths = paths
		// Responses API 仍需 data URL(走 input_image 形态);
		// Images API 直接 multipart 上传文件,跳过 base64 编码节省往返开销。
		if apiMode == client.APIModeResponses {
			urls := make([]string, 0, len(paths))
			for _, p := range paths {
				dataURL, err := client.ImageFileToDataURL(p)
				if err != nil {
					return fmt.Errorf("加载源图片 %s 失败:%w", filepath.Base(p), err)
				}
				urls = append(urls, dataURL)
			}
			clientOpts.ImageDataURLs = urls
		}
	}

	transport, err := client.PickTransportWithProxy(clientOpts.Proxy)
	if err != nil {
		return err
	}

	rootDir, err := s.resolvedOutputDir()
	if err != nil {
		return err
	}
	// 拆 PNG 和 raw response 到两个子目录,避免单目录文件混杂。
	imagesDir := imagesSubdir(rootDir)
	thumbsDir := thumbsSubdir(rootDir)
	previewsDir := previewsSubdir(rootDir)
	logDir := logSubdir(rootDir)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		return err
	}
	if err := os.MkdirAll(thumbsDir, secureDirMode); err != nil {
		return err
	}
	if err := os.MkdirAll(previewsDir, secureDirMode); err != nil {
		return err
	}
	if err := os.MkdirAll(logDir, secureDirMode); err != nil {
		return err
	}

	// ★ 文件名时间戳精度只到秒,9 并发 batch 同一秒触发 → 9 个 savedPath 完全
	// 一样,os.WriteFile 互相覆盖,前 8 张图被最后一个 job 写的覆盖掉,前端拿
	// HistoryItem.savedPath 去磁盘读永远是同一张图。塞 6 字符 jobID 后缀让 PNG
	// 和 sse-response/images-response 日志文件都唯一。
	timestamp := time.Now().Format("20060102-150405")
	if len(jobID) >= 6 {
		timestamp = timestamp + "-" + jobID[:6]
	}
	logFn := func(msg string) {
		s.emitJobEventUnlessCancelled(jobID, "log:"+jobID, msg)
	}
	progressFn := func(stage string, elapsed int, bytes int64) {
		s.emitJobEventUnlessCancelled(jobID, "progress:"+jobID, ProgressPayload{
			Stage: stage, Elapsed: elapsed, Bytes: bytes,
		})
	}
	previewFn := func(partial client.PartialImage) {
		payload := PreviewPayload{
			RevisedPrompt:     partial.RevisedPrompt,
			PartialImageIndex: partial.PartialImageIndex,
			Mode:              string(mode),
			Prompt:            opts.Prompt,
		}
		if strings.TrimSpace(partial.ImageB64) == "" {
			return
		}
		previewName := fmt.Sprintf("preview-%s-%03d-%d.avif", timestamp, partial.PartialImageIndex, time.Now().UnixNano())
		previewPath := filepath.Join(previewsDir, previewName)
		var previewW, previewH int
		previewErr := s.withMediaSlot(ctx, func() error {
			var err error
			previewW, previewH, err = createAVIFThumbnailFromBase64(partial.ImageB64, previewPath, mediaPreviewMaxEdge)
			return err
		})
		if previewErr != nil {
			logFn(fmt.Sprintf("生成中间预览 AVIF 失败:%v", previewErr))
			return
		}
		asset, mediaErr := s.registerPreviewMedia(previewPath, previewW, previewH)
		if mediaErr != nil {
			logFn(fmt.Sprintf("登记中间预览失败:%v", mediaErr))
			return
		}
		payload.ImageID = asset.ID
		payload.PreviewURL = asset.PreviewURL
		payload.PreviewWidth = asset.PreviewWidth
		payload.PreviewHeight = asset.PreviewHeight
		s.emitJobEventUnlessCancelled(jobID, "preview:"+jobID, PreviewPayload{
			ImageID:           payload.ImageID,
			PreviewURL:        payload.PreviewURL,
			PreviewWidth:      payload.PreviewWidth,
			PreviewHeight:     payload.PreviewHeight,
			RevisedPrompt:     payload.RevisedPrompt,
			PartialImageIndex: payload.PartialImageIndex,
			Mode:              payload.Mode,
			Prompt:            payload.Prompt,
		})
	}

	// raw response(SSE 文本 / Images API JSON)落到 log 子目录;PNG 落到 images 子目录。
	result, rawPath, err := client.RequestAndExtractWithRetriesAndPartial(
		ctx, transport, clientOpts, logDir, timestamp, logFn, progressFn, previewFn,
	)
	if err != nil && shouldFallbackResponsesToImagesInService(apiMode, mode, err, rawPath, opts.APIProfileID) {
		logFn("Responses returned no final image; retrying once with Images API...")
		fallbackOpts := clientOpts
		fallbackOpts.APIMode = client.APIModeImages
		fallbackOpts.ImageDataURLs = nil
		fallbackTimestamp := timestamp + "-images-fallback"
		result, rawPath, err = client.RequestAndExtractWithRetriesAndPartial(
			ctx, transport, fallbackOpts, logDir, fallbackTimestamp, logFn, progressFn, previewFn,
		)
	}
	if err != nil {
		// 即使失败也把 rawPath 透给前端,「查看日志」按钮直接打开它。
		return executionErrorWithRaw(err, rawPath)
	}

	if result.SourceEvent == "partial" {
		return executionErrorWithRaw(errors.New(finalImageRequiredMessage), rawPath)
	}

	imageName := buildImageName(mode, opts.Prompt, timestamp, opts.OutputFormat)
	savedPath := filepath.Join(imagesDir, imageName)
	absSaved, werr := writeBase64Image(result.ImageB64, savedPath)
	if werr != nil {
		return executionErrorWithRaw(fmt.Errorf("保存结果图片失败:%w", werr), rawPath)
	}
	savedPath = absSaved
	thumbName := strings.TrimSuffix(filepath.Base(imageName), filepath.Ext(imageName)) + ".avif"
	thumbPath := filepath.Join(thumbsDir, thumbName)
	var thumbW, thumbH int
	thumbErr := s.withMediaSlot(ctx, func() error {
		var err error
		thumbW, thumbH, err = createAVIFThumbnail(savedPath, thumbPath, mediaThumbMaxEdge)
		return err
	})
	if thumbErr != nil {
		return executionErrorWithRaw(fmt.Errorf("生成 AVIF 缩略图失败:%w", thumbErr), rawPath)
	}
	asset, mediaErr := s.registerGeneratedMedia(savedPath, thumbPath, thumbW, thumbH)
	if mediaErr != nil {
		return executionErrorWithRaw(fmt.Errorf("登记本地图片失败:%w", mediaErr), rawPath)
	}
	absRaw, _ := filepath.Abs(rawPath)

	s.emitJobEventUnlessCancelled(jobID, "result:"+jobID, ResultPayload{
		RevisedPrompt: result.RevisedPrompt,
		SourceEvent:   result.SourceEvent,
		ImageID:       asset.ID,
		SavedPath:     savedPath,
		ThumbPath:     asset.ThumbPath,
		PreviewURL:    asset.PreviewURL,
		FullURL:       asset.FullURL,
		Width:         asset.Width,
		Height:        asset.Height,
		PreviewWidth:  asset.PreviewWidth,
		PreviewHeight: asset.PreviewHeight,
		RawPath:       absRaw,
		Mode:          string(mode),
		Prompt:        opts.Prompt,
	})
	return nil
}

func shouldFallbackResponsesToImagesInService(apiMode client.APIMode, mode client.Mode, err error, rawPath, apiProfileID string) bool {
	// A configured FHL slot has an explicit UI transport choice. Do not silently
	// move a new Responses task onto Images, which would violate its snapshot.
	if strings.TrimSpace(apiProfileID) != "" {
		return false
	}
	if apiMode != client.APIModeResponses || err == nil {
		return false
	}
	if mode != client.ModeGenerate && mode != client.ModeEdit {
		return false
	}
	errText := strings.ToLower(err.Error())
	retryableNoFinal := strings.Contains(errText, "image_generation_call.result") ||
		strings.Contains(errText, "no image") ||
		strings.Contains(errText, "idle timeout") ||
		strings.Contains(errText, "deadline exceeded") ||
		strings.Contains(errText, "context deadline")
	if !retryableNoFinal {
		return false
	}
	rawBytes, readErr := os.ReadFile(rawPath)
	if readErr != nil {
		return strings.Contains(errText, "idle timeout") || strings.Contains(errText, "deadline exceeded")
	}
	raw := strings.ToLower(string(rawBytes))
	for _, terminal := range []string{
		"content_policy",
		"moderation",
		"invalid_api_key",
		"incorrect_api_key",
		"insufficient_quota",
		"billing_hard_limit",
		"model_not_found",
	} {
		if strings.Contains(raw, terminal) {
			return false
		}
	}
	return strings.TrimSpace(raw) == "" ||
		strings.Contains(raw, "response.output_text") ||
		strings.Contains(raw, "response.reasoning") ||
		strings.Contains(raw, "image_generation_call") ||
		strings.Contains(raw, "partial_image_b64") ||
		client.IsRetryable(raw)
}

func (s *Service) emitError(jobID string, err error) {
	if s.isE2EOnly() {
		s.appendRuntimeLog("job error job=%s error=%v", jobID, err)
	}
	s.emitJobEventUnlessCancelled(jobID, "error:"+jobID, ErrorPayload{Message: err.Error()})
}

// emitErrorWithRaw 跟 emitError 一样,但额外带上原始响应日志的绝对路径,
// 前端「查看日志」按钮用它一键打开。请求都没发出去的早期失败走 emitError 即可。
func (s *Service) emitErrorWithRaw(jobID string, err error, rawPath string) {
	abs := rawPath
	if rawPath != "" {
		if a, e := filepath.Abs(rawPath); e == nil {
			abs = a
		}
	}
	if s.isE2EOnly() {
		s.appendRuntimeLog("job error job=%s raw=%s error=%v", jobID, abs, err)
	}
	s.emitJobEventUnlessCancelled(jobID, "error:"+jobID, ErrorPayload{
		Message: err.Error(),
		RawPath: abs,
	})
}

func normaliseAPIMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case string(client.APIModeImages):
		return string(client.APIModeImages)
	default:
		return string(client.APIModeResponses)
	}
}

func concurrencyBucketKey(apiMode, apiProfileID string) string {
	profileID := strings.TrimSpace(apiProfileID)
	if profileID == "" {
		// Preserve the original mode-wide bucket for callers built before
		// apiProfileId was added to GenerateOptions.
		return apiMode
	}
	// A configured profile represents one upstream credential/capacity even
	// when the UI switches between Images and Responses transports. Prefix the
	// bucket so a profile ID cannot collide with a legacy mode-wide bucket.
	return "profile:" + profileID
}

func normaliseConcurrencyLimit(limit int) int {
	if limit < 0 {
		return 0
	}
	return limit
}

func apiModeLabel(mode string) string {
	if mode == string(client.APIModeImages) {
		return "Images API"
	}
	return "Responses API"
}

func newJobID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
