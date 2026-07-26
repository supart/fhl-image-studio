package backend

import "strings"

// --- UI-facing types -------------------------------------------------------

// GenerateOptions is the request shape sent by the frontend.
// Fields mirror client.Options but with friendlier names for TS.
type GenerateOptions struct {
	APIKey string `json:"apiKey"`
	Mode   string `json:"mode"` // "generate" | "edit"
	// RequestedJobID allows the frontend to pre-bind event listeners before
	// dispatching the request, avoiding a race where a very fast result event
	// arrives before the UI has attached `result:<jobId>` handlers.
	RequestedJobID string `json:"requestedJobId"`
	Prompt         string `json:"prompt"`
	Size           string `json:"size"`
	Quality        string `json:"quality"`
	// OutputFormat:"png" | "jpeg" | "webp"。空时回退到 client.OutputFormat 默认("png")。
	OutputFormat string `json:"outputFormat"`

	// Multi-reference: zero or more source images for edit mode. Each is a
	// path on disk (frontend writes imports / generated PNGs to disk so we
	// can avoid pushing large base64 across the JSON bridge).
	ImagePaths []string `json:"imagePaths"`

	// Deprecated single-image path, kept for backward compat with older
	// frontend builds. Folded into ImagePaths when present.
	ImagePath string `json:"imagePath"`

	MaskB64        string `json:"maskB64"`        // optional, phase 3 reservation
	Seed           int64  `json:"seed"`           // 0 = random
	NegativePrompt string `json:"negativePrompt"` // optional
	BaseURL        string `json:"baseURL"`        // overrides the default upstream URL
	TextModelID    string `json:"textModelID"`    // overrides the default text model
	ImageModelID   string `json:"imageModelID"`   // overrides the default image model
	APIMode        string `json:"apiMode"`        // "responses" (default) | "images"
	// APIProfileID is a non-sensitive profile identifier used only to isolate
	// desktop concurrency buckets. It is never forwarded upstream.
	APIProfileID       string `json:"apiProfileId"`
	RequestPolicy      string `json:"requestPolicy"` // "openai" (default) | "compat"
	ImagesNewAPICompat bool   `json:"imagesNewAPICompat"`
	ProxyMode          string `json:"proxyMode"` // "none" | "system" (default) | "custom"
	ProxyURL           string `json:"proxyURL"`  // http(s) proxy URL when ProxyMode == "custom"
	// NoPromptRevision is kept for backward compatibility; Responses API
	// requests now always ask the text model to keep the prompt verbatim.
	NoPromptRevision bool `json:"noPromptRevision"`
	// ConcurrencyLimit is enforced per APIProfileID when provided; callers
	// without one retain the legacy per-APIMode bucket. 0 means unlimited.
	ConcurrencyLimit int `json:"concurrencyLimit"`
	// PartialImages controls Responses API stream preview count. 0 keeps the app default.
	PartialImages int `json:"partialImages"`
}

// PromptOptimizeOptions is the request shape for one-click prompt revision.
type PromptOptimizeOptions struct {
	APIKey               string   `json:"apiKey"`
	Prompt               string   `json:"prompt"`
	OptimizationGuidance string   `json:"optimizationGuidance"`
	Mode                 string   `json:"mode"`
	BaseURL              string   `json:"baseURL"`
	TextModelID          string   `json:"textModelID"`
	ProxyMode            string   `json:"proxyMode"`
	ProxyURL             string   `json:"proxyURL"`
	ImagePaths           []string `json:"imagePaths"`
	ImagePath            string   `json:"imagePath"`
}

// PromptReverseOptions is the request shape for image-to-prompt description.
type PromptReverseOptions struct {
	APIKey      string   `json:"apiKey"`
	BaseURL     string   `json:"baseURL"`
	TextModelID string   `json:"textModelID"`
	ProxyMode   string   `json:"proxyMode"`
	ProxyURL    string   `json:"proxyURL"`
	ImagePaths  []string `json:"imagePaths"`
	ImagePath   string   `json:"imagePath"`
}

// ProbeUpstreamOptions is used by the UI's connection-test button. Validation
// and the actual /v1/models request are intentionally host-side so browser and
// WebView quirks do not decide whether a channel is alive.
type ProbeUpstreamOptions struct {
	APIKey    string `json:"apiKey"`
	BaseURL   string `json:"baseURL"`
	ProxyMode string `json:"proxyMode"`
	ProxyURL  string `json:"proxyURL"`
}

type ProbeUpstreamResult struct {
	ModelCount int `json:"modelCount"`
}

