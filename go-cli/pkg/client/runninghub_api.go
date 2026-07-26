package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	runningHubDefaultBaseURL = "http://127.0.0.1:8117"
	runningHubSubmitTimeout  = 4 * time.Minute
	runningHubUploadTimeout  = 2 * time.Minute
	runningHubPollTimeout    = 15 * time.Minute
	runningHubImageTimeout   = 2 * time.Minute
)

var (
	runningHubPollInterval = 2500 * time.Millisecond
	runningHubTextAspects  = map[string]struct{}{
		"1:1": {}, "3:2": {}, "2:3": {}, "5:4": {}, "4:5": {},
		"16:9": {}, "9:16": {}, "21:9": {}, "3:4": {}, "4:3": {},
		"9:21": {}, "2:1": {}, "1:2": {}, "3:1": {}, "1:3": {},
	}
	runningHubImageAspects = map[string]struct{}{
		"1:1": {}, "16:9": {}, "9:16": {}, "4:3": {}, "3:4": {},
		"3:2": {}, "2:3": {}, "21:9": {}, "9:21": {},
	}
	runningHubSizeToAspect = map[string]string{
		"1024x1024": "1:1",
		"1536x1024": "3:2",
		"1024x1536": "2:3",
		"1536x1152": "4:3",
		"1152x1536": "3:4",
		"1520x1216": "5:4",
		"1216x1520": "4:5",
		"1536x864":  "16:9",
		"864x1536":  "9:16",
		"1536x768":  "2:1",
		"768x1536":  "1:2",
		"1536x512":  "3:1",
		"512x1536":  "1:3",
		"2048x2048": "1:1",
		"2048x1360": "3:2",
		"1360x2048": "2:3",
		"2048x1536": "4:3",
		"1536x2048": "3:4",
		"2040x1632": "5:4",
		"1632x2040": "4:5",
		"2048x1152": "16:9",
		"1152x2048": "9:16",
		"2048x1024": "2:1",
		"1024x2048": "1:2",
		"2040x680":  "3:1",
		"680x2040":  "1:3",
		"3840x2160": "16:9",
		"2160x3840": "9:16",
		"3840x1920": "2:1",
		"1920x3840": "1:2",
		"3840x1280": "3:1",
		"1280x3840": "1:3",
	}
	runningHubSizeToResolution = map[string]string{
		"1024x1024": "1k",
		"1536x1024": "1k",
		"1024x1536": "1k",
		"1536x1152": "1k",
		"1152x1536": "1k",
		"1520x1216": "1k",
		"1216x1520": "1k",
		"1536x864":  "1k",
		"864x1536":  "1k",
		"1536x768":  "1k",
		"768x1536":  "1k",
		"1536x512":  "1k",
		"512x1536":  "1k",
		"2048x2048": "2k",
		"2048x1360": "2k",
		"1360x2048": "2k",
		"2048x1536": "2k",
		"1536x2048": "2k",
		"2040x1632": "2k",
		"1632x2040": "2k",
		"2048x1152": "2k",
		"1152x2048": "2k",
		"2048x1024": "2k",
		"1024x2048": "2k",
		"2040x680":  "2k",
		"680x2040":  "2k",
		"3840x2160": "4k",
		"2160x3840": "4k",
		"3840x1920": "4k",
		"1920x3840": "4k",
		"3840x1280": "4k",
		"1280x3840": "4k",
	}
)

func runningHubAPIWithRetries(
	ctx context.Context,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
) (ImageResult, string, error) {
	if onLog == nil {
		onLog = func(string) {}
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return ImageResult{}, "", fmt.Errorf("create output dir: %w", err)
	}

	var lastErr error
	var lastPath string
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		rawPath := filepath.Join(outputDir, fmt.Sprintf("runninghub-response-%s-attempt%d.json", timestamp, attempt))
		lastPath = rawPath
		onLog(fmt.Sprintf("[RunningHub] attempt %d/%d...", attempt, MaxAttempts))

		f, err := os.OpenFile(rawPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return ImageResult{}, lastPath, fmt.Errorf("create raw response file: %w", err)
		}
		result, reqErr := RequestRunningHub(ctx, opts, f, onProgress)
		f.Close()
		if reqErr == nil {
			return result, rawPath, nil
		}
		if isResponseLimitError(reqErr) {
			return ImageResult{}, rawPath, reqErr
		}

		lastErr = reqErr
		raw := readDiagnosticResponseFile(rawPath)
		if attempt < MaxAttempts && (IsRetryable(raw) || isTransportishError(reqErr)) {
			onLog(fmt.Sprintf("%v", reqErr))
			onLog(fmt.Sprintf("Auto retrying in %d seconds...", RetryBackoffSeconds))
			if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
				return ImageResult{}, lastPath, ctx.Err()
			}
			continue
		}
		return ImageResult{}, lastPath, reqErr
	}

	return ImageResult{}, lastPath, fmt.Errorf("request failed after retries: %w", lastErr)
}

