package backend

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	psBridgePortFirst       = 47631
	psBridgePortLast        = 47640
	psBridgeMaxImages       = 10
	psBridgeMaxRecentJobs   = 50
	psBridgeMultipartMemory = 16 << 20
	psBridgeMaxBodyBytes    = int64(client.MaxInputImageBytes)*(psBridgeMaxImages+1) + (8 << 20)
	psBridgeAPIVersion      = "1"
)

type PSBridgeProfileInput struct {
	ProfileID          string                      `json:"profileId"`
	Name               string                      `json:"name"`
	APIMode            string                      `json:"apiMode"`
	BaseURL            string                      `json:"baseURL"`
	CredentialUser     string                      `json:"credentialUser"`
	TextModelID        string                      `json:"textModelID"`
	ImageModelID       string                      `json:"imageModelID"`
	RequestPolicy      string                      `json:"requestPolicy"`
	ImagesNewAPICompat bool                        `json:"imagesNewAPICompat"`
	ProxyMode          string                      `json:"proxyMode"`
	ProxyURL           string                      `json:"proxyURL"`
	ConcurrencyLimit   int                         `json:"concurrencyLimit"`
	ImageCapabilities  PSBridgeImageCapabilities   `json:"imageCapabilities"`
	PromptProfile      *PSBridgePromptProfileInput `json:"promptProfile,omitempty"`
}

type PSBridgeImageCapabilities struct {
	AspectPresets     []string `json:"aspectPresets"`
	ResolutionPresets []string `json:"resolutionPresets"`
	QualityControl    bool     `json:"qualityControl"`
	SizeEncoding      string   `json:"sizeEncoding"`
}

type PSBridgePromptProfileInput struct {
	Provider       string `json:"provider"`
	Label          string `json:"label"`
	BaseURL        string `json:"baseURL"`
	CredentialUser string `json:"credentialUser"`
	TextModelID    string `json:"textModelID"`
}

type PSBridgeProfilePublic struct {
	ProfileID               string                    `json:"profileId"`
	Name                    string                    `json:"name"`
	Provider                string                    `json:"provider"`
	APIMode                 string                    `json:"apiMode"`
	ImageModelID            string                    `json:"imageModelID"`
	SupportsMask            bool                      `json:"supportsMask"`
	MaxImages               int                       `json:"maxImages"`
	Ready                   bool                      `json:"ready"`
	PromptOptimizationReady bool                      `json:"promptOptimizationReady"`
	PromptProviderLabel     string                    `json:"promptProviderLabel,omitempty"`
	ImageCapabilities       PSBridgeImageCapabilities `json:"imageCapabilities"`
}

type PSBridgeStatus struct {
	Running      bool                   `json:"running"`
	Port         int                    `json:"port,omitempty"`
	InstanceID   string                 `json:"instanceId,omitempty"`
	ProfileReady bool                   `json:"profileReady"`
	Profile      *PSBridgeProfilePublic `json:"profile,omitempty"`
}

type PSBridgeSourceMetadata struct {
	Order          int    `json:"order"`
	SourceKind     string `json:"sourceKind"`
	DisplayName    string `json:"displayName"`
	DocumentID     string `json:"documentId,omitempty"`
	LayerID        string `json:"layerId,omitempty"`
	LayerPath      string `json:"layerPath,omitempty"`
	TrimMode       string `json:"trimMode,omitempty"`
	OriginalWidth  int    `json:"originalWidth,omitempty"`
	OriginalHeight int    `json:"originalHeight,omitempty"`
	UploadWidth    int    `json:"uploadWidth,omitempty"`
	UploadHeight   int    `json:"uploadHeight,omitempty"`
}

type PSBridgeJobSnapshot struct {
	JobID          string                   `json:"jobId"`
	ClientTaskID   string                   `json:"clientTaskId"`
	State          string                   `json:"state"`
	Stage          string                   `json:"stage,omitempty"`
	Error          string                   `json:"error,omitempty"`
	CreatedAt      int64                    `json:"createdAt"`
	UpdatedAt      int64                    `json:"updatedAt"`
	FinishedAt     int64                    `json:"finishedAt,omitempty"`
	ResultURL      string                   `json:"resultUrl,omitempty"`
	RevisedPrompt  string                   `json:"revisedPrompt,omitempty"`
	Profile        PSBridgeProfilePublic    `json:"profile"`
	SourceMetadata []PSBridgeSourceMetadata `json:"sources,omitempty"`
}

type PSBridgeRemoteDispatch struct {
	JobID              string   `json:"jobId"`
	ClientTaskID       string   `json:"clientTaskId"`
	ProfileID          string   `json:"profileId"`
	ProfileName        string   `json:"profileName"`
	APIMode            string   `json:"apiMode"`
	BaseURL            string   `json:"baseURL"`
	TextModelID        string   `json:"textModelID"`
	ImageModelID       string   `json:"imageModelID"`
	RequestPolicy      string   `json:"requestPolicy"`
	ImagesNewAPICompat bool     `json:"imagesNewAPICompat"`
	ProxyMode          string   `json:"proxyMode"`
	ProxyURL           string   `json:"proxyURL"`
	Mode               string   `json:"mode"`
	Prompt             string   `json:"prompt"`
	Size               string   `json:"size"`
	Quality            string   `json:"quality"`
	OutputFormat       string   `json:"outputFormat"`
	Seed               int64    `json:"seed"`
	NegativePrompt     string   `json:"negativePrompt"`
	ImagePaths         []string `json:"imagePaths"`
	PreparedBase       bool     `json:"preparedBase"`
	MaskB64            string   `json:"maskB64,omitempty"`
}

type PSBridgeRemoteProgress struct {
	JobID   string `json:"jobId"`
	Stage   string `json:"stage"`
	Elapsed int    `json:"elapsed"`
	Bytes   int64  `json:"bytes"`
}

type PSBridgeRemoteCompletion struct {
	JobID         string `json:"jobId"`
	ImageB64      string `json:"imageB64"`
	RevisedPrompt string `json:"revisedPrompt"`
	SourceEvent   string `json:"sourceEvent"`
	RawPath       string `json:"rawPath"`
}

type PSBridgeRemoteFailure struct {
	JobID   string `json:"jobId"`
	Message string `json:"message"`
	RawPath string `json:"rawPath"`
}

type PSBridgeHistoryEvent struct {
	JobID          string                   `json:"jobId"`
	ClientTaskID   string                   `json:"clientTaskId"`
	CreatedAt      int64                    `json:"createdAt"`
	Mode           string                   `json:"mode"`
	Prompt         string                   `json:"prompt"`
	Size           string                   `json:"size"`
	Quality        string                   `json:"quality"`
	OutputFormat   string                   `json:"outputFormat"`
	Seed           int64                    `json:"seed"`
	NegativePrompt string                   `json:"negativePrompt"`
	ProfileID      string                   `json:"profileId"`
	ProfileName    string                   `json:"profileName"`
	APIMode        string                   `json:"apiMode"`
	Sources        []PSBridgeSourceMetadata `json:"sources,omitempty"`
	Result         ResultPayload            `json:"result"`
}

