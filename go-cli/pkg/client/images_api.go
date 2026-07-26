package client

// images_api.go adapts the standard OpenAI Images API:
//   POST {base}/v1/images/generations (JSON, text-to-image)
//   POST {base}/v1/images/edits (multipart/form-data, image-to-image)
//
// The Responses API path lives in client.go / sse.go. This file keeps the
// Images API compatibility flow focused on request construction, optional
// streaming partial previews, and response parsing.

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
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func classifyImageModel(model string) string {
	normalized := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.HasPrefix(normalized, "dall-e-2"):
		return "dalle2"
	case strings.HasPrefix(normalized, "dall-e-3"):
		return "dalle3"
	case strings.HasPrefix(normalized, "gpt-image"), strings.HasPrefix(normalized, "chatgpt-image"):
		return "gpt-image"
	default:
		return "other"
	}
}

func supportsImagesResponseFormat(model string, mode Mode) bool {
	family := classifyImageModel(model)
	if mode == ModeEdit {
		return family == "dalle2"
	}
	return family == "dalle2" || family == "dalle3"
}

type imagesAPIDatum struct {
	B64JSON       string `json:"b64_json"`
	URL           string `json:"url"`
	RevisedPrompt string `json:"revised_prompt"`
}

type imagesAPIResponse struct {
	Created int              `json:"created"`
	Data    []imagesAPIDatum `json:"data"`
	Error   *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

type imageStreamExtractor struct {
	partialB64 string
	final      ImageResult
	hasFinal   bool
	onPartial  func(PartialImage)
}

func (e *imageStreamExtractor) consume(line string) bool {
	stripped := strings.TrimSpace(line)
	if stripped == "" {
		return false
	}
	if !strings.HasPrefix(stripped, "data: ") {
		return false
	}
	payload := strings.TrimSpace(stripped[6:])
	if payload == "" || payload == "[DONE]" {
		return true
	}
	var ev Event
	if err := decodeEvent(payload, &ev); err != nil {
		return false
	}
	evType, _ := ev["type"].(string)
	switch evType {
	case "image_generation.partial_image", "image_edit.partial_image":
		if b64, ok := ev["b64_json"].(string); ok && b64 != "" {
			e.partialB64 = b64
			partial := PartialImage{ImageB64: b64, PartialImageIndex: -1}
			if idx, ok := numberFromAny(ev["partial_image_index"]); ok {
				partial.PartialImageIndex = idx
			}
			if e.onPartial != nil {
				e.onPartial(partial)
			}
		}
		return true
	case "image_generation.completed", "image_edit.completed":
		if b64, ok := ev["b64_json"].(string); ok && b64 != "" {
			e.final = ImageResult{ImageB64: b64, SourceEvent: "images_api"}
			e.hasFinal = true
			return true
		}
	case "error":
		return true
	}
	if ev["object"] == "image.generation.result" || ev["object"] == "image.edit.result" {
		b, err := json.Marshal(ev)
		if err == nil {
			if result, err := parseImagesAPIResponseBytes(b, 200); err == nil {
				e.final = result
				e.hasFinal = true
				return true
			}
		}
	}
	return true
}

func (e *imageStreamExtractor) result() (ImageResult, bool) {
	if e.hasFinal {
		return e.final, true
	}
	if e.partialB64 != "" {
		return ImageResult{ImageB64: e.partialB64, SourceEvent: "images_api_partial"}, true
	}
	return ImageResult{}, false
}

// RequestImagesAPI executes a single (no-retry) request against the standard
// OpenAI Images API and returns the parsed image. Raw response body is teed
// to rawSink so callers can dump it for debugging.
func RequestImagesAPI(
	ctx context.Context,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
) (ImageResult, error) {
	return RequestImagesAPIWithPartial(ctx, opts, rawSink, onProgress, nil)
}

func RequestImagesAPIWithPartial(
	ctx context.Context,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
	onPartial func(PartialImage),
) (ImageResult, error) {
	if strings.TrimSpace(opts.APIKey) == "" {
		return ImageResult{}, ErrEmptyAPIKey
	}
	if strings.TrimSpace(opts.Prompt) == "" {
		return ImageResult{}, ErrEmptyPrompt
	}

	baseURL := strings.TrimSpace(opts.BaseURL)
	if baseURL == "" {
		return ImageResult{}, errors.New("missing upstream BASE_URL for OpenAI Images API")
	}
	baseURL, err := ValidateBaseURL(baseURL)
	if err != nil {
		return ImageResult{}, err
	}

	model := opts.ImageModelID
	if model == "" {
		model = ImageModel
	}
	rawSize := strings.TrimSpace(opts.Size)
	size := ""
	if strings.EqualFold(rawSize, "auto") {
		size = "auto"
	} else {
		size = normalizeOpenAIImageSize(rawSize)
	}
	if size == "" {
		size = DefaultSize
	}
	quality := opts.Quality
	if quality == "" {
		quality = DefaultQuality
	}
	outputFormat := opts.OutputFormat
	if outputFormat == "" {
		outputFormat = OutputFormat
	}
	includeExtended := shouldSendExtendedImageParameters(opts.RequestPolicy)
	useNewAPICompat := opts.ImagesNewAPICompat

	var (
		url         string
		body        io.Reader
		contentType string
	)

	if opts.Mode == ModeEdit {
		paths := opts.imageSourcePathsForEdit()
		if len(paths) == 0 {
			return ImageResult{}, errors.New("\u7f16\u8f91\u6a21\u5f0f\u81f3\u5c11\u9700\u8981\u4e00\u5f20 --image")
		}
		multipartBuf, mpType, err := buildEditsMultipart(paths, opts.MaskB64, opts.Prompt, model, size, quality, outputFormat, opts.NegativePrompt, opts.Seed, opts.RequestPolicy, normalizePartialImages(opts.PartialImages), useNewAPICompat)
		if err != nil {
			return ImageResult{}, err
		}
		url = baseURL + "/v1/images/edits"
		body = multipartBuf
		contentType = mpType
	} else {
		payload := map[string]any{
			"model":         model,
			"prompt":        opts.Prompt,
			"n":             1,
			"size":          size,
			"quality":       quality,
			"output_format": outputFormat,
		}
		if useNewAPICompat || supportsImagesResponseFormat(model, opts.Mode) {
			payload["response_format"] = "b64_json"
		}
		if !useNewAPICompat {
			payload["stream"] = true
			payload["partial_images"] = normalizePartialImages(opts.PartialImages)
		}
		if includeExtended && opts.Seed != 0 {
			payload["seed"] = opts.Seed
		}
		if includeExtended && strings.TrimSpace(opts.NegativePrompt) != "" {
			payload["negative_prompt"] = opts.NegativePrompt
		}
		b, err := json.Marshal(payload)
		if err != nil {
			return ImageResult{}, fmt.Errorf("marshal payload: %w", err)
		}
		url = baseURL + "/v1/images/generations"
		body = bytes.NewReader(b)
		contentType = "application/json"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return ImageResult{}, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+opts.APIKey)
	req.Header.Set("Accept", "text/event-stream, application/json")
	req.Header.Set("User-Agent", UserAgent())

	transport, err := NewHTTPTransport(opts.Proxy)
	if err != nil {
		return ImageResult{}, err
	}
	httpClient := &http.Client{
		Timeout:   8 * time.Minute,
		Transport: transport,
	}

	startedAt := time.Now()
	// Progress ticker 闂?Images API has no streaming so we just tick elapsed time.
	stopProgress := make(chan struct{})
	if onProgress != nil {
		go func() {
			tick := time.NewTicker(time.Duration(StatusIntervalSecond) * time.Second)
			defer tick.Stop()
			for {
				select {
				case <-stopProgress:
					return
				case <-tick.C:
					onProgress("waiting for Images API response", int(time.Since(startedAt).Seconds()), 0)
				}
			}
		}()
	}
	defer close(stopProgress)

	resp, err := httpClient.Do(req)
	if err != nil {
		return ImageResult{}, err
	}
	defer resp.Body.Close()
	if err := enforceHTTPResponseLimit(resp); err != nil {
		return ImageResult{}, fmt.Errorf("read Images API response: %w", err)
	}

	contentTypeHeader := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(contentTypeHeader, "text/event-stream") {
		var rawBytes int64
		extractor := imageStreamExtractor{onPartial: onPartial}
		scanner := NewSSEScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Bytes()
			rawBytes += int64(len(line) + 1)
			if _, err := rawSink.Write(line); err != nil {
				return ImageResult{}, fmt.Errorf("write raw: %w", err)
			}
			if _, err := rawSink.Write([]byte("\n")); err != nil {
				return ImageResult{}, fmt.Errorf("write raw: %w", err)
			}
			if extractor.consume(string(line)) && onProgress != nil {
				onProgress("\u7b49\u5f85 Images API \u8fd4\u56de", int(time.Since(startedAt).Seconds()), rawBytes)
			}
		}
		if err := scanner.Err(); err != nil {
			err = normalizeSSEScannerError(err)
			if isResponseLimitError(err) {
				return ImageResult{}, fmt.Errorf("read Images API stream: %w", err)
			}
			if result, ok := extractor.result(); ok && result.ImageB64 != "" {
				return result, nil
			}
			return ImageResult{}, fmt.Errorf("read Images API stream: %w", err)
		}
		if resp.StatusCode/100 != 2 {
			return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de HTTP %d", resp.StatusCode)
		}
		if result, ok := extractor.result(); ok {
			return result, nil
		}
		return ImageResult{}, ErrNoImageInResponse
	}

	preview := newCappedPreviewBuffer(4096)
	teeReader := io.TeeReader(resp.Body, io.MultiWriter(rawSink, preview))

	var parsed imagesAPIResponse
	dec := json.NewDecoder(teeReader)
	if err := dec.Decode(&parsed); err != nil {
		_, drainErr := io.Copy(io.Discard, teeReader)
		if isResponseLimitError(err) {
			return ImageResult{}, fmt.Errorf("read Images API response: %w", err)
		}
		if isResponseLimitError(drainErr) {
			return ImageResult{}, fmt.Errorf("read Images API response: %w", drainErr)
		}
		bodyPreview := preview.String()
		if len(bodyPreview) > 400 {
			bodyPreview = bodyPreview[:400] + "..."
		}
		if resp.StatusCode/100 != 2 {
			return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de HTTP %d: %s", resp.StatusCode, bodyPreview)
		}
		return ImageResult{}, fmt.Errorf("\u89e3\u6790 Images API \u8fd4\u56de\u5931\u8d25: %w", err)
	}
	if _, err := io.Copy(io.Discard, teeReader); err != nil {
		return ImageResult{}, fmt.Errorf("read Images API response: %w", err)
	}

	// Non-2xx with JSON body 闂?decode has already captured the structured error.
	if resp.StatusCode/100 != 2 {
		if parsed.Error != nil {
			return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de %d:%s", resp.StatusCode, parsed.Error.Message)
		}
		bodyPreview := preview.String()
		if len(bodyPreview) > 400 {
			bodyPreview = bodyPreview[:400] + "..."
		}
		return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de HTTP %d: %s", resp.StatusCode, bodyPreview)
	}
	if parsed.Error != nil {
		return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de\u9519\u8bef:%s", parsed.Error.Message)
	}
	if len(parsed.Data) == 0 {
		return ImageResult{}, ErrNoImageInResponse
	}
	d := parsed.Data[0]
	if d.B64JSON == "" {
		// Some relays return URL only. We do not download URL responses to keep
		// behaviour predictable 闂?surface a clear error so user can adjust the
		// upstream config.
		if d.URL != "" {
			return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de URL \u800c\u4e0d\u662f b64_json(\u4e0d\u652f\u6301 response_format),\u8bf7\u8054\u7cfb\u4e2d\u8f6c\u7ad9\u542f\u7528 b64_json")
		}
		return ImageResult{}, ErrNoImageInResponse
	}
	return imageResultFromImagesDatum(d), nil
}