func RequestRunningHub(
	ctx context.Context,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
) (ImageResult, error) {
	if strings.TrimSpace(opts.Prompt) == "" {
		return ImageResult{}, ErrEmptyPrompt
	}

	baseURL := strings.TrimSpace(opts.BaseURL)
	if baseURL == "" {
		baseURL = runningHubDefaultBaseURL
	}
	baseURL, err := ValidateBaseURL(baseURL)
	if err != nil {
		return ImageResult{}, err
	}

	httpClient, err := newRunningHubHTTPClient(opts.Proxy)
	if err != nil {
		return ImageResult{}, err
	}

	startedAt := time.Now()
	report := func(stage string, bytes int64) {
		if onProgress != nil {
			onProgress(stage, int(time.Since(startedAt).Seconds()), bytes)
		}
	}

	mode := runningHubModeForOptions(opts)
	aspect, resolution := runningHubAspectAndResolution(opts.Size, mode)
	imageURLs := []string{}
	if mode == "image-to-image" {
		paths := opts.imageSourcePathsForEdit()
		if len(paths) == 0 {
			return ImageResult{}, errors.New("edit mode requires at least one --image for RunningHub")
		}
		for i, path := range paths {
			report(fmt.Sprintf("RunningHub uploading source %d/%d", i+1, len(paths)), 0)
			uploadedURL, err := uploadRunningHubImage(ctx, httpClient, baseURL, path, rawSink, i+1)
			if err != nil {
				return ImageResult{}, err
			}
			imageURLs = append(imageURLs, uploadedURL)
		}
	}

	report("RunningHub submitting async task", 0)
	taskID, images, err := submitRunningHubTask(ctx, httpClient, baseURL, opts, mode, aspect, resolution, imageURLs, rawSink)
	if err != nil {
		return ImageResult{}, err
	}
	if len(images) == 0 {
		if taskID == "" {
			return ImageResult{}, errors.New("RunningHub bridge did not return task id or image results")
		}
		images, err = pollRunningHubTask(ctx, httpClient, baseURL, taskID, rawSink, func(status string) {
			stage := fmt.Sprintf("RunningHub polling task %s", taskID)
			if status != "" {
				stage += " (" + status + ")"
			}
			report(stage, 0)
		})
		if err != nil {
			return ImageResult{}, err
		}
	}
	if len(images) == 0 {
		return ImageResult{}, ErrNoImageInResponse
	}

	report("RunningHub downloading final image", 0)
	imageB64, err := runningHubImageValueToBase64(ctx, httpClient, baseURL, images[0], rawSink)
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{ImageB64: imageB64, SourceEvent: "runninghub_async"}, nil
}

func newRunningHubHTTPClient(proxy ProxyConfig) (*http.Client, error) {
	transport, err := NewHTTPTransport(proxy)
	if err != nil {
		return nil, err
	}
	transport.DisableCompression = false
	transport.MaxIdleConnsPerHost = 4
	transport.ResponseHeaderTimeout = 60 * time.Second
	return &http.Client{Transport: transport}, nil
}