type psBridgeJob struct {
	JobID          string
	ClientTaskID   string
	State          string
	Stage          string
	Error          string
	CreatedAt      int64
	UpdatedAt      int64
	FinishedAt     int64
	Mode           string
	Prompt         string
	Size           string
	Quality        string
	OutputFormat   string
	Seed           int64
	NegativePrompt string
	Aspect         string
	Resolution     string
	CanvasWidth    int
	CanvasHeight   int
	PreparedBase   bool
	Profile        PSBridgeProfileInput
	ProfilePublic  PSBridgeProfilePublic
	Sources        []PSBridgeSourceMetadata
	ImagePaths     []string
	MaskB64        string
	TempDir        string
	Result         ResultPayload
	Executor       string
	CLICancel      context.CancelFunc
}

type PSBridge struct {
	service        *Service
	optimizePrompt func(PromptOptimizeOptions) (string, error)

	mu           sync.Mutex
	server       *http.Server
	listener     net.Listener
	port         int
	instanceID   string
	sessionToken string
	profile      *PSBridgeProfileInput
	profileView  *PSBridgeProfilePublic
	cliRuntime   *psBridgeCLIRuntime
	runCLI       psBridgeCLIRunFunc
	jobs         map[string]*psBridgeJob
	clientJobs   map[string]string
	jobOrder     []string
}

func NewPSBridge(service *Service) *PSBridge {
	return &PSBridge{
		service:        service,
		optimizePrompt: service.OptimizePrompt,
		runCLI:         runPSBridgeCLI,
		jobs:           map[string]*psBridgeJob{},
		clientJobs:     map[string]string{},
	}
}

func (s *Service) StartupWithPSBridge(ctx context.Context) {
	s.Startup(ctx)
	if err := s.StartPSBridge(); err != nil {
		s.appendRuntimeLog("photoshop bridge unavailable: %v", err)
	}
}

func (s *Service) StartPSBridge() error {
	if s.psBridge == nil {
		s.psBridge = NewPSBridge(s)
	}
	return s.psBridge.Start()
}

func (s *Service) StopPSBridge() {
	if s.psBridge != nil {
		s.psBridge.Stop()
	}
}

func (s *Service) SyncPSBridgeProfile(input PSBridgeProfileInput) (PSBridgeStatus, error) {
	if s.psBridge == nil {
		return PSBridgeStatus{}, errors.New("Photoshop bridge is unavailable")
	}
	return s.psBridge.SyncProfile(input)
}

func (s *Service) ClearPSBridgeProfile() {
	if s.psBridge != nil {
		s.psBridge.ClearProfile()
	}
}

func (s *Service) CompletePSBridgeRemoteJob(input PSBridgeRemoteCompletion) error {
	if s.psBridge == nil {
		return errors.New("Photoshop bridge is unavailable")
	}
	return s.psBridge.CompleteRemote(input)
}

func (s *Service) FailPSBridgeRemoteJob(input PSBridgeRemoteFailure) error {
	if s.psBridge == nil {
		return errors.New("Photoshop bridge is unavailable")
	}
	return s.psBridge.FailRemote(input)
}

func (s *Service) UpdatePSBridgeRemoteJob(input PSBridgeRemoteProgress) error {
	if s.psBridge == nil {
		return errors.New("Photoshop bridge is unavailable")
	}
	return s.psBridge.UpdateRemote(input)
}

func (b *PSBridge) Start() error {
	cliRuntime, _ := discoverPSBridgeCLIRuntime()
	b.mu.Lock()
	if b.server != nil {
		b.cliRuntime = cliRuntime
		b.mu.Unlock()
		return nil
	}
	b.mu.Unlock()

	var listener net.Listener
	var err error
	port := 0
	for candidate := psBridgePortFirst; candidate <= psBridgePortLast; candidate++ {
		listener, err = net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(candidate)))
		if err == nil {
			port = candidate
			break
		}
	}
	if listener == nil {
		return fmt.Errorf("no free Photoshop bridge port in %d-%d: %w", psBridgePortFirst, psBridgePortLast, err)
	}
	instanceID, err := randomHex(12)
	if err != nil {
		listener.Close()
		return err
	}
	token, err := randomHex(32)
	if err != nil {
		listener.Close()
		return err
	}
	server := &http.Server{
		Handler:           b.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	b.mu.Lock()
	b.listener = listener
	b.server = server
	b.port = port
	b.instanceID = instanceID
	b.sessionToken = token
	b.cliRuntime = cliRuntime
	b.mu.Unlock()
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			b.service.appendRuntimeLog("photoshop bridge server stopped: %v", serveErr)
		}
	}()
	return nil
}

func (b *PSBridge) Stop() {
	b.mu.Lock()
	server := b.server
	b.server = nil
	b.listener = nil
	b.port = 0
	b.sessionToken = ""
	active := b.activeJobsLocked()
	b.mu.Unlock()
	for _, job := range active {
		b.cancelByID(job.JobID)
	}
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = server.Shutdown(ctx)
		cancel()
	}
}