func imageResultFromImagesDatum(d imagesAPIDatum) ImageResult {
	return ImageResult{
		ImageB64:      d.B64JSON,
		RevisedPrompt: d.RevisedPrompt,
		SourceEvent:   "images_api",
	}
}

func parseImagesAPIResponseBytes(raw []byte, statusCode int) (ImageResult, error) {
	var parsed imagesAPIResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ImageResult{}, err
	}
	if statusCode/100 != 2 {
		if parsed.Error != nil {
			return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de %d:%s", statusCode, parsed.Error.Message)
		}
		return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de HTTP %d", statusCode)
	}
	if parsed.Error != nil {
		return ImageResult{}, fmt.Errorf("\u4e0a\u6e38\u8fd4\u56de\u9519\u8bef:%s", parsed.Error.Message)
	}
	if len(parsed.Data) == 0 || parsed.Data[0].B64JSON == "" {
		return ImageResult{}, ErrNoImageInResponse
	}
	return imageResultFromImagesDatum(parsed.Data[0]), nil
}

type cappedPreviewBuffer struct {
	buf []byte
	max int
}

func newCappedPreviewBuffer(max int) *cappedPreviewBuffer {
	return &cappedPreviewBuffer{max: max}
}

func (b *cappedPreviewBuffer) Write(p []byte) (int, error) {
	if len(b.buf) < b.max {
		remain := b.max - len(b.buf)
		if len(p) < remain {
			remain = len(p)
		}
		b.buf = append(b.buf, p[:remain]...)
	}
	return len(p), nil
}

