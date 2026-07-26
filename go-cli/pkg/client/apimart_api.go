package client

import (
	"bytes"
	"context"
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
	apimartDefaultModel       = "gpt-image-2"
	apimartSubmitTimeout      = 4 * time.Minute
	apimartUploadTimeout      = 2 * time.Minute
	apimartPollRequestTimeout = 60 * time.Second
	apimartPollInterval       = 3 * time.Second
	apimartTaskTimeout        = 30 * time.Minute
	apimartDownloadTimeout    = 2 * time.Minute
)

var apimartSupportedAspects = map[string]struct{}{
	"auto": {},
	"1:1":  {},
	"3:2":  {},
	"2:3":  {},
	"4:3":  {},
	"3:4":  {},
	"5:4":  {},
	"4:5":  {},
	"16:9": {},
	"9:16": {},
	"2:1":  {},
	"1:2":  {},
	"3:1":  {},
	"1:3":  {},
	"21:9": {},
	"9:21": {},
}

var apimartSizeToAspect = map[string]string{
	"auto":      "auto",
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
	"2880x2880": "1:1",
	"3456x2304": "3:2",
	"2304x3456": "2:3",
	"3840x2880": "4:3",
	"2880x3840": "3:4",
	"3840x3072": "5:4",
	"3072x3840": "4:5",
	"3840x2160": "16:9",
	"2160x3840": "9:16",
	"3840x1920": "2:1",
	"1920x3840": "1:2",
	"3840x1280": "3:1",
	"1280x3840": "1:3",
}

var apimartSizeToResolution = map[string]string{
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
	"2880x2880": "4k",
	"3456x2304": "4k",
	"2304x3456": "4k",
	"3840x2880": "4k",
	"2880x3840": "4k",
	"3840x3072": "4k",
	"3072x3840": "4k",
	"3840x2160": "4k",
	"2160x3840": "4k",
	"3840x1920": "4k",
	"1920x3840": "4k",
	"3840x1280": "4k",
	"1280x3840": "4k",
}

var apimartSuccessStatuses = map[string]struct{}{
	"success":   {},
	"succeed":   {},
	"succeeded": {},
	"completed": {},
	"complete":  {},
	"done":      {},
	"finished":  {},
	"ok":        {},
}

var apimartFailureStatuses = map[string]struct{}{
	"failed":    {},
	"fail":      {},
	"error":     {},
	"cancelled": {},
	"canceled":  {},
	"rejected":  {},
}