func (b *PSBridge) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/fhl-ps/v1/health", b.handleHealth)
	mux.HandleFunc("/fhl-ps/v1/session", b.handleSession)
	mux.HandleFunc("/fhl-ps/v1/profile", b.requireSession(b.handleProfile))
	mux.HandleFunc("/fhl-ps/v1/prompts/optimize", b.requireSession(b.handlePromptOptimize))
	mux.HandleFunc("/fhl-ps/v1/jobs", b.requireSession(b.handleJobs))
	mux.HandleFunc("/fhl-ps/v1/jobs/", b.requireSession(b.handleJob))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if !isPSBridgeLoopbackRequest(r) || isOrdinaryWebOrigin(r.Header.Get("Origin")) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodOptions {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (b *PSBridge) SyncProfile(input PSBridgeProfileInput) (PSBridgeStatus, error) {
	input.ProfileID = strings.TrimSpace(input.ProfileID)
	if input.ProfileID == "" {
		b.ClearProfile()
		return b.Status(), nil
	}
	if !safeIdentifier(input.ProfileID) {
		return PSBridgeStatus{}, errors.New("invalid profile id")
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return PSBridgeStatus{}, errors.New("profile name is empty")
	}
	input.APIMode = strings.ToLower(strings.TrimSpace(input.APIMode))
	switch input.APIMode {
	case "responses", "images", "apimart", "runninghub":
	default:
		return PSBridgeStatus{}, errors.New("unsupported profile mode")
	}
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	if input.BaseURL == "" {
		return PSBridgeStatus{}, errors.New("profile base URL is empty")
	}
	if input.APIMode != "runninghub" {
		if _, err := normalizeKeyringUser(input.CredentialUser); err != nil {
			return PSBridgeStatus{}, err
		}
	}
	input.RequestPolicy = strings.ToLower(strings.TrimSpace(input.RequestPolicy))
	if input.RequestPolicy != "compat" {
		input.RequestPolicy = "openai"
	}
	input.ProxyMode = strings.ToLower(strings.TrimSpace(input.ProxyMode))
	if input.ProxyMode != "none" && input.ProxyMode != "custom" {
		input.ProxyMode = "system"
	}
	input.ConcurrencyLimit = normaliseConcurrencyLimit(input.ConcurrencyLimit)
	capabilities, err := normalizePSBridgeImageCapabilities(input.ImageCapabilities, input.APIMode)
	if err != nil {
		return PSBridgeStatus{}, err
	}
	input.ImageCapabilities = capabilities
	ready := input.APIMode == "runninghub"
	if !ready {
		key, err := b.service.GetStoredAPIKey(input.CredentialUser)
		ready = err == nil && strings.TrimSpace(key) != ""
	}
	promptReady := false
	if input.PromptProfile != nil {
		input.PromptProfile.Provider = strings.TrimSpace(input.PromptProfile.Provider)
		input.PromptProfile.Label = strings.TrimSpace(input.PromptProfile.Label)
		input.PromptProfile.BaseURL = strings.TrimSpace(input.PromptProfile.BaseURL)
		input.PromptProfile.TextModelID = strings.TrimSpace(input.PromptProfile.TextModelID)
		if input.PromptProfile.Provider == "" || input.PromptProfile.Label == "" || input.PromptProfile.BaseURL == "" {
			return PSBridgeStatus{}, errors.New("prompt profile is incomplete")
		}
		if _, err := normalizeKeyringUser(input.PromptProfile.CredentialUser); err != nil {
			return PSBridgeStatus{}, err
		}
		key, err := b.service.GetStoredAPIKey(input.PromptProfile.CredentialUser)
		promptReady = err == nil && strings.TrimSpace(key) != ""
		key = ""
	}
	view := publicPSBridgeProfile(input, ready, promptReady)
	b.mu.Lock()
	b.profile = &input
	b.profileView = &view
	b.mu.Unlock()
	return b.Status(), nil
}

func (b *PSBridge) ClearProfile() {
	token, _ := randomHex(32)
	b.mu.Lock()
	b.profile = nil
	b.profileView = nil
	b.sessionToken = token
	active := b.activeJobsLocked()
	b.mu.Unlock()
	for _, job := range active {
		b.cancelByID(job.JobID)
	}
}

func (b *PSBridge) Status() PSBridgeStatus {
	b.mu.Lock()
	defer b.mu.Unlock()
	status := PSBridgeStatus{
		Running:    b.server != nil,
		Port:       b.port,
		InstanceID: b.instanceID,
	}
	if selected := b.effectiveProfileViewLocked(); selected != nil {
		profile := *selected
		status.Profile = &profile
		status.ProfileReady = profile.Ready
	}
	return status
}

func (b *PSBridge) ObserveServiceEvent(eventName string, args ...any) {
	jobID := ""
	switch {
	case strings.HasPrefix(eventName, "progress:"):
		jobID = strings.TrimPrefix(eventName, "progress:")
		payload, ok := firstEventArg[ProgressPayload](args)
		if ok {
			b.updateProgress(jobID, payload.Stage)
		}
	case strings.HasPrefix(eventName, "result:"):
		jobID = strings.TrimPrefix(eventName, "result:")
		payload, ok := firstEventArg[ResultPayload](args)
		if ok {
			b.completeJob(jobID, payload)
		}
	case strings.HasPrefix(eventName, "error:"):
		jobID = strings.TrimPrefix(eventName, "error:")
		payload, ok := firstEventArg[ErrorPayload](args)
		if ok {
			b.failJob(jobID, payload.Message)
		}
	case strings.HasPrefix(eventName, "settled:"):
		jobID = strings.TrimPrefix(eventName, "settled:")
		b.settleJob(jobID)
	}
}

func (b *PSBridge) CompleteRemote(input PSBridgeRemoteCompletion) error {
	job := b.jobForRemoteCompletion(input.JobID)
	if job == nil {
		return errors.New("Photoshop bridge job is not active")
	}
	result, err := b.saveRemoteResult(job, input)
	if err != nil {
		b.failJob(job.JobID, err.Error())
		return err
	}
	b.completeJob(job.JobID, result)
	b.settleJob(job.JobID)
	return nil
}

func (b *PSBridge) FailRemote(input PSBridgeRemoteFailure) error {
	if b.jobForRemoteCompletion(input.JobID) == nil {
		return errors.New("Photoshop bridge job is not active")
	}
	b.failJob(input.JobID, strings.TrimSpace(input.Message))
	b.settleJob(input.JobID)
	return nil
}

func (b *PSBridge) UpdateRemote(input PSBridgeRemoteProgress) error {
	if b.jobForRemoteCompletion(input.JobID) == nil {
		return errors.New("Photoshop bridge job is not active")
	}
	b.updateProgress(input.JobID, input.Stage)
	return nil
}

func (b *PSBridge) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status := b.Status()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"service":      "fhl-studio-ps-bridge",
		"apiVersion":   psBridgeAPIVersion,
		"instanceId":   status.InstanceID,
		"port":         status.Port,
		"profileReady": status.ProfileReady,
	})
}

func (b *PSBridge) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	b.mu.Lock()
	token := b.sessionToken
	instanceID := b.instanceID
	b.mu.Unlock()
	if token == "" {
		http.Error(w, "bridge unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token, "instanceId": instanceID, "apiVersion": psBridgeAPIVersion,
	})
}

func (b *PSBridge) handleProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status := b.Status()
	if status.Profile == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "FHL Studio 尚未配置活动 API"})
		return
	}
	writeJSON(w, http.StatusOK, status.Profile)
}

func (b *PSBridge) handleJobs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	b.submitHTTPJob(w, r)
}

func (b *PSBridge) handlePromptOptimize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, psBridgeMaxBodyBytes)
	if err := r.ParseMultipartForm(psBridgeMultipartMemory); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无法读取提示词优化数据"})
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	profile, promptProfile, err := b.promptProfileSnapshot()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	mode := strings.ToLower(strings.TrimSpace(r.FormValue("mode")))
	if mode != "generate" && mode != "edit" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "mode 必须是 generate 或 edit"})
		return
	}
	prompt := strings.TrimSpace(r.FormValue("prompt"))
	guidance := strings.TrimSpace(r.FormValue("optimizationGuidance"))
	if prompt == "" || len(prompt) > 20000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "提示词不能为空或过长"})
		return
	}
	if len(guidance) > 10000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "精准修改指令过长"})
		return
	}
	sourceFiles := r.MultipartForm.File["source"]
	if len(sourceFiles) > psBridgeMaxImages {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("最多只能发送 %d 张图片", psBridgeMaxImages)})
		return
	}
	imagePaths := make([]string, 0, len(sourceFiles))
	tempDir := ""
	if len(sourceFiles) > 0 {
		tempDir, err = os.MkdirTemp("", "fhl-studio-ps-prompt-")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "无法准备提示词图片"})
			return
		}
		defer os.RemoveAll(tempDir)
		for index, header := range sourceFiles {
			path, saveErr := saveBridgeMultipartImage(header, tempDir, index)
			if saveErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": sanitizePSBridgeError(saveErr)})
				return
			}
			imagePaths = append(imagePaths, path)
		}
	}
	apiKey, err := b.service.GetStoredAPIKey(promptProfile.CredentialUser)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "提示词优化没有可用文本凭据"})
		return
	}
	optimized, err := b.optimizePrompt(PromptOptimizeOptions{
		APIKey: apiKey, Prompt: prompt, OptimizationGuidance: guidance, Mode: mode,
		BaseURL: promptProfile.BaseURL, TextModelID: promptProfile.TextModelID,
		ProxyMode: profile.ProxyMode, ProxyURL: profile.ProxyURL, ImagePaths: imagePaths,
	})
	apiKey = ""
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": sanitizePSBridgeError(err)})
		return
	}
	optimized = strings.TrimSpace(optimized)
	if optimized == "" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "提示词优化未返回文本"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"prompt": optimized})
}

