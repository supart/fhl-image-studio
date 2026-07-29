package backend

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	psBridgeCLIPathEnv        = "FHL_PS_IMAGE_GEN_CLI"
	psBridgeDesktopExecutor   = "desktop"
	psBridgeCLIExecutor       = "fhl-image-gen-cli"
	psBridgeCLIProfileID      = "fhl-image-gen-cli"
	psBridgeCLIProfileName    = "FHL Image Gen CLI"
	psBridgeCLIFailureMessage = "FHL Image Gen CLI execution failed"
	psBridgeCLITimeout        = 10 * time.Minute
)

type psBridgeCLIRuntime struct {
	NodePath   string
	ScriptPath string
}

type psBridgeCLIRequest struct {
	Mode           string
	Prompt         string
	Size           string
	OutputFormat   string
	Seed           int64
	NegativePrompt string
	ImagePaths     []string
	MaskB64        string
	TempDir        string
}

type psBridgeCLIRunFunc func(context.Context, psBridgeCLIRuntime, psBridgeCLIRequest) (string, error)

type psBridgeCLIImagePreset struct {
	Aspect  string
	Quality string
}

var psBridgeCLIImagePresets = map[string]psBridgeCLIImagePreset{
	"2048x2048": {Aspect: "1:1", Quality: "2K"},
	"2048x1360": {Aspect: "3:2", Quality: "2K"},
	"1360x2048": {Aspect: "2:3", Quality: "2K"},
	"2048x1152": {Aspect: "16:9", Quality: "2K"},
	"1152x2048": {Aspect: "9:16", Quality: "2K"},
	"2048x1024": {Aspect: "2:1", Quality: "2K"},
	"2880x2880": {Aspect: "1:1", Quality: "4K"},
	"3520x2352": {Aspect: "3:2", Quality: "4K"},
	"2352x3520": {Aspect: "2:3", Quality: "4K"},
	"3840x2160": {Aspect: "16:9", Quality: "4K"},
	"2160x3840": {Aspect: "9:16", Quality: "4K"},
	"3840x1920": {Aspect: "2:1", Quality: "4K"},
}

func discoverPSBridgeCLIRuntime() (*psBridgeCLIRuntime, error) {
	scriptPath := strings.TrimSpace(os.Getenv(psBridgeCLIPathEnv))
	if scriptPath == "" {
		return nil, nil
	}
	absScript, err := filepath.Abs(scriptPath)
	if err != nil {
		return nil, errors.New("invalid FHL Image Gen CLI path")
	}
	resolvedScript, err := filepath.EvalSymlinks(absScript)
	if err != nil {
		return nil, errors.New("FHL Image Gen CLI is unavailable")
	}
	if !strings.EqualFold(filepath.Base(resolvedScript), "generate.mjs") {
		return nil, errors.New("FHL Image Gen CLI path must point to generate.mjs")
	}
	info, err := os.Stat(resolvedScript)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("FHL Image Gen CLI is unavailable")
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil, errors.New("Node.js is unavailable")
	}
	absNode, err := filepath.Abs(nodePath)
	if err != nil {
		return nil, errors.New("Node.js path is invalid")
	}
	return &psBridgeCLIRuntime{NodePath: absNode, ScriptPath: resolvedScript}, nil
}

// effectiveProfileViewLocked selects a ready desktop profile first. The CLI
// fallback is opt-in and only fills the image-generation gap.
func (b *PSBridge) effectiveProfileViewLocked() *PSBridgeProfilePublic {
	if b.profileView != nil && b.profileView.Ready {
		return b.profileView
	}
	if b.cliRuntime != nil {
		_, view := b.cliFallbackProfileLocked()
		return &view
	}
	return b.profileView
}

func (b *PSBridge) cliFallbackProfileLocked() (PSBridgeProfileInput, PSBridgeProfilePublic) {
	view := PSBridgeProfilePublic{
		ProfileID:    psBridgeCLIProfileID,
		Name:         psBridgeCLIProfileName,
		Provider:     "fhl",
		APIMode:      "images",
		ImageModelID: "gpt-image-2",
		SupportsMask: false,
		MaxImages:    psBridgeMaxImages,
		Ready:        true,
		ImageCapabilities: PSBridgeImageCapabilities{
			AspectPresets:     []string{"1:1", "3:2", "2:3", "16:9", "9:16", "2:1"},
			ResolutionPresets: []string{"2k", "4k"},
			QualityControl:    false,
			SizeEncoding:      "pixels",
		},
	}
	if b.profileView != nil {
		view.PromptOptimizationReady = b.profileView.PromptOptimizationReady
		view.PromptProviderLabel = b.profileView.PromptProviderLabel
	}
	input := PSBridgeProfileInput{
		ProfileID:        view.ProfileID,
		Name:             view.Name,
		APIMode:          view.APIMode,
		ImageModelID:     view.ImageModelID,
		ConcurrencyLimit: 1,
	}
	return input, view
}