func apimartAPIWithRetries(
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
		rawPath := filepath.Join(outputDir, fmt.Sprintf("apimart-response-%s-attempt%d.json", timestamp, attempt))
		lastPath = rawPath
		onLog(fmt.Sprintf("[APIMart] attempt %d/%d...", attempt, MaxAttempts))

		f, err := os.OpenFile(rawPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return ImageResult{}, lastPath, fmt.Errorf("create raw response file: %w", err)
		}
		result, reqErr := RequestAPIMart(ctx, opts, f, onProgress)
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

func RequestAPIMart(
	ctx context.Context,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
) (ImageResult, error) {
	if strings.TrimSpace(opts.APIKey) == "" {
		return ImageResult{}, ErrEmptyAPIKey
	}
	if strings.TrimSpace(opts.Prompt) == "" {
		return ImageResult{}, ErrEmptyPrompt
	}

	baseURL := strings.TrimSpace(opts.BaseURL)
	if baseURL == "" {
		return ImageResult{}, errors.New("missing upstream BASE_URL for APIMart")
	}
	baseURL, err := ValidateBaseURL(baseURL)
	if err != nil {
		return ImageResult{}, err
	}

	httpClient, err := newAPIMartHTTPClient(opts.Proxy)
	if err != nil {
		return ImageResult{}, err
	}

	startedAt := time.Now()
	report := func(stage string, bytes int64) {
		if onProgress != nil {
			onProgress(stage, int(time.Since(startedAt).Seconds()), bytes)
		}
	}

	imageURLs := make([]string, 0, len(opts.ImagePaths)+1)
	if opts.Mode == ModeEdit {
		paths := opts.imageSourcePathsForEdit()
		if len(paths) == 0 {
			return ImageResult{}, errors.New("edit mode requires at least one --image for APIMart")
		}
		for i, path := range paths {
			report(fmt.Sprintf("APIMart uploading source %d/%d", i+1, len(paths)), 0)
			uploadedURL, err := uploadAPIMartImage(ctx, httpClient, baseURL, opts.APIKey, path, rawSink, i+1)
			if err != nil {
				return ImageResult{}, err
			}
			imageURLs = append(imageURLs, uploadedURL)
		}
	}

	report("APIMart submitting async task", 0)
	taskID, images, err := submitAPIMartTask(ctx, httpClient, baseURL, opts, imageURLs, rawSink)
	if err != nil {
		return ImageResult{}, err
	}
	if len(images) == 0 {
		if taskID == "" {
			return ImageResult{}, errors.New("APIMart did not return task_id or image results")
		}
		images, err = pollAPIMartTask(ctx, httpClient, baseURL, opts.APIKey, taskID, rawSink, func(status string) {
			stage := fmt.Sprintf("APIMart polling task %s", taskID)
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

	report("APIMart downloading final image", 0)
	imageB64, err := apimartImageValueToBase64(ctx, httpClient, images[0])
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{ImageB64: imageB64, SourceEvent: "apimart_async"}, nil
}

func newAPIMartHTTPClient(proxy ProxyConfig) (*http.Client, error) {
	transport, err := NewHTTPTransport(proxy)
	if err != nil {
		return nil, err
	}
	transport.DisableCompression = false
	transport.MaxIdleConnsPerHost = 4
	transport.ResponseHeaderTimeout = 60 * time.Second
	return &http.Client{Transport: transport}, nil
}

func uploadAPIMartImage(
	ctx context.Context,
	httpClient *http.Client,
	baseURL string,
	apiKey string,
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
	part, err := writer.CreateFormFile("file", filepath.Base(cleanPath))
	if err != nil {
		return "", fmt.Errorf("create multipart file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", fmt.Errorf("attach source image: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("finalize multipart body: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, apimartUploadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, apimartEndpoint(baseURL, "/v1/uploads/images"), &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("User-Agent", UserAgent())

	response, err := httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	data, err := readAPIMartJSONResponse(response, rawSink, fmt.Sprintf("upload-%d", index))
	if err != nil {
		return "", err
	}
	images := collectAPIMartImageValues(data)
	if len(images) == 0 {
		return "", errors.New("APIMart upload response did not contain an image URL")
	}
	return images[0], nil
}

func submitAPIMartTask(
	ctx context.Context,
	httpClient *http.Client,
	baseURL string,
	opts Options,
	imageURLs []string,
	rawSink io.Writer,
) (string, []string, error) {
	payload := map[string]any{
		"model":             normalizeAPIMartModel(opts.ImageModelID),
		"prompt":            opts.Prompt,
		"n":                 1,
		"size":              aspectForAPIMartSize(opts.Size),
		"resolution":        normalizeAPIMartResolution(resolutionForAPIMartSize(opts.Size), opts.ImageModelID),
		"official_fallback": false,
		"image_urls":        imageURLs,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", nil, fmt.Errorf("marshal APIMart payload: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, apimartSubmitTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, apimartEndpoint(baseURL, "/v1/images/generations"), bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	request.Header.Set("Authorization", "Bearer "+opts.APIKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", UserAgent())

	response, err := httpClient.Do(request)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()

	data, err := readAPIMartJSONResponse(response, rawSink, "submit")
	if err != nil {
		return "", nil, err
	}
	return extractAPIMartTaskID(data), collectAPIMartImageValues(data), nil
}

func pollAPIMartTask(
	ctx context.Context,
	httpClient *http.Client,
	baseURL string,
	apiKey string,
	taskID string,
	rawSink io.Writer,
	report func(status string),
) ([]string, error) {
	deadline := time.Now().Add(apimartTaskTimeout)
	for time.Now().Before(deadline) {
		if !sleepCtx(ctx, apimartPollInterval) {
			return nil, ctx.Err()
		}

		requestCtx, cancel := context.WithTimeout(ctx, apimartPollRequestTimeout)
		request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, apimartEndpoint(baseURL, "/v1/tasks/"+url.PathEscape(taskID)+"?language=zh"), nil)
		if err != nil {
			cancel()
			return nil, err
		}
		request.Header.Set("Authorization", "Bearer "+apiKey)
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", UserAgent())

		response, err := httpClient.Do(request)
		if err != nil {
			cancel()
			return nil, err
		}
		data, readErr := readAPIMartJSONResponse(response, rawSink, "poll")
		response.Body.Close()
		cancel()
		if readErr != nil {
			return nil, readErr
		}

		status := apimartStatusFromPayload(data)
		if report != nil {
			report(status)
		}
		if images := collectAPIMartImageValues(data); len(images) > 0 {
			return images, nil
		}
		if _, ok := apimartSuccessStatuses[status]; ok {
			return nil, errors.New("APIMart task completed without any image output")
		}
		if _, ok := apimartFailureStatuses[status]; ok {
			message := firstAPIMartErrorMessage(data)
			if message == "" {
				message = "APIMart task failed: " + status
			}
			return nil, errors.New(message)
		}
	}
	return nil, fmt.Errorf("APIMart task timed out: %s", taskID)
}

func apimartImageValueToBase64(ctx context.Context, httpClient *http.Client, value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", ErrNoImageInResponse
	}
	if strings.HasPrefix(strings.ToLower(trimmed), "data:image/") {
		payload, err := dataURLPayload(trimmed)
		if err != nil {
			return "", err
		}
		return payload, nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid APIMart image URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported APIMart image URL scheme: %s", parsed.Scheme)
	}

	requestCtx, cancel := context.WithTimeout(ctx, apimartDownloadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, parsed.String(), nil)
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
	if response.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return "", fmt.Errorf("APIMart image download failed: HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	encoded, err := readHTTPResponseBase64(response)
	if err != nil {
		return "", fmt.Errorf("read APIMart image: %w", err)
	}
	if encoded == "" {
		return "", errors.New("APIMart image download was empty")
	}
	return encoded, nil
}

func readAPIMartJSONResponse(response *http.Response, rawSink io.Writer, label string) (map[string]any, error) {
	rawBytes, err := readHTTPResponseBody(response)
	if err != nil {
		return nil, fmt.Errorf("read APIMart %s response: %w", label, err)
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
				return nil, fmt.Errorf("APIMart %s returned HTTP %d: %s", label, response.StatusCode, limitText(trimmed, 400))
			}
			return nil, fmt.Errorf("parse APIMart %s JSON: %w", label, err)
		}
	}
	if response.StatusCode/100 != 2 {
		message := firstAPIMartErrorMessage(data)
		if message == "" {
			message = limitText(trimmed, 400)
		}
		if message == "" {
			message = fmt.Sprintf("HTTP %d", response.StatusCode)
		}
		return nil, fmt.Errorf("APIMart %s returned HTTP %d: %s", label, response.StatusCode, message)
	}
	if code, ok := numberFromAny(data["code"]); ok && code >= 400 {
		message := firstAPIMartErrorMessage(data)
		if message == "" {
			message = fmt.Sprintf("code %d", code)
		}
		return nil, fmt.Errorf("APIMart %s error: %s", label, message)
	}
	return data, nil
}

func dataURLPayload(value string) (string, error) {
	idx := strings.Index(value, ",")
	if !strings.HasPrefix(strings.ToLower(value), "data:image/") || idx < 0 {
		return "", errors.New("not a valid image data URL")
	}
	meta := strings.ToLower(value[:idx])
	if !strings.Contains(meta, ";base64") {
		return "", errors.New("image data URL must be base64 encoded")
	}
	return strings.TrimSpace(value[idx+1:]), nil
}

func apimartEndpoint(baseURL string, path string) string {
	root := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(strings.ToLower(root), "/v1") {
		root = strings.TrimRight(root[:len(root)-3], "/")
	}
	if strings.HasPrefix(path, "/") {
		return root + path
	}
	return root + "/" + path
}

func normalizeAPIMartModel(modelID string) string {
	normalized := strings.TrimSpace(modelID)
	if normalized != "" {
		return normalized
	}
	return apimartDefaultModel
}

func normalizeAPIMartResolution(resolution string, modelID string) string {
	if strings.Contains(strings.ToLower(strings.TrimSpace(modelID)), "gemini") {
		return strings.ToUpper(resolution)
	}
	return resolution
}

func aspectForAPIMartSize(size string) string {
	normalized := strings.ToLower(strings.TrimSpace(size))
	if aspect, _, ok := parseAPIMartCompactSize(normalized); ok {
		return aspect
	}
	if aspect, ok := apimartSizeToAspect[normalized]; ok {
		return aspect
	}
	return nearestAPIMartAspect(normalized)
}

func resolutionForAPIMartSize(size string) string {
	normalized := strings.ToLower(strings.TrimSpace(size))
	if _, resolution, ok := parseAPIMartCompactSize(normalized); ok {
		return resolution
	}
	if resolution, ok := apimartSizeToResolution[normalized]; ok {
		return resolution
	}
	parsed := parseSizeValue(normalized)
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

func parseAPIMartCompactSize(value string) (string, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "", "", false
	}
	parts := strings.Split(normalized, "@")
	aspect := parts[0]
	if _, ok := apimartSupportedAspects[aspect]; !ok {
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

func nearestAPIMartAspect(size string) string {
	parsed := parseSizeValue(size)
	if parsed == nil || parsed.width <= 0 || parsed.height <= 0 {
		return "1:1"
	}
	ratio := float64(parsed.width) / float64(parsed.height)
	bestAspect := "1:1"
	bestDistance := 9999.0
	for aspect := range apimartSupportedAspects {
		if aspect == "auto" {
			continue
		}
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

func parsePositiveInt(value string) int {
	if value == "" {
		return 0
	}
	result := 0
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return 0
		}
		result = result*10 + int(ch-'0')
	}
	if result <= 0 {
		return 0
	}
	return result
}

func apimartStatusFromPayload(value any) string {
	status := strings.TrimSpace(strings.ToLower(firstStringForKeys(value, "status", "state")))
	return status
}

func firstStringForKeys(value any, keys ...string) string {
	record, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range keys {
		if str, ok := record[key].(string); ok && strings.TrimSpace(str) != "" {
			return strings.TrimSpace(str)
		}
	}
	for _, nestedKey := range []string{"data", "result", "output", "task"} {
		if nested := firstStringForKeys(record[nestedKey], keys...); nested != "" {
			return nested
		}
	}
	return ""
}

func collectAPIMartImageValues(value any) []string {
	out := []string{}
	seen := map[string]struct{}{}
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
			lowerKey := strings.ToLower(key)
			if (strings.HasPrefix(strings.ToLower(trimmed), "http://") || strings.HasPrefix(strings.ToLower(trimmed), "https://") || strings.HasPrefix(strings.ToLower(trimmed), "data:image/")) && (key == "" || strings.Contains(lowerKey, "url") || strings.Contains(lowerKey, "image") || strings.Contains(lowerKey, "output") || strings.Contains(lowerKey, "src") || strings.Contains(lowerKey, "uri") || strings.Contains(lowerKey, "file")) {
				if _, ok := seen[trimmed]; !ok {
					seen[trimmed] = struct{}{}
					out = append(out, trimmed)
				}
			}
		case []any:
			for _, child := range typed {
				visit(child, key, depth+1)
			}
		case map[string]any:
			for childKey, childValue := range typed {
				visit(childValue, childKey, depth+1)
			}
		}
	}
	visit(value, "", 0)
	return out
}

func extractAPIMartTaskID(value any) string {
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
		for _, key := range []string{"task_id", "taskId", "request_id"} {
			if str, ok := record[key].(string); ok && strings.TrimSpace(str) != "" {
				return strings.TrimSpace(str)
			}
		}
		if str, ok := record["id"].(string); ok && strings.HasPrefix(strings.ToLower(strings.TrimSpace(str)), "task") {
			return strings.TrimSpace(str)
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

func firstAPIMartErrorMessage(value any) string {
	var visit func(any, string, int) string
	visit = func(current any, key string, depth int) string {
		if depth > 8 {
			return ""
		}
		switch typed := current.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			lowerKey := strings.ToLower(key)
			if trimmed != "" && (strings.Contains(lowerKey, "message") || strings.Contains(lowerKey, "msg") || strings.Contains(lowerKey, "error") || strings.Contains(lowerKey, "reason") || strings.Contains(lowerKey, "detail") || strings.Contains(lowerKey, "description")) {
				return trimmed
			}
		case []any:
			for _, child := range typed {
				if message := visit(child, key, depth+1); message != "" {
					return message
				}
			}
		case map[string]any:
			for _, preferred := range []string{"message", "msg", "error_message", "reason", "detail", "description", "error"} {
				if message := visit(typed[preferred], preferred, depth+1); message != "" {
					return message
				}
			}
			for childKey, childValue := range typed {
				if message := visit(childValue, childKey, depth+1); message != "" {
					return message
				}
			}
		}
		return ""
	}
	return visit(value, "", 0)
}

func limitText(value string, max int) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= max {
		return trimmed
	}
	if max <= 3 {
		return trimmed[:max]
	}
	return trimmed[:max-3] + "..."
}