func (b *PSBridge) handleJob(w http.ResponseWriter, r *http.Request) {
	relative := strings.TrimPrefix(r.URL.Path, "/fhl-ps/v1/jobs/")
	if relative == "" {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(relative, "/image") {
		jobID := strings.TrimSuffix(relative, "/image")
		jobID = strings.TrimSuffix(jobID, "/")
		b.serveJobImage(w, r, jobID)
		return
	}
	if strings.Contains(relative, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		job := b.jobSnapshot(relative)
		if job == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, job)
	case http.MethodDelete:
		if !b.cancelByID(relative) {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"cancelled": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (b *PSBridge) submitHTTPJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, psBridgeMaxBodyBytes)
	if err := r.ParseMultipartForm(psBridgeMultipartMemory); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无法读取任务数据"})
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	clientTaskID := strings.TrimSpace(r.FormValue("clientTaskId"))
	if !safeIdentifier(clientTaskID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "clientTaskId 无效"})
		return
	}
	if existing := b.jobByClientTask(clientTaskID); existing != nil {
		writeJSON(w, http.StatusOK, existing)
		return
	}
	mode := strings.ToLower(strings.TrimSpace(r.FormValue("mode")))
	if mode != "generate" && mode != "edit" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "mode 必须是 generate 或 edit"})
		return
	}
	prompt := strings.TrimSpace(r.FormValue("prompt"))
	if prompt == "" || len(prompt) > 20000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "提示词不能为空或过长"})
		return
	}
	profile, profileView, executor, err := b.profileSnapshot()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	outputContract, err := parsePSBridgeOutputContract(r, profileView)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	jobID, err := randomHex(12)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "无法创建任务"})
		return
	}
	jobID = "ps-" + jobID
	now := time.Now().UnixMilli()
	job := &psBridgeJob{
		JobID:          jobID,
		ClientTaskID:   clientTaskID,
		State:          "submitting",
		Stage:          "正在准备 Photoshop 输入",
		CreatedAt:      now,
		UpdatedAt:      now,
		Mode:           mode,
		Prompt:         prompt,
		Size:           outputContract.Size,
		Quality:        outputContract.Quality,
		OutputFormat:   cleanBridgeOutputFormat(r.FormValue("outputFormat")),
		Seed:           parseBridgeSeed(r.FormValue("seed")),
		NegativePrompt: strings.TrimSpace(r.FormValue("negativePrompt")),
		Aspect:         outputContract.Aspect,
		Resolution:     outputContract.Resolution,
		CanvasWidth:    outputContract.CanvasWidth,
		CanvasHeight:   outputContract.CanvasHeight,
		PreparedBase:   outputContract.PreparedBase,
		Profile:        profile,
		ProfilePublic:  profileView,
		Executor:       executor,
	}
	if len(job.NegativePrompt) > 10000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "反向提示词过长"})
		return
	}
	if rawMetadata := strings.TrimSpace(r.FormValue("sourceMetadata")); rawMetadata != "" {
		if len(rawMetadata) > 64<<10 || json.Unmarshal([]byte(rawMetadata), &job.Sources) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "参考图元数据无效"})
			return
		}
	}
	if existing, reserved := b.reserveJob(job); !reserved {
		if existing != nil {
			writeJSON(w, http.StatusOK, existing)
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Photoshop 当前已有任务，完成或取消后再提交"})
		return
	}
	if err := b.materializeHTTPInputs(job, r.MultipartForm); err != nil {
		b.failJob(job.JobID, err.Error())
		b.settleJob(job.JobID)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := b.dispatchJob(job); err != nil {
		b.failJob(job.JobID, err.Error())
		b.settleJob(job.JobID)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, b.jobSnapshot(job.JobID))
}

func (b *PSBridge) materializeHTTPInputs(job *psBridgeJob, form *multipart.Form) error {
	tempDir, err := os.MkdirTemp("", "fhl-studio-ps-bridge-"+job.JobID+"-")
	if err != nil {
		return err
	}
	job.TempDir = tempDir
	baseFiles := form.File["base"]
	references := form.File["reference"]
	if len(baseFiles) > 1 {
		return errors.New("待修改底图只能有一张")
	}
	if len(baseFiles)+len(references) > psBridgeMaxImages {
		return fmt.Errorf("最多只能发送 %d 张图片", psBridgeMaxImages)
	}
	index := 0
	for _, header := range baseFiles {
		path, validated, err := saveBridgeMultipartImageValidated(header, tempDir, index)
		if err != nil {
			return err
		}
		if job.CanvasWidth > 0 && (validated.Config.Width != job.CanvasWidth || validated.Config.Height != job.CanvasHeight) {
			return fmt.Errorf("待修改底图尺寸必须是 %dx%d", job.CanvasWidth, job.CanvasHeight)
		}
		job.ImagePaths = append(job.ImagePaths, path)
		index++
	}
	for _, header := range references {
		path, _, err := saveBridgeMultipartImageValidated(header, tempDir, index)
		if err != nil {
			return err
		}
		job.ImagePaths = append(job.ImagePaths, path)
		index++
	}
	if job.Mode == "edit" && len(job.ImagePaths) == 0 {
		return errors.New("图生图任务需要待修改图或参考图")
	}
	if job.PreparedBase && (job.Mode != "edit" || len(baseFiles) != 1 || job.CanvasWidth <= 0) {
		return errors.New("规范化底图标记需要一张与标准画布一致的待修改底图")
	}
	maskFiles := form.File["mask"]
	if len(maskFiles) > 1 {
		return errors.New("蒙版只能有一张")
	}
	if len(maskFiles) == 1 {
		data, err := readBridgeMultipartImage(maskFiles[0])
		if err != nil {
			return fmt.Errorf("蒙版无效: %w", err)
		}
		if data.Extension != ".png" {
			return errors.New("蒙版必须是 PNG")
		}
		if job.CanvasWidth > 0 && (data.Config.Width != job.CanvasWidth || data.Config.Height != job.CanvasHeight) {
			return fmt.Errorf("蒙版尺寸必须是 %dx%d", job.CanvasWidth, job.CanvasHeight)
		}
		job.MaskB64 = base64.StdEncoding.EncodeToString(data.Bytes)
	}
	return nil
}

func (b *PSBridge) dispatchJob(job *psBridgeJob) error {
	if job.Executor == psBridgeCLIExecutor {
		return b.dispatchCLIJob(job)
	}
	if job.Profile.APIMode == "apimart" || job.Profile.APIMode == "runninghub" {
		b.setRunning(job.JobID, "正在交给桌面接口提交")
		b.service.emit("ps-bridge:remote-job", PSBridgeRemoteDispatch{
			JobID: job.JobID, ClientTaskID: job.ClientTaskID,
			ProfileID: job.Profile.ProfileID, ProfileName: job.Profile.Name,
			APIMode: job.Profile.APIMode, BaseURL: job.Profile.BaseURL,
			TextModelID: job.Profile.TextModelID, ImageModelID: job.Profile.ImageModelID,
			RequestPolicy: job.Profile.RequestPolicy, ImagesNewAPICompat: job.Profile.ImagesNewAPICompat,
			ProxyMode: job.Profile.ProxyMode, ProxyURL: job.Profile.ProxyURL,
			Mode: job.Mode, Prompt: job.Prompt, Size: job.Size, Quality: job.Quality,
			OutputFormat: job.OutputFormat, Seed: job.Seed, NegativePrompt: job.NegativePrompt,
			ImagePaths: append([]string(nil), job.ImagePaths...), PreparedBase: job.PreparedBase, MaskB64: job.MaskB64,
		})
		return nil
	}
	apiKey, err := b.service.GetStoredAPIKey(job.Profile.CredentialUser)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		return errors.New("当前活动 API 没有可用凭据，请先在 FHL Studio 中配置")
	}
	opts := GenerateOptions{
		APIKey: apiKey, RequestedJobID: job.JobID, Prompt: job.Prompt,
		Size: job.Size, Quality: job.Quality, OutputFormat: job.OutputFormat,
		ImagePaths: append([]string(nil), job.ImagePaths...), preparedBase: job.PreparedBase, MaskB64: job.MaskB64,
		Seed: job.Seed, NegativePrompt: job.NegativePrompt,
		BaseURL: job.Profile.BaseURL, TextModelID: job.Profile.TextModelID,
		ImageModelID: job.Profile.ImageModelID, APIMode: job.Profile.APIMode,
		APIProfileID: job.Profile.ProfileID, RequestPolicy: job.Profile.RequestPolicy,
		ImagesNewAPICompat: job.Profile.ImagesNewAPICompat,
		ProxyMode:          job.Profile.ProxyMode, ProxyURL: job.Profile.ProxyURL,
		ConcurrencyLimit: 1,
	}
	var started JobStarted
	if job.Mode == "edit" {
		started, err = b.service.Edit(opts)
	} else {
		started, err = b.service.Generate(opts)
	}
	apiKey = ""
	if err != nil {
		return err
	}
	if started.JobID != job.JobID {
		return errors.New("desktop job id mismatch")
	}
	b.setRunning(job.JobID, "任务已提交")
	return nil
}