func (o PromptOptimizeOptions) collectPaths() []string {
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

func (o PromptReverseOptions) collectPaths() []string {
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

// JobStarted is the response to Generate/Edit.
type JobStarted struct {
	JobID string `json:"jobId"`
}

// ProgressPayload is emitted as `progress:<jobId>` events.
type ProgressPayload struct {
	Stage   string `json:"stage"`
	Elapsed int    `json:"elapsed"`
	Bytes   int64  `json:"bytes"`
}

// ResultPayload is emitted as `result:<jobId>`.
type ResultPayload struct {
	ImageB64      string `json:"imageB64,omitempty"`
	RevisedPrompt string `json:"revisedPrompt"`
	SourceEvent   string `json:"sourceEvent"`
	ImageID       string `json:"imageId,omitempty"`
	SavedPath     string `json:"savedPath"` // absolute path in user config dir
	ThumbPath     string `json:"thumbPath,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	FullURL       string `json:"fullUrl,omitempty"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
	PreviewWidth  int    `json:"previewWidth,omitempty"`
	PreviewHeight int    `json:"previewHeight,omitempty"`
	RawPath       string `json:"rawPath"` // raw SSE dump location
	Mode          string `json:"mode"`
	Prompt        string `json:"prompt"`
}

// PreviewPayload is emitted as `preview:<jobId>` while Responses API streams
// intermediate image-generation previews.
type PreviewPayload struct {
	ImageB64          string `json:"imageB64,omitempty"` // legacy/browser fallback only; Wails preview events use PreviewURL.
	ImageID           string `json:"imageId,omitempty"`
	PreviewURL        string `json:"previewUrl,omitempty"`
	PreviewWidth      int    `json:"previewWidth,omitempty"`
	PreviewHeight     int    `json:"previewHeight,omitempty"`
	RevisedPrompt     string `json:"revisedPrompt,omitempty"`
	PartialImageIndex int    `json:"partialImageIndex"`
	Mode              string `json:"mode"`
	Prompt            string `json:"prompt"`
}

// ErrorPayload is emitted as `error:<jobId>` when a run fails.
// RawPath 指向 sse-response-*.txt / images-response-*.json,前端用「查看日志」
// 按钮调 OpenFile 把它在系统默认应用里打开。请求还没真正发出去就失败时(例如
// 参数校验阶段)RawPath 为空。
type ErrorPayload struct {
	Message string `json:"message"`
	RawPath string `json:"rawPath,omitempty"`
}

// SelectFileResponse is returned by OpenImageDialog. New Wails builds return a
// managed previewUrl; ImageB64 remains only as a legacy/browser fallback when
// preview generation is unavailable. Files over 50MB omit both preview forms.
type SelectFileResponse struct {
	Path          string `json:"path"`
	Name          string `json:"name,omitempty"`
	Size          int64  `json:"size"`
	ImageB64      string `json:"imageB64,omitempty"`
	ImageID       string `json:"imageId,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
	PreviewWidth  int    `json:"previewWidth,omitempty"`
	PreviewHeight int    `json:"previewHeight,omitempty"`
}

type BatchInputImage struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	Size          int64  `json:"size"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	PreviewWidth  int    `json:"previewWidth,omitempty"`
	PreviewHeight int    `json:"previewHeight,omitempty"`
}

type BatchInputDirectory struct {
	Directory string            `json:"directory"`
	Images    []BatchInputImage `json:"images"`
}

type SelectFilesResponse struct {
	Files []BatchInputImage `json:"files"`
}

// ImportedImage describes a freshly imported (drag-dropped or pasted) image.
type ImportedImage struct {
	Path          string `json:"path"`
	ImageB64      string `json:"imageB64,omitempty"`
	ImageID       string `json:"imageId,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
	PreviewWidth  int    `json:"previewWidth,omitempty"`
	PreviewHeight int    `json:"previewHeight,omitempty"`
}

type MediaAssetRef struct {
	ImageID       string `json:"imageId,omitempty"`
	SavedPath     string `json:"savedPath,omitempty"`
	ThumbPath     string `json:"thumbPath,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	FullURL       string `json:"fullUrl,omitempty"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
	PreviewWidth  int    `json:"previewWidth,omitempty"`
	PreviewHeight int    `json:"previewHeight,omitempty"`
}

type MaterialOutputSyncItem struct {
	HistoryID     string `json:"historyId"`
	SavedPath     string `json:"savedPath"`
	SuggestedName string `json:"suggestedName,omitempty"`
	MissingReason string `json:"missingReason,omitempty"`
}

type MaterialOutputSyncedFile struct {
	HistoryID string `json:"historyId"`
	Source    string `json:"source"`
	Path      string `json:"path"`
}

type MaterialOutputSyncMissing struct {
	HistoryID string `json:"historyId"`
	Path      string `json:"path,omitempty"`
	Reason    string `json:"reason"`
}

type MaterialOutputSyncResult struct {
	TargetDir    string                      `json:"targetDir"`
	Synced       int                         `json:"synced"`
	Missing      int                         `json:"missing"`
	Files        []MaterialOutputSyncedFile  `json:"files"`
	MissingItems []MaterialOutputSyncMissing `json:"missingItems"`
}