func (b *cappedPreviewBuffer) String() string {
	return string(b.buf)
}

// imageSourcePathsForEdit picks the source-image paths for an Images API edit.
// Prefers ImagePaths (raw files, no decode needed). If only data URLs are
// provided, the caller is responsible for writing them to a temp file first
// 闂?see writeDataURLToTemp below.
func (o Options) imageSourcePathsForEdit() []string {
	paths := make([]string, 0, len(o.ImagePaths)+1)
	for _, p := range o.ImagePaths {
		if strings.TrimSpace(p) != "" {
			paths = append(paths, p)
		}
	}
	if len(paths) > 0 {
		return paths
	}
	// Fallback: data URLs 闂?temp files.
	for _, du := range o.EffectiveImageDataURLs() {
		if p, err := writeDataURLToTemp(du); err == nil {
			paths = append(paths, p)
		}
	}
	return paths
}

// writeDataURLToTemp materialises a `data:...;base64,...` URL to a temp file
// and returns its path. Caller is responsible for cleanup; we leave it for the
// OS temp sweeper since these are small and we want them to survive retries.
func writeDataURLToTemp(dataURL string) (string, error) {
	idx := strings.Index(dataURL, ",")
	if !strings.HasPrefix(dataURL, "data:") || idx < 0 {
		return "", errors.New("not a data URL")
	}
	header := dataURL[5:idx] // e.g. "image/png;base64"
	payload := dataURL[idx+1:]
	if !strings.Contains(header, "base64") {
		return "", errors.New("data URL not base64")
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}
	ext := ".png"
	if strings.HasPrefix(header, "image/jpeg") {
		ext = ".jpg"
	} else if strings.HasPrefix(header, "image/webp") {
		ext = ".webp"
	}
	f, err := os.CreateTemp("", "image-studio-edit-*"+ext)
	if err != nil {
		return "", err
	}
	if _, err := f.Write(raw); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return f.Name(), nil
}