func (b *PSBridge) saveRemoteResult(job *psBridgeJob, input PSBridgeRemoteCompletion) (ResultPayload, error) {
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
	imageName := buildImageName(mode, job.Prompt, timestamp, job.OutputFormat)
	savedPath, err := writeBase64Image(input.ImageB64, filepath.Join(imagesDir, imageName))
	if err != nil {
		return ResultPayload{}, err
	}
	thumbName := strings.TrimSuffix(filepath.Base(savedPath), filepath.Ext(savedPath)) + ".avif"
	thumbPath := filepath.Join(thumbsDir, thumbName)
	var thumbW, thumbH int
	ctx, finish, err := b.service.beginOperation(false)
	if err != nil {
		return ResultPayload{}, err
	}
	err = b.service.withMediaSlot(ctx, func() error {
		var thumbErr error
		thumbW, thumbH, thumbErr = createAVIFThumbnail(savedPath, thumbPath, mediaThumbMaxEdge)
		return thumbErr
	})
	finish()
	if err != nil {
		return ResultPayload{}, err
	}
	asset, err := b.service.registerGeneratedMedia(savedPath, thumbPath, thumbW, thumbH)
	if err != nil {
		return ResultPayload{}, err
	}
	return ResultPayload{
		RevisedPrompt: input.RevisedPrompt, SourceEvent: input.SourceEvent,
		RawPath: input.RawPath,
		ImageID: asset.ID, SavedPath: savedPath, ThumbPath: asset.ThumbPath,
		PreviewURL: asset.PreviewURL, FullURL: asset.FullURL,
		Width: asset.Width, Height: asset.Height,
		PreviewWidth: asset.PreviewWidth, PreviewHeight: asset.PreviewHeight,
		Mode: job.Mode, Prompt: job.Prompt,
	}, nil
}

func (b *PSBridge) completeJob(jobID string, result ResultPayload) {
	var history PSBridgeHistoryEvent
	b.mu.Lock()
	job := b.jobs[jobID]
	if job == nil || terminalPSBridgeState(job.State) {
		b.mu.Unlock()
		return
	}
	now := time.Now().UnixMilli()
	job.State = "succeeded"
	job.Stage = "生成完成"
	job.UpdatedAt = now
	job.FinishedAt = now
	job.Result = result
	history = historyEventForPSBridgeJob(job)
	b.mu.Unlock()
	b.service.emit("ps-bridge:history", history)
}

func (b *PSBridge) failJob(jobID, message string) {
	b.mu.Lock()
	job := b.jobs[jobID]
	if job == nil || terminalPSBridgeState(job.State) {
		b.mu.Unlock()
		return
	}
	now := time.Now().UnixMilli()
	job.State = "failed"
	job.Stage = "任务失败"
	job.Error = strings.TrimSpace(message)
	if job.Error == "" {
		job.Error = "任务失败"
	}
	job.UpdatedAt = now
	job.FinishedAt = now
	tempDir := job.TempDir
	job.TempDir = ""
	b.mu.Unlock()
	if tempDir != "" {
		_ = os.RemoveAll(tempDir)
	}
}

func (b *PSBridge) settleJob(jobID string) {
	b.mu.Lock()
	job := b.jobs[jobID]
	if job == nil {
		b.mu.Unlock()
		return
	}
	if job.State == "running" || job.State == "submitting" {
		job.State = "cancelled"
		job.Stage = "任务已取消"
		job.UpdatedAt = time.Now().UnixMilli()
		job.FinishedAt = job.UpdatedAt
	}
	tempDir := job.TempDir
	job.TempDir = ""
	b.mu.Unlock()
	if tempDir != "" {
		_ = os.RemoveAll(tempDir)
	}
}

func (b *PSBridge) updateProgress(jobID, stage string) {
	b.mu.Lock()
	if job := b.jobs[jobID]; job != nil && !terminalPSBridgeState(job.State) {
		job.State = "running"
		job.Stage = strings.TrimSpace(stage)
		job.UpdatedAt = time.Now().UnixMilli()
	}
	b.mu.Unlock()
}

func (b *PSBridge) setRunning(jobID, stage string) {
	b.updateProgress(jobID, stage)
}

func (b *PSBridge) reserveJob(job *psBridgeJob) (*PSBridgeJobSnapshot, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if existingID := b.clientJobs[job.ClientTaskID]; existingID != "" {
		if existing := b.jobs[existingID]; existing != nil {
			return snapshotPSBridgeJob(existing), false
		}
		delete(b.clientJobs, job.ClientTaskID)
	}
	for _, existing := range b.jobs {
		if !terminalPSBridgeState(existing.State) {
			return nil, false
		}
	}
	b.jobs[job.JobID] = job
	b.clientJobs[job.ClientTaskID] = job.JobID
	b.jobOrder = append(b.jobOrder, job.JobID)
	b.pruneJobsLocked()
	return nil, true
}

func (b *PSBridge) pruneJobsLocked() {
	for len(b.jobOrder) > psBridgeMaxRecentJobs {
		removeIndex := -1
		for index, jobID := range b.jobOrder {
			if job := b.jobs[jobID]; job == nil || terminalPSBridgeState(job.State) {
				removeIndex = index
				break
			}
		}
		if removeIndex < 0 {
			return
		}
		jobID := b.jobOrder[removeIndex]
		b.jobOrder = append(b.jobOrder[:removeIndex], b.jobOrder[removeIndex+1:]...)
		if job := b.jobs[jobID]; job != nil {
			delete(b.clientJobs, job.ClientTaskID)
		}
		delete(b.jobs, jobID)
	}
}