func psBridgeCLIRequestForJob(job *psBridgeJob) (psBridgeCLIRequest, error) {
	request := psBridgeCLIRequest{
		Mode: job.Mode, Prompt: job.Prompt, Size: job.Size, OutputFormat: job.OutputFormat,
		Seed: job.Seed, NegativePrompt: job.NegativePrompt,
		ImagePaths: append([]string(nil), job.ImagePaths...), MaskB64: job.MaskB64,
		TempDir: job.TempDir,
	}
	if _, err := psBridgeCLIImagePresetFor(request.Size); err != nil {
		return psBridgeCLIRequest{}, err
	}
	if request.Mode != "generate" && request.Mode != "edit" {
		return psBridgeCLIRequest{}, errors.New("unsupported CLI image mode")
	}
	if request.Mode == "edit" && len(request.ImagePaths) == 0 {
		return psBridgeCLIRequest{}, errors.New("CLI image editing requires a source image")
	}
	if strings.ToLower(strings.TrimSpace(request.OutputFormat)) != "png" {
		return psBridgeCLIRequest{}, errors.New("CLI fallback supports PNG output only")
	}
	if request.Seed != 0 {
		return psBridgeCLIRequest{}, errors.New("CLI fallback does not support Seed")
	}
	if strings.TrimSpace(request.NegativePrompt) != "" {
		return psBridgeCLIRequest{}, errors.New("CLI fallback does not support negative prompts")
	}
	if strings.TrimSpace(request.MaskB64) != "" {
		return psBridgeCLIRequest{}, errors.New("CLI fallback uses Photoshop selection cropping instead of an upstream mask")
	}
	if strings.TrimSpace(request.TempDir) == "" {
		return psBridgeCLIRequest{}, errors.New("CLI fallback temp directory is unavailable")
	}
	return request, nil
}

func psBridgeCLIImagePresetFor(size string) (psBridgeCLIImagePreset, error) {
	preset, ok := psBridgeCLIImagePresets[strings.ToLower(strings.TrimSpace(size))]
	if !ok {
		return psBridgeCLIImagePreset{}, errors.New("CLI fallback supports the Photoshop 2K and 4K size presets only")
	}
	return preset, nil
}

func buildPSBridgeCLIArgs(runtime psBridgeCLIRuntime, request psBridgeCLIRequest) ([]string, error) {
	preset, err := psBridgeCLIImagePresetFor(request.Size)
	if err != nil {
		return nil, err
	}
	args := []string{runtime.ScriptPath, "--provider", "fhl"}
	if request.Mode == "edit" {
		args = append(args, "--edit")
		for _, path := range request.ImagePaths {
			args = append(args, "--image", path)
		}
	}
	args = append(args,
		"--prompt", request.Prompt,
		"--aspect", preset.Aspect,
		"--quality", preset.Quality,
		"--count", "1",
		"--concurrency", "1",
		"--output-dir", filepath.Join(request.TempDir, "cli-output"),
		"--no-resize",
	)
	return args, nil
}

func runPSBridgeCLI(ctx context.Context, runtime psBridgeCLIRuntime, request psBridgeCLIRequest) (string, error) {
	args, err := buildPSBridgeCLIArgs(runtime, request)
	if err != nil {
		return "", err
	}
	outputDir := filepath.Join(request.TempDir, "cli-output")
	if err := os.MkdirAll(outputDir, secureDirMode); err != nil {
		return "", errors.New(psBridgeCLIFailureMessage)
	}
	cmd := exec.CommandContext(ctx, runtime.NodePath, args...)
	cmd.Dir = request.TempDir
	cmd.Env = psBridgeCLIEnvironment()
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 5 * time.Second
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New(psBridgeCLIFailureMessage)
	}
	path, err := findSinglePSBridgeCLIImage(outputDir)
	if err != nil {
		return "", errors.New(psBridgeCLIFailureMessage)
	}
	return path, nil
}

func psBridgeCLIEnvironment() []string {
	allowed := map[string]bool{
		"appdata": true, "homedrive": true, "homepath": true,
		"localappdata": true, "systemroot": true, "temp": true,
		"tmp": true, "userprofile": true, "windir": true,
	}
	environment := make([]string, 0, len(allowed))
	for _, entry := range os.Environ() {
		name, _, ok := strings.Cut(entry, "=")
		if ok && allowed[strings.ToLower(strings.TrimSpace(name))] {
			environment = append(environment, entry)
		}
	}
	return environment
}