// buildEditsMultipart constructs the multipart/form-data body for /v1/images/edits.
func buildEditsMultipart(
	paths []string, maskB64, prompt, model, size, quality, outputFormat, negativePrompt string, seed int64, requestPolicy RequestPolicy, partialImages int, useNewAPICompat bool,
) (*bytes.Buffer, string, error) {
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)

	for i, p := range paths {
		fieldName := "image"
		if i > 0 {
			// Some relays accept multiple `image` fields, others want image[] 闂?
			// we send both to maximise compatibility. The extra field is cheap.
			fieldName = "image[]"
		}
		if err := writeMultipartFile(w, fieldName, p); err != nil {
			return nil, "", fmt.Errorf("attach %s: %w", filepath.Base(p), err)
		}
	}

	if strings.TrimSpace(maskB64) != "" {
		raw, err := base64.StdEncoding.DecodeString(maskB64)
		if err == nil && len(raw) > 0 {
			h := make(textproto.MIMEHeader)
			h.Set("Content-Disposition", `form-data; name="mask"; filename="mask.png"`)
			h.Set("Content-Type", "image/png")
			fw, err := w.CreatePart(h)
			if err != nil {
				return nil, "", err
			}
			if _, err := fw.Write(raw); err != nil {
				return nil, "", err
			}
		}
	}

	_ = w.WriteField("prompt", prompt)
	_ = w.WriteField("model", model)
	_ = w.WriteField("n", "1")
	_ = w.WriteField("size", size)
	_ = w.WriteField("quality", quality)
	if strings.TrimSpace(outputFormat) != "" {
		_ = w.WriteField("output_format", outputFormat)
	}
	if useNewAPICompat || supportsImagesResponseFormat(model, ModeEdit) {
		_ = w.WriteField("response_format", "b64_json")
	}
	if !useNewAPICompat {
		_ = w.WriteField("stream", "true")
		_ = w.WriteField("partial_images", fmt.Sprintf("%d", partialImages))
	}
	if shouldSendExtendedImageParameters(requestPolicy) && seed != 0 {
		_ = w.WriteField("seed", fmt.Sprintf("%d", seed))
	}
	if shouldSendExtendedImageParameters(requestPolicy) && strings.TrimSpace(negativePrompt) != "" {
		_ = w.WriteField("negative_prompt", negativePrompt)
	}

	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return buf, w.FormDataContentType(), nil
}

func writeMultipartFile(w *multipart.Writer, fieldName, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if st.Size() > MaxInputImageBytes {
		return fmt.Errorf("\u8f93\u5165\u6587\u4ef6\u8fc7\u5927(%dB > %dB \u9650\u5236)", st.Size(), MaxInputImageBytes)
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldName, filepath.Base(path)))
	h.Set("Content-Type", mimeForPath(path))
	fw, err := w.CreatePart(h)
	if err != nil {
		return err
	}
	_, err = io.Copy(fw, f)
	return err
}

func mimeForPath(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	if m, ok := SupportedImageMime[ext]; ok {
		return m
	}
	return "application/octet-stream"
}