func (b *PSBridge) profileSnapshot() (PSBridgeProfileInput, PSBridgeProfilePublic, string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.profile != nil && b.profileView != nil && b.profileView.Ready {
		return *b.profile, *b.profileView, psBridgeDesktopExecutor, nil
	}
	if b.cliRuntime != nil {
		profile, view := b.cliFallbackProfileLocked()
		return profile, view, psBridgeCLIExecutor, nil
	}
	if b.profile == nil || b.profileView == nil {
		return PSBridgeProfileInput{}, PSBridgeProfilePublic{}, "", errors.New("请先在 FHL Studio 中配置并选择 API")
	}
	if !b.profileView.Ready {
		return PSBridgeProfileInput{}, PSBridgeProfilePublic{}, "", errors.New("当前活动 API 没有可用凭据")
	}
	return *b.profile, *b.profileView, psBridgeDesktopExecutor, nil
}

func (b *PSBridge) promptProfileSnapshot() (PSBridgeProfileInput, PSBridgePromptProfileInput, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.profile == nil || b.profileView == nil || b.profile.PromptProfile == nil {
		return PSBridgeProfileInput{}, PSBridgePromptProfileInput{}, errors.New("请先在 FHL Studio 中配置文本模型")
	}
	if !b.profileView.PromptOptimizationReady {
		return PSBridgeProfileInput{}, PSBridgePromptProfileInput{}, errors.New("提示词优化没有可用文本凭据")
	}
	return *b.profile, *b.profile.PromptProfile, nil
}

func (b *PSBridge) jobSnapshot(jobID string) *PSBridgeJobSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	job := b.jobs[jobID]
	if job == nil {
		return nil
	}
	return snapshotPSBridgeJob(job)
}

func (b *PSBridge) jobByClientTask(clientTaskID string) *PSBridgeJobSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	job := b.jobs[b.clientJobs[clientTaskID]]
	if job == nil {
		return nil
	}
	return snapshotPSBridgeJob(job)
}

func (b *PSBridge) jobForRemoteCompletion(jobID string) *psBridgeJob {
	b.mu.Lock()
	defer b.mu.Unlock()
	job := b.jobs[strings.TrimSpace(jobID)]
	if job == nil || terminalPSBridgeState(job.State) || (job.Profile.APIMode != "apimart" && job.Profile.APIMode != "runninghub") {
		return nil
	}
	copyJob := *job
	copyJob.ImagePaths = append([]string(nil), job.ImagePaths...)
	return &copyJob
}

func (b *PSBridge) activeJobsLocked() []*psBridgeJob {
	jobs := make([]*psBridgeJob, 0, 1)
	for _, job := range b.jobs {
		if !terminalPSBridgeState(job.State) {
			jobs = append(jobs, job)
		}
	}
	return jobs
}

func (b *PSBridge) cancelByID(jobID string) bool {
	b.mu.Lock()
	job := b.jobs[jobID]
	if job == nil {
		b.mu.Unlock()
		return false
	}
	if terminalPSBridgeState(job.State) {
		b.mu.Unlock()
		return true
	}
	now := time.Now().UnixMilli()
	job.State = "cancelled"
	job.Stage = "任务已取消"
	job.UpdatedAt = now
	job.FinishedAt = now
	b.mu.Unlock()
	b.cancelJob(job)
	return true
}

func (b *PSBridge) cancelJob(job *psBridgeJob) {
	if job.Executor == psBridgeCLIExecutor {
		if job.CLICancel != nil {
			job.CLICancel()
		}
	} else if job.Profile.APIMode == "apimart" || job.Profile.APIMode == "runninghub" {
		b.service.emit("ps-bridge:remote-cancel", map[string]string{"jobId": job.JobID})
	} else {
		_ = b.service.Cancel(job.JobID)
	}
	if job.TempDir != "" {
		go func(path string) {
			time.Sleep(2 * time.Second)
			_ = os.RemoveAll(path)
		}(job.TempDir)
	}
}

func (b *PSBridge) serveJobImage(w http.ResponseWriter, r *http.Request, jobID string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	b.mu.Lock()
	job := b.jobs[jobID]
	path := ""
	if job != nil && job.State == "succeeded" {
		path = job.Result.SavedPath
	}
	b.mu.Unlock()
	if path == "" {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentTypeForImagePath(path))
	w.Header().Set("Content-Disposition", `inline; filename="fhl-studio-result`+filepath.Ext(path)+`"`)
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), file)
}