func findSinglePSBridgeCLIImage(outputDir string) (string, error) {
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return "", err
	}
	paths := make([]string, 0, 1)
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			continue
		}
		if !strings.EqualFold(filepath.Ext(entry.Name()), ".png") {
			continue
		}
		paths = append(paths, filepath.Join(outputDir, entry.Name()))
	}
	if len(paths) != 1 {
		return "", errors.New("CLI fallback must produce exactly one PNG")
	}
	if _, err := readValidatedImageFile(paths[0]); err != nil {
		return "", err
	}
	return paths[0], nil
}

func (b *PSBridge) dispatchCLIJob(job *psBridgeJob) error {
	request, err := psBridgeCLIRequestForJob(job)
	if err != nil {
		return err
	}
	b.mu.Lock()
	if b.cliRuntime == nil || b.runCLI == nil {
		b.mu.Unlock()
		return errors.New("FHL Image Gen CLI is unavailable")
	}
	runtime := *b.cliRuntime
	runner := b.runCLI
	b.mu.Unlock()

	parent, finishOperation, err := b.service.beginOperation(true)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(parent, psBridgeCLITimeout)
	b.mu.Lock()
	current := b.jobs[job.JobID]
	if current == nil || terminalPSBridgeState(current.State) {
		b.mu.Unlock()
		cancel()
		finishOperation()
		return errors.New("Photoshop bridge job is no longer active")
	}
	current.CLICancel = cancel
	b.mu.Unlock()
	b.setRunning(job.JobID, "FHL Image Gen CLI is generating")
	jobCopy := *job
	jobCopy.ImagePaths = append([]string(nil), job.ImagePaths...)

	go func() {
		defer finishOperation()
		defer cancel()
		resultPath, runErr := runner(ctx, runtime, request)
		if runErr != nil {
			if ctx.Err() == nil {
				b.failJob(jobCopy.JobID, psBridgeCLIFailureMessage)
			}
			b.settleJob(jobCopy.JobID)
			return
		}
		if ctx.Err() != nil {
			b.settleJob(jobCopy.JobID)
			return
		}
		result, saveErr := b.saveCLIFileResult(ctx, &jobCopy, resultPath)
		if saveErr != nil {
			if ctx.Err() == nil {
				b.failJob(jobCopy.JobID, psBridgeCLIFailureMessage)
			}
			b.settleJob(jobCopy.JobID)
			return
		}
		b.completeJob(jobCopy.JobID, result)
		b.settleJob(jobCopy.JobID)
	}()
	return nil
}

func (b *PSBridge) saveCLIFileResult(ctx context.Context, job *psBridgeJob, sourcePath string) (ResultPayload, error) {
	validated, err := readValidatedImageFile(sourcePath)
	if err != nil || validated.Extension != ".png" {
		return ResultPayload{}, errors.New(psBridgeCLIFailureMessage)
	}
	rootDir, err := b.service.resolvedOutputDir()
	if err != nil {
		return ResultPayload{}, err
	}
	imagesDir := imagesSubdir(rootDir)
	thumbsDir := thumbsSubdir(rootDir)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		return ResultPayload{}, err
	}
	if err := os.MkdirAll(thumbsDir, secureDirMode); err != nil {
		return ResultPayload{}, err
	}
	timestamp := time.Now().Format("20060102-150405") + "-" + strings.TrimPrefix(job.JobID, "ps-")[:6]
	mode := client.ModeGenerate
	if job.Mode == "edit" {
		mode = client.ModeEdit
	}
	imageName := buildImageName(mode, "photoshop", timestamp, "png")
	savedPath, err := writeImageBytes(validated.Bytes, filepath.Join(imagesDir, imageName))
	if err != nil {
		return ResultPayload{}, err
	}
	thumbName := strings.TrimSuffix(filepath.Base(savedPath), filepath.Ext(savedPath)) + ".avif"
	thumbPath := filepath.Join(thumbsDir, thumbName)
	keepFiles := false
	defer func() {
		if !keepFiles {
			_ = os.Remove(savedPath)
			_ = os.Remove(thumbPath)
		}
	}()
	var thumbW, thumbH int
	err = b.service.withMediaSlot(ctx, func() error {
		var thumbErr error
		thumbW, thumbH, thumbErr = createAVIFThumbnail(savedPath, thumbPath, mediaThumbMaxEdge)
		return thumbErr
	})
	if err != nil {
		return ResultPayload{}, err
	}
	asset, err := b.service.registerGeneratedMedia(savedPath, thumbPath, thumbW, thumbH)
	if err != nil {
		return ResultPayload{}, err
	}
	keepFiles = true
	return ResultPayload{
		SourceEvent: psBridgeCLIExecutor,
		ImageID:     asset.ID, SavedPath: savedPath, ThumbPath: asset.ThumbPath,
		PreviewURL: asset.PreviewURL, FullURL: asset.FullURL,
		Width: asset.Width, Height: asset.Height,
		PreviewWidth: asset.PreviewWidth, PreviewHeight: asset.PreviewHeight,
		Mode: job.Mode, Prompt: job.Prompt,
	}, nil
}