func uploadRunningHubImage(
	ctx context.Context,
	httpClient *http.Client,
	baseURL string,
	path string,
	rawSink io.Writer,
	index int,
) (string, error) {
	cleanPath, err := NormalizePath(path)
	if err != nil {
		return "", err
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		return "", fmt.Errorf("open source image: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("stat source image: %w", err)
	}
	if info.Size() > MaxInputImageBytes {
		return "", fmt.Errorf("source image exceeds %d bytes", MaxInputImageBytes)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", filepath.Base(cleanPath))
	if err != nil {
		return "", fmt.Errorf("create multipart file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", fmt.Errorf("attach source image: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("finalize multipart body: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, runningHubUploadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, runningHubEndpoint(baseURL, "/api/upload"), &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("User-Agent", UserAgent())

	response, err := httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	data, err := readRunningHubJSONResponse(response, rawSink, fmt.Sprintf("upload-%d", index))
	if err != nil {
		return "", err
	}
	if url := firstStringForKeys(data, "imageUrl", "url"); url != "" {
		return url, nil
	}
	images := collectRunningHubImageValues(data)
	if len(images) > 0 {
		return images[0].URL, nil
	}
	return "", errors.New("RunningHub upload response did not contain imageUrl")
}

func submitRunningHubTask(
	ctx context.Context,
	httpClient *http.Client,
	baseURL string,
	opts Options,
	mode string,
	aspect string,
	resolution string,
	imageURLs []string,
	rawSink io.Writer,
) (string, []runningHubImageValue, error) {
	payload := map[string]any{
		"model":        normalizeRunningHubModel(opts.ImageModelID),
		"mode":         mode,
		"prompt":       opts.Prompt,
		"aspect_ratio": aspect,
		"resolution":   resolution,
	}
	if mode == "image-to-image" {
		payload["image_urls"] = imageURLs
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", nil, fmt.Errorf("marshal RunningHub payload: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, runningHubSubmitTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, runningHubEndpoint(baseURL, "/api/generate"), bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", UserAgent())

	response, err := httpClient.Do(request)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()

	data, err := readRunningHubJSONResponse(response, rawSink, "submit")
	if err != nil {
		return "", nil, err
	}
	taskID := extractRunningHubTaskID(data)
	status := runningHubStatusFromPayload(data)
	images := collectRunningHubResultImageValues(data)
	if taskID != "" && !runningHubIsSuccessStatus(status) {
		images = nil
	}
	return taskID, images, nil
}

func pollRunningHubTask(
	ctx context.Context,
	httpClient *http.Client,
	baseURL string,
	taskID string,
	rawSink io.Writer,
	report func(status string),
) ([]runningHubImageValue, error) {
	deadline := time.Now().Add(runningHubPollTimeout)
	for time.Now().Before(deadline) {
		if !sleepCtx(ctx, runningHubPollInterval) {
			return nil, ctx.Err()
		}

		requestCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, runningHubEndpoint(baseURL, "/api/task")+"?id="+url.QueryEscape(taskID), nil)
		if err != nil {
			cancel()
			return nil, err
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", UserAgent())

		response, err := httpClient.Do(request)
		if err != nil {
			cancel()
			return nil, err
		}
		data, readErr := readRunningHubJSONResponse(response, rawSink, "poll")
		response.Body.Close()
		cancel()
		if readErr != nil {
			return nil, readErr
		}

		status := runningHubStatusFromPayload(data)
		if report != nil {
			report(status)
		}
		if images := collectRunningHubResultImageValues(data); len(images) > 0 {
			return images, nil
		}
		if runningHubIsSuccessStatus(status) {
			return nil, errors.New("RunningHub task completed without any image output")
		}
		if runningHubIsFailureStatus(status) {
			message := firstRunningHubErrorMessage(data)
			if message == "" {
				message = "RunningHub task failed: " + status
			}
			return nil, errors.New(message)
		}
	}
	return nil, fmt.Errorf("RunningHub task timed out: %s", taskID)
}

func runningHubImageValueToBase64(ctx context.Context, httpClient *http.Client, baseURL string, value runningHubImageValue, rawSink io.Writer) (string, error) {
	if value.DataURL != "" {
		return dataURLPayload(value.DataURL)
	}
	if value.URL == "" {
		return "", ErrNoImageInResponse
	}
	requestCtx, cancel := context.WithTimeout(ctx, runningHubImageTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, runningHubEndpoint(baseURL, "/api/image")+"?url="+url.QueryEscape(value.URL), nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "image/*,*/*;q=0.8")
	request.Header.Set("User-Agent", UserAgent())

	response, err := httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	if response.StatusCode/100 == 2 && (strings.HasPrefix(contentType, "image/") || strings.HasPrefix(contentType, "application/octet-stream")) {
		if rawSink != nil {
			if _, err := fmt.Fprintf(rawSink, "=== image (%d) ===\n[binary body omitted]\n", response.StatusCode); err != nil {
				return "", fmt.Errorf("write raw response: %w", err)
			}
		}
		encoded, err := readHTTPResponseBase64(response)
		if err != nil {
			return "", fmt.Errorf("read RunningHub image proxy response: %w", err)
		}
		if encoded == "" {
			return "", errors.New("RunningHub image proxy returned empty image")
		}
		return encoded, nil
	}

	rawBytes, err := readHTTPResponseBody(response)
	if err != nil {
		return "", fmt.Errorf("read RunningHub image proxy response: %w", err)
	}
	if rawSink != nil {
		if _, err := fmt.Fprintf(rawSink, "=== image (%d) ===\n", response.StatusCode); err != nil {
			return "", fmt.Errorf("write raw response: %w", err)
		}
		preview := rawBytes
		if len(preview) > 2048 {
			preview = preview[:2048]
		}
		if _, err := rawSink.Write(preview); err != nil {
			return "", fmt.Errorf("write raw response: %w", err)
		}
		if _, err := io.WriteString(rawSink, "\n"); err != nil {
			return "", fmt.Errorf("write raw response: %w", err)
		}
	}
	if response.StatusCode/100 != 2 {
		return "", fmt.Errorf("RunningHub image proxy failed: HTTP %d: %s", response.StatusCode, limitText(string(rawBytes), 400))
	}
	if len(rawBytes) == 0 {
		return "", errors.New("RunningHub image proxy returned empty image")
	}
	if strings.HasPrefix(strings.TrimSpace(string(rawBytes)), "{") {
		var data map[string]any
		if err := json.Unmarshal(rawBytes, &data); err == nil {
			if images := collectRunningHubImageValues(data); len(images) > 0 && images[0].DataURL != "" {
				return dataURLPayload(images[0].DataURL)
			}
		}
	}
	return base64.StdEncoding.EncodeToString(rawBytes), nil
}

func readRunningHubJSONResponse(response *http.Response, rawSink io.Writer, label string) (map[string]any, error) {
	rawBytes, err := readHTTPResponseBody(response)
	if err != nil {
		return nil, fmt.Errorf("read RunningHub %s response: %w", label, err)
	}
	if rawSink != nil {
		if _, err := fmt.Fprintf(rawSink, "=== %s (%d) ===\n", label, response.StatusCode); err != nil {
			return nil, fmt.Errorf("write raw response: %w", err)
		}
		if len(rawBytes) > 0 {
			if _, err := rawSink.Write(rawBytes); err != nil {
				return nil, fmt.Errorf("write raw response: %w", err)
			}
		}
		if _, err := io.WriteString(rawSink, "\n"); err != nil {
			return nil, fmt.Errorf("write raw response: %w", err)
		}
	}

	data := map[string]any{}
	trimmed := strings.TrimSpace(string(rawBytes))
	if trimmed != "" {
		if err := json.Unmarshal(rawBytes, &data); err != nil {
			if response.StatusCode/100 != 2 {
				return nil, fmt.Errorf("RunningHub %s returned HTTP %d: %s", label, response.StatusCode, limitText(trimmed, 400))
			}
			return nil, fmt.Errorf("parse RunningHub %s JSON: %w", label, err)
		}
	}
	if response.StatusCode/100 != 2 {
		message := firstRunningHubErrorMessage(data)
		if message == "" {
			message = limitText(trimmed, 400)
		}
		if message == "" {
			message = fmt.Sprintf("HTTP %d", response.StatusCode)
		}
		return nil, fmt.Errorf("RunningHub %s returned HTTP %d: %s", label, response.StatusCode, message)
	}
	if ok, exists := data["ok"].(bool); exists && !ok {
		message := firstRunningHubErrorMessage(data)
		if message == "" {
			message = "ok=false"
		}
		return nil, fmt.Errorf("RunningHub %s error: %s", label, message)
	}
	return data, nil
}

func runningHubEndpoint(baseURL string, path string) string {
	root := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasPrefix(path, "/") {
		return root + path
	}
	return root + "/" + path
}

func runningHubModeForOptions(opts Options) string {
	if opts.Mode == ModeEdit {
		return "image-to-image"
	}
	return "text-to-image"
}

func normalizeRunningHubModel(modelID string) string {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	if strings.Contains(normalized, "g2") {
		return "image_g2"
	}
	return "banana2"
}

func runningHubAspectAndResolution(size string, mode string) (string, string) {
	normalized := strings.ToLower(strings.TrimSpace(size))
	if aspect, resolution, ok := parseRunningHubCompactSize(normalized, mode); ok {
		return aspect, resolution
	}
	aspect := runningHubSizeToAspect[normalized]
	if aspect == "" || !runningHubAspectSupported(aspect, mode) {
		aspect = nearestRunningHubAspect(normalized, mode)
	}
	resolution := runningHubSizeToResolution[normalized]
	if resolution == "" {
		resolution = runningHubResolutionForSize(normalized)
	}
	return aspect, resolution
}

func parseRunningHubCompactSize(value string, mode string) (string, string, bool) {
	if value == "" {
		return "", "", false
	}
	parts := strings.Split(value, "@")
	aspect := parts[0]
	if !runningHubAspectSupported(aspect, mode) {
		return "", "", false
	}
	resolution := "1k"
	if len(parts) > 1 {
		resolution = parts[1]
	}
	if resolution != "1k" && resolution != "2k" && resolution != "4k" {
		return "", "", false
	}
	return aspect, resolution, true
}

func runningHubAspectSupported(aspect string, mode string) bool {
	if mode == "image-to-image" {
		_, ok := runningHubImageAspects[aspect]
		return ok
	}
	_, ok := runningHubTextAspects[aspect]
	return ok
}

func nearestRunningHubAspect(size string, mode string) string {
	parsed := parseSizeValue(size)
	if parsed == nil || parsed.width <= 0 || parsed.height <= 0 {
		return "1:1"
	}
	ratio := float64(parsed.width) / float64(parsed.height)
	bestAspect := "1:1"
	bestDistance := 9999.0
	candidates := runningHubTextAspects
	if mode == "image-to-image" {
		candidates = runningHubImageAspects
	}
	for aspect := range candidates {
		parts := strings.Split(aspect, ":")
		if len(parts) != 2 {
			continue
		}
		candidateWidth := parsePositiveInt(parts[0])
		candidateHeight := parsePositiveInt(parts[1])
		if candidateWidth == 0 || candidateHeight == 0 {
			continue
		}
		candidateRatio := float64(candidateWidth) / float64(candidateHeight)
		distance := candidateRatio - ratio
		if distance < 0 {
			distance = -distance
		}
		if distance < bestDistance {
			bestDistance = distance
			bestAspect = aspect
		}
	}
	return bestAspect
}

func runningHubResolutionForSize(size string) string {
	parsed := parseSizeValue(size)
	if parsed == nil {
		return "1k"
	}
	maxSide := parsed.width
	if parsed.height > maxSide {
		maxSide = parsed.height
	}
	switch {
	case maxSide > 2048:
		return "4k"
	case maxSide > 1536:
		return "2k"
	default:
		return "1k"
	}
}

type runningHubImageValue struct {
	URL     string
	DataURL string
}

func collectRunningHubImageValues(value any) []runningHubImageValue {
	out := []runningHubImageValue{}
	seen := map[string]struct{}{}
	var add = func(item runningHubImageValue) {
		key := item.DataURL
		if key == "" {
			key = item.URL
		}
		key = strings.TrimSpace(key)
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	var visit func(any, string, int)
	visit = func(current any, key string, depth int) {
		if depth > 8 {
			return
		}
		switch typed := current.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				return
			}
			lower := strings.ToLower(trimmed)
			lowerKey := strings.ToLower(key)
			if strings.HasPrefix(lower, "data:image/") {
				add(runningHubImageValue{DataURL: trimmed})
			} else if (strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")) &&
				(key == "" || strings.Contains(lowerKey, "url") || strings.Contains(lowerKey, "image") || strings.Contains(lowerKey, "output") || strings.Contains(lowerKey, "src")) {
				add(runningHubImageValue{URL: trimmed})
			}
		case []any:
			for _, child := range typed {
				visit(child, key, depth+1)
			}
		case map[string]any:
			if dataURL, ok := typed["dataUrl"].(string); ok && strings.TrimSpace(dataURL) != "" {
				add(runningHubImageValue{DataURL: strings.TrimSpace(dataURL)})
			}
			if dataURL, ok := typed["data_url"].(string); ok && strings.TrimSpace(dataURL) != "" {
				add(runningHubImageValue{DataURL: strings.TrimSpace(dataURL)})
			}
			if imageURL, ok := typed["url"].(string); ok && strings.TrimSpace(imageURL) != "" {
				add(runningHubImageValue{URL: strings.TrimSpace(imageURL)})
			}
			for childKey, childValue := range typed {
				visit(childValue, childKey, depth+1)
			}
		}
	}
	visit(value, "", 0)
	return out
}

func collectRunningHubResultImageValues(value any) []runningHubImageValue {
	out := []runningHubImageValue{}
	seen := map[string]struct{}{}
	var add = func(item runningHubImageValue) {
		key := item.DataURL
		if key == "" {
			key = item.URL
		}
		key = strings.TrimSpace(key)
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	var visit func(any, string, int)
	visit = func(current any, key string, depth int) {
		if depth > 8 || runningHubSourceImageKey(key) {
			return
		}
		switch typed := current.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				return
			}
			lower := strings.ToLower(trimmed)
			lowerKey := strings.ToLower(key)
			if strings.HasPrefix(lower, "data:image/") {
				add(runningHubImageValue{DataURL: trimmed})
			} else if (strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")) &&
				runningHubResultURLKey(lowerKey) {
				add(runningHubImageValue{URL: trimmed})
			}
		case []any:
			for _, child := range typed {
				visit(child, key, depth+1)
			}
		case map[string]any:
			if dataURL, ok := typed["dataUrl"].(string); ok && strings.TrimSpace(dataURL) != "" {
				add(runningHubImageValue{DataURL: strings.TrimSpace(dataURL)})
			}
			if dataURL, ok := typed["data_url"].(string); ok && strings.TrimSpace(dataURL) != "" {
				add(runningHubImageValue{DataURL: strings.TrimSpace(dataURL)})
			}
			if imageURL, ok := typed["url"].(string); ok && strings.TrimSpace(imageURL) != "" && runningHubResultURLKey(key) {
				add(runningHubImageValue{URL: strings.TrimSpace(imageURL)})
			}
			for childKey, childValue := range typed {
				visit(childValue, childKey, depth+1)
			}
		}
	}
	visit(value, "", 0)
	return out
}

func runningHubSourceImageKey(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "imageurls", "image_urls", "submittedrequest", "submitted_request", "upload", "uploads":
		return true
	default:
		return false
	}
}

func runningHubResultURLKey(key string) bool {
	lower := strings.ToLower(strings.TrimSpace(key))
	return lower == "" ||
		strings.Contains(lower, "url") ||
		strings.Contains(lower, "image") ||
		strings.Contains(lower, "output") ||
		strings.Contains(lower, "result") ||
		strings.Contains(lower, "src")
}

func extractRunningHubTaskID(value any) string {
	var visit func(any, int) string
	visit = func(current any, depth int) string {
		if depth > 8 {
			return ""
		}
		if list, ok := current.([]any); ok {
			for _, child := range list {
				if nested := visit(child, depth+1); nested != "" {
					return nested
				}
			}
			return ""
		}
		record, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		for _, key := range []string{"id", "task_id", "taskId"} {
			if str, ok := record[key].(string); ok && strings.TrimSpace(str) != "" {
				return strings.TrimSpace(str)
			}
		}
		for _, child := range record {
			if nested := visit(child, depth+1); nested != "" {
				return nested
			}
		}
		return ""
	}
	return visit(value, 0)
}

func runningHubStatusFromPayload(value any) string {
	return strings.ToLower(strings.TrimSpace(firstStringForKeys(value, "status", "state")))
}

func runningHubIsSuccessStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "succeeded", "success", "completed", "complete", "done", "finished", "ok":
		return true
	default:
		return false
	}
}

func runningHubIsFailureStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "failed", "fail", "error", "cancelled", "canceled", "rejected":
		return true
	default:
		return false
	}
}

func firstRunningHubErrorMessage(value any) string {
	message := firstAPIMartErrorMessage(value)
	if message != "" {
		return message
	}
	if str := firstStringForKeys(value, "message", "msg", "error"); str != "" {
		return str
	}
	if code, ok := numberFromAny(value); ok && code >= 400 {
		return fmt.Sprintf("code %d", code)
	}
	return ""
}