func (b *PSBridge) requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		b.mu.Lock()
		expected := b.sessionToken
		b.mu.Unlock()
		if expected == "" || provided == "" || provided != expected {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func snapshotPSBridgeJob(job *psBridgeJob) *PSBridgeJobSnapshot {
	resultURL := ""
	if job.State == "succeeded" && job.Result.SavedPath != "" {
		resultURL = "/fhl-ps/v1/jobs/" + job.JobID + "/image"
	}
	return &PSBridgeJobSnapshot{
		JobID: job.JobID, ClientTaskID: job.ClientTaskID, State: job.State,
		Stage: job.Stage, Error: job.Error, CreatedAt: job.CreatedAt,
		UpdatedAt: job.UpdatedAt, FinishedAt: job.FinishedAt, ResultURL: resultURL,
		RevisedPrompt: job.Result.RevisedPrompt, Profile: job.ProfilePublic,
		SourceMetadata: append([]PSBridgeSourceMetadata(nil), job.Sources...),
	}
}

func historyEventForPSBridgeJob(job *psBridgeJob) PSBridgeHistoryEvent {
	return PSBridgeHistoryEvent{
		JobID: job.JobID, ClientTaskID: job.ClientTaskID, CreatedAt: job.CreatedAt,
		Mode: job.Mode, Prompt: job.Prompt, Size: job.Size, Quality: job.Quality,
		OutputFormat: job.OutputFormat, Seed: job.Seed, NegativePrompt: job.NegativePrompt,
		ProfileID: job.Profile.ProfileID, ProfileName: job.Profile.Name,
		APIMode: job.Profile.APIMode, Sources: append([]PSBridgeSourceMetadata(nil), job.Sources...),
		Result: job.Result,
	}
}

func publicPSBridgeProfile(input PSBridgeProfileInput, ready, promptReady bool) PSBridgeProfilePublic {
	provider := input.APIMode
	if input.APIMode == "responses" || input.APIMode == "images" {
		provider = "fhl"
	}
	return PSBridgeProfilePublic{
		ProfileID: input.ProfileID, Name: input.Name, Provider: provider,
		APIMode: input.APIMode, ImageModelID: input.ImageModelID,
		SupportsMask: psBridgeSupportsMask(input),
		MaxImages:    psBridgeMaxImages, Ready: ready, PromptOptimizationReady: promptReady,
		ImageCapabilities: clonePSBridgeImageCapabilities(input.ImageCapabilities),
		PromptProviderLabel: func() string {
			if input.PromptProfile == nil {
				return ""
			}
			return input.PromptProfile.Label
		}(),
	}
}

func psBridgeSupportsMask(input PSBridgeProfileInput) bool {
	if input.APIMode == "responses" {
		return true
	}
	if input.APIMode != "images" || input.ImagesNewAPICompat {
		return false
	}
	baseURL := strings.TrimRight(strings.ToLower(strings.TrimSpace(input.BaseURL)), "/")
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	return baseURL != "https://www.fhl.mom"
}

var psBridgeAspectPresetSet = map[string]bool{
	"1:1": true, "3:2": true, "2:3": true, "4:3": true, "3:4": true,
	"5:4": true, "4:5": true, "16:9": true, "9:16": true, "2:1": true,
	"1:2": true, "3:1": true, "1:3": true, "7:4": true, "4:7": true,
	"21:9": true, "9:21": true,
}

var psBridgeResolutionPresetSet = map[string]bool{"1k": true, "2k": true, "4k": true}

type psBridgeCanvasSize struct {
	Width  int
	Height int
}

var psBridgeCanvasMatrix = map[string]map[string]psBridgeCanvasSize{
	"1:1":  {"1k": {1024, 1024}, "2k": {2048, 2048}, "4k": {2880, 2880}},
	"3:2":  {"1k": {1536, 1024}, "2k": {2048, 1360}, "4k": {3520, 2352}},
	"2:3":  {"1k": {1024, 1536}, "2k": {1360, 2048}, "4k": {2352, 3520}},
	"4:3":  {"1k": {1536, 1152}, "2k": {2048, 1536}, "4k": {3840, 2880}},
	"3:4":  {"1k": {1152, 1536}, "2k": {1536, 2048}, "4k": {2880, 3840}},
	"5:4":  {"1k": {1520, 1216}, "2k": {2040, 1632}, "4k": {3840, 3072}},
	"4:5":  {"1k": {1216, 1520}, "2k": {1632, 2040}, "4k": {3072, 3840}},
	"16:9": {"1k": {1536, 864}, "2k": {2048, 1152}, "4k": {3840, 2160}},
	"9:16": {"1k": {864, 1536}, "2k": {1152, 2048}, "4k": {2160, 3840}},
	"2:1":  {"1k": {1536, 768}, "2k": {2048, 1024}, "4k": {3840, 1920}},
	"1:2":  {"1k": {768, 1536}, "2k": {1024, 2048}, "4k": {1920, 3840}},
	"3:1":  {"1k": {1536, 512}, "2k": {2040, 680}, "4k": {3840, 1280}},
	"1:3":  {"1k": {512, 1536}, "2k": {680, 2040}, "4k": {1280, 3840}},
	"7:4":  {"1k": {1664, 944}, "2k": {2208, 1264}, "4k": {3808, 2176}},
	"4:7":  {"1k": {944, 1664}, "2k": {1264, 2208}, "4k": {2176, 3808}},
}

var psBridgeResolutionLongEdge = map[string]int{"1k": 1536, "2k": 2048, "4k": 3840}

func psBridgeStandardCanvas(aspect, resolution string) (psBridgeCanvasSize, bool) {
	if byResolution := psBridgeCanvasMatrix[aspect]; byResolution != nil {
		if size, ok := byResolution[resolution]; ok {
			return size, true
		}
	}
	left, right, ok := strings.Cut(aspect, ":")
	if !ok {
		return psBridgeCanvasSize{}, false
	}
	widthRatio, widthErr := strconv.Atoi(left)
	heightRatio, heightErr := strconv.Atoi(right)
	longEdge, resolutionOK := psBridgeResolutionLongEdge[resolution]
	if widthErr != nil || heightErr != nil || widthRatio <= 0 || heightRatio <= 0 || !resolutionOK {
		return psBridgeCanvasSize{}, false
	}
	ratio := float64(widthRatio) / float64(heightRatio)
	roundToEight := func(value float64) int {
		return max(8, int(math.Round(value/8))*8)
	}
	if ratio >= 1 {
		return psBridgeCanvasSize{Width: longEdge, Height: roundToEight(float64(longEdge) / ratio)}, true
	}
	return psBridgeCanvasSize{Width: roundToEight(float64(longEdge) * ratio), Height: longEdge}, true
}

func defaultPSBridgeImageCapabilities(apiMode string) PSBridgeImageCapabilities {
	aspects := []string{"1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "7:4", "4:7"}
	capabilities := PSBridgeImageCapabilities{
		AspectPresets: aspects, ResolutionPresets: []string{"1k", "2k", "4k"},
		QualityControl: apiMode == "responses" || apiMode == "images", SizeEncoding: "pixels",
	}
	if apiMode == "apimart" {
		capabilities.AspectPresets = []string{"1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"}
		capabilities.SizeEncoding = "ratio-resolution"
	}
	if apiMode == "runninghub" {
		capabilities.AspectPresets = []string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"}
		capabilities.SizeEncoding = "ratio-resolution"
	}
	return capabilities
}

func normalizePSBridgeImageCapabilities(input PSBridgeImageCapabilities, apiMode string) (PSBridgeImageCapabilities, error) {
	missing := len(input.AspectPresets) == 0 && len(input.ResolutionPresets) == 0 && strings.TrimSpace(input.SizeEncoding) == ""
	defaults := defaultPSBridgeImageCapabilities(apiMode)
	if missing {
		return defaults, nil
	}
	clean := PSBridgeImageCapabilities{QualityControl: input.QualityControl && defaults.QualityControl}
	allowedAspects := map[string]bool{}
	for _, value := range defaults.AspectPresets {
		allowedAspects[value] = true
	}
	seenAspects := map[string]bool{}
	for _, raw := range input.AspectPresets {
		value := strings.ToLower(strings.TrimSpace(raw))
		if !psBridgeAspectPresetSet[value] {
			return PSBridgeImageCapabilities{}, fmt.Errorf("unsupported Photoshop aspect preset: %s", value)
		}
		if !allowedAspects[value] {
			return PSBridgeImageCapabilities{}, fmt.Errorf("Photoshop aspect preset %s is unavailable for %s", value, apiMode)
		}
		if !seenAspects[value] {
			seenAspects[value] = true
			clean.AspectPresets = append(clean.AspectPresets, value)
		}
	}
	seenResolutions := map[string]bool{}
	for _, raw := range input.ResolutionPresets {
		value := strings.ToLower(strings.TrimSpace(raw))
		if !psBridgeResolutionPresetSet[value] {
			return PSBridgeImageCapabilities{}, fmt.Errorf("unsupported Photoshop resolution preset: %s", value)
		}
		if !seenResolutions[value] {
			seenResolutions[value] = true
			clean.ResolutionPresets = append(clean.ResolutionPresets, value)
		}
	}
	if len(clean.AspectPresets) == 0 || len(clean.ResolutionPresets) == 0 {
		return PSBridgeImageCapabilities{}, errors.New("Photoshop image capabilities are empty")
	}
	clean.SizeEncoding = strings.ToLower(strings.TrimSpace(input.SizeEncoding))
	expectedEncoding := defaults.SizeEncoding
	if clean.SizeEncoding != expectedEncoding {
		return PSBridgeImageCapabilities{}, fmt.Errorf("Photoshop size encoding must be %s", expectedEncoding)
	}
	return clean, nil
}

func clonePSBridgeImageCapabilities(input PSBridgeImageCapabilities) PSBridgeImageCapabilities {
	input.AspectPresets = append([]string(nil), input.AspectPresets...)
	input.ResolutionPresets = append([]string(nil), input.ResolutionPresets...)
	return input
}

var psBridgeCredentialPattern = regexp.MustCompile(`(?i)\b(?:sk|msk|key|sess)-[A-Za-z0-9._-]{8,}\b`)

func sanitizePSBridgeError(err error) string {
	message := strings.TrimSpace(fmt.Sprint(err))
	message = psBridgeCredentialPattern.ReplaceAllString(message, "[redacted]")
	if len(message) > 1000 {
		message = message[:1000]
	}
	if message == "" {
		return "请求失败"
	}
	return message
}

func saveBridgeMultipartImageValidated(header *multipart.FileHeader, dir string, index int) (string, validatedImageData, error) {
	validated, err := readBridgeMultipartImage(header)
	if err != nil {
		return "", validatedImageData{}, fmt.Errorf("图片 %s 无效: %w", filepath.Base(header.Filename), err)
	}
	stem := sanitiseName(header.Filename)
	name := fmt.Sprintf("%02d-%s%s", index+1, stem, validated.Extension)
	path, err := writeImageBytes(validated.Bytes, filepath.Join(dir, name))
	return path, validated, err
}

func saveBridgeMultipartImage(header *multipart.FileHeader, dir string, index int) (string, error) {
	path, _, err := saveBridgeMultipartImageValidated(header, dir, index)
	return path, err
}

func readBridgeMultipartImage(header *multipart.FileHeader) (validatedImageData, error) {
	file, err := header.Open()
	if err != nil {
		return validatedImageData{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, int64(client.MaxInputImageBytes)+1))
	if err != nil {
		return validatedImageData{}, err
	}
	if len(data) > client.MaxInputImageBytes {
		return validatedImageData{}, errors.New("图片超过 50MB")
	}
	return validateImageBytes(data)
}

func firstEventArg[T any](args []any) (T, bool) {
	var zero T
	if len(args) == 0 {
		return zero, false
	}
	value, ok := args[0].(T)
	return value, ok
}

func randomHex(byteCount int) (string, error) {
	data := make([]byte, byteCount)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func safeIdentifier(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 160 {
		return false
	}
	for _, r := range value {
		if r == '-' || r == '_' || r == '.' || r == ':' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			continue
		}
		return false
	}
	return true
}

func terminalPSBridgeState(state string) bool {
	return state == "succeeded" || state == "failed" || state == "cancelled"
}

func cleanBridgeChoice(value, fallback string) string {
	clean := strings.TrimSpace(value)
	if clean == "" || len(clean) > 64 || strings.ContainsAny(clean, "\r\n\x00") {
		return fallback
	}
	return clean
}

type psBridgeOutputContract struct {
	Size         string
	Quality      string
	Aspect       string
	Resolution   string
	CanvasWidth  int
	CanvasHeight int
	PreparedBase bool
}

func parsePSBridgeOutputContract(r *http.Request, profile PSBridgeProfilePublic) (psBridgeOutputContract, error) {
	contract := psBridgeOutputContract{
		Size:    cleanBridgeChoice(r.FormValue("size"), "1024x1024"),
		Quality: strings.ToLower(strings.TrimSpace(r.FormValue("quality"))),
	}
	if contract.Quality == "" {
		contract.Quality = "medium"
	}
	if contract.Quality != "auto" && contract.Quality != "low" && contract.Quality != "medium" && contract.Quality != "high" {
		return psBridgeOutputContract{}, errors.New("quality 必须是 auto、low、medium 或 high")
	}
	if !profile.ImageCapabilities.QualityControl {
		contract.Quality = "auto"
	}
	rawAspect := strings.ToLower(strings.TrimSpace(r.FormValue("aspect")))
	rawResolution := strings.ToLower(strings.TrimSpace(r.FormValue("resolution")))
	rawWidth := strings.TrimSpace(r.FormValue("canvasWidth"))
	rawHeight := strings.TrimSpace(r.FormValue("canvasHeight"))
	rawPrepared := strings.ToLower(strings.TrimSpace(r.FormValue("preparedBase")))
	if rawAspect == "" || rawResolution == "" || rawWidth == "" || rawHeight == "" {
		return psBridgeOutputContract{}, errors.New("Photoshop 输出比例、分辨率和标准画布必须同时提供")
	}
	if !containsPSBridgePreset(profile.ImageCapabilities.AspectPresets, rawAspect) {
		return psBridgeOutputContract{}, fmt.Errorf("当前上游不支持比例 %s", rawAspect)
	}
	if !containsPSBridgePreset(profile.ImageCapabilities.ResolutionPresets, rawResolution) {
		return psBridgeOutputContract{}, fmt.Errorf("当前上游不支持分辨率 %s", rawResolution)
	}
	width, err := strconv.Atoi(rawWidth)
	if err != nil || width <= 0 {
		return psBridgeOutputContract{}, errors.New("canvasWidth 无效")
	}
	height, err := strconv.Atoi(rawHeight)
	if err != nil || height <= 0 {
		return psBridgeOutputContract{}, errors.New("canvasHeight 无效")
	}
	if width > maxImagePixels/height {
		return psBridgeOutputContract{}, fmt.Errorf("标准画布超过 100MP 上限: %dx%d", width, height)
	}
	expectedCanvas, ok := psBridgeStandardCanvas(rawAspect, rawResolution)
	if !ok {
		return psBridgeOutputContract{}, fmt.Errorf("无法解析标准画布 %s/%s", rawAspect, rawResolution)
	}
	if width != expectedCanvas.Width || height != expectedCanvas.Height {
		return psBridgeOutputContract{}, fmt.Errorf(
			"标准画布 %s/%s 必须是 %dx%d",
			rawAspect, rawResolution, expectedCanvas.Width, expectedCanvas.Height,
		)
	}
	prepared := false
	if rawPrepared != "" {
		if rawPrepared != "true" && rawPrepared != "false" {
			return psBridgeOutputContract{}, errors.New("preparedBase 无效")
		}
		prepared = rawPrepared == "true"
	}
	if profile.ImageCapabilities.SizeEncoding == "ratio-resolution" {
		expected := rawAspect + "@" + rawResolution
		if strings.ToLower(contract.Size) != expected {
			return psBridgeOutputContract{}, fmt.Errorf("size 必须是 %s", expected)
		}
	} else {
		expected := fmt.Sprintf("%dx%d", width, height)
		if strings.ToLower(contract.Size) != expected {
			return psBridgeOutputContract{}, fmt.Errorf("size 必须与标准画布一致: %s", expected)
		}
	}
	contract.Aspect = rawAspect
	contract.Resolution = rawResolution
	contract.CanvasWidth = width
	contract.CanvasHeight = height
	contract.PreparedBase = prepared
	return contract, nil
}

func containsPSBridgePreset(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func cleanBridgeOutputFormat(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "jpeg", "webp":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "png"
	}
}

func parseBridgeSeed(value string) int64 {
	seed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || seed < 0 {
		return 0
	}
	return seed
}

func contentTypeForImagePath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".avif":
		return "image/avif"
	default:
		return "image/png"
	}
}

func isPSBridgeLoopbackRequest(r *http.Request) bool {
	host := strings.TrimSpace(r.Host)
	if parsed, _, err := net.SplitHostPort(host); err == nil {
		host = parsed
	}
	host = strings.Trim(strings.ToLower(host), "[]")
	if host != "localhost" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return false
		}
	}
	remote := strings.TrimSpace(r.RemoteAddr)
	if remote == "" {
		return true
	}
	if parsed, _, err := net.SplitHostPort(remote); err == nil {
		remote = parsed
	}
	ip := net.ParseIP(strings.Trim(remote, "[]"))
	return ip != nil && ip.IsLoopback()
}

func isOrdinaryWebOrigin(origin string) bool {
	origin = strings.ToLower(strings.TrimSpace(origin))
	return strings.HasPrefix(origin, "http://") || strings.HasPrefix(origin, "https://")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(true)
	_ = encoder.Encode(value)
}
