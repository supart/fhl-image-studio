package client

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RequestAndExtract performs one HTTP request (no retry) and returns the parsed image.
// It writes the raw response stream to rawSink, and (optionally) reports progress
// via the supplied callback. The callback is invoked from the goroutine that calls
// RequestAndExtract; receivers should be cheap or buffer internally.
func RequestAndExtract(
	ctx context.Context,
	transport Transport,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
) (ImageResult, error) {
	return RequestAndExtractWithPartial(ctx, transport, opts, rawSink, onProgress, nil)
}

func RequestAndExtractWithPartial(
	ctx context.Context,
	transport Transport,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
	onPartial func(PartialImage),
) (ImageResult, error) {
	payload, err := BuildPayload(opts)
	if err != nil {
		return ImageResult{}, err
	}

	baseURL := strings.TrimSpace(opts.BaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(BaseURL)
	}
	if baseURL == "" {
		return ImageResult{}, errors.New("\u7f3a\u5c11\u4e0a\u6e38 BASE_URL\uff0c\u8bf7\u5728\u8bbe\u7f6e\u91cc\u586b\u5199\u517c\u5bb9 Responses API \u7684\u4e2d\u8f6c\u7ad9\u5730\u5740")
	}
	baseURL, err = ValidateBaseURL(baseURL)
	if err != nil {
		return ImageResult{}, err
	}
	req := Request{
		URL:     baseURL + "/v1/responses",
		APIKey:  opts.APIKey,
		Payload: payload,
	}

	collector := newResponseCollectorWithPartial(rawSink, onPartial)

	progressCh := make(chan string, 16)
	done := make(chan error, 1)
	startedAt := time.Now()

	go func() {
		done <- transport.Stream(ctx, req, collector, progressCh)
		close(progressCh)
	}()

	ticker := time.NewTicker(time.Duration(StatusIntervalSecond) * time.Second)
	defer ticker.Stop()

	lastStage := "\u7b49\u5f85\u4e0a\u6e38\u8fd4\u56de"
	var streamErr error
loop:
	for {
		select {
		case <-ctx.Done():
			// Wait for goroutine to wind down so we don't leak.
			<-done
			return ImageResult{}, ctx.Err()
		case err, ok := <-done:
			if ok {
				streamErr = err
			}
			break loop
		case stage, ok := <-progressCh:
			if !ok {
				// Channel closed before done signal 闂?drain.
				continue
			}
			lastStage = stage
		case <-ticker.C:
			if onProgress != nil {
				elapsed := int(time.Since(startedAt).Seconds())
				onProgress(lastStage, elapsed, collector.bytesReceived())
			}
		}
	}

	if limitErr := collector.limitError(); limitErr != nil {
		return ImageResult{}, limitErr
	}
	if streamErr != nil {
		if isResponseLimitError(streamErr) {
			return ImageResult{}, streamErr
		}
		// If the stream ends after the final image event was already received,
		// prefer the collected result instead of surfacing a late transport error.
		if result, perr := collector.result(); perr == nil && result.ImageB64 != "" {
			return result, nil
		}
		return ImageResult{}, streamErr
	}

	return collector.result()
}

// RequestAndExtractWithRetries wraps RequestAndExtract with the same retry
// policy as the Python script. It writes one raw-response file per attempt
// (sse-response-{timestamp}-attempt{N}.txt) under outputDir.
//
// Dispatches between the Responses API SSE flow and the standard Images API
// based on opts.APIMode. Empty / "responses" 闂?SSE; "images" 闂?Images API.
//
// Returns the final ImageResult and the path of the last raw-response file
// (handy for the CLI to print).
func RequestAndExtractWithRetries(
	ctx context.Context,
	transport Transport,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
) (ImageResult, string, error) {
	return RequestAndExtractWithRetriesAndPartial(ctx, transport, opts, outputDir, timestamp, onLog, onProgress, nil)
}

func RequestAndExtractWithRetriesAndPartial(
	ctx context.Context,
	transport Transport,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if onLog == nil {
		onLog = func(string) {}
	}
	opts = routeFHLImagesOptions(opts, onLog)
	switch opts.APIMode {
	case APIModeImages:
		return imagesAPIWithRetries(ctx, opts, outputDir, timestamp, onLog, onProgress, onPartial)
	case APIModeApimart:
		return apimartAPIWithRetries(ctx, opts, outputDir, timestamp, onLog, onProgress)
	case APIModeRunningHub:
		return runningHubAPIWithRetries(ctx, opts, outputDir, timestamp, onLog, onProgress)
	default:
		return responsesAPIWithRetries(ctx, transport, opts, outputDir, timestamp, onLog, onProgress, onPartial)
	}
}

const fhlBaseURLForImageRouting = "https://www.fhl.mom"

var safeFHLImagesExactSizes = map[string]struct{}{
	"1024x1024": {},
	"1536x1024": {},
	"1024x1536": {},
	"1536x864":  {},
	"864x1536":  {},
}

var stableFHLImagesSizeOverrides = map[string]string{
	"2048x1360": "1536x1024",
	"3456x2304": "1536x1024",
	"1360x2048": "1024x1536",
	"2304x3456": "1024x1536",
	"2048x1152": "1536x864",
	"3840x2160": "1536x864",
	"1152x2048": "864x1536",
	"2160x3840": "864x1536",
}

func routeFHLImagesOptions(opts Options, onLog func(string)) Options {
	if opts.APIMode != APIModeImages || !isFHLBaseURL(opts.BaseURL) {
		return opts
	}
	if isGPTImage2Model(opts.ImageModelID) {
		if opts.Mode != ModeEdit || !hasMultipleEditSources(opts) {
			return opts
		}
		next := opts
		next.Quality = "auto"
		next.ImagesNewAPICompat = true
		return next
	}
	next := opts
	if stable := stableFHLImagesSize(next); stable != strings.TrimSpace(next.Size) {
		onLog(fmt.Sprintf("FHL Images size %s uses stable %s for reliable aspect output.", next.Size, stable))
		next.Size = stable
	}
	if shouldPreferResponsesForExactFHLSize(next) {
		onLog(fmt.Sprintf("FHL exact size %s uses Responses API for stable output.", next.Size))
		next.APIMode = APIModeResponses
	}
	return next
}

func hasMultipleEditSources(opts Options) bool {
	pathCount := 0
	for _, path := range opts.ImagePaths {
		if strings.TrimSpace(path) != "" {
			pathCount++
		}
	}
	if pathCount > 0 {
		return pathCount > 1
	}
	return len(opts.EffectiveImageDataURLs()) > 1
}

func isFHLBaseURL(raw string) bool {
	return normalizeBaseURLForFHLComparison(raw) == normalizeBaseURLForFHLComparison(fhlBaseURLForImageRouting)
}

func normalizeBaseURLForFHLComparison(raw string) string {
	cleaned := strings.TrimRight(strings.TrimSpace(raw), "/")
	for strings.HasSuffix(strings.ToLower(cleaned), "/v1") {
		cleaned = strings.TrimRight(cleaned[:len(cleaned)-3], "/")
	}
	return strings.ToLower(cleaned)
}

func isExactSizeString(raw string) bool {
	return parseSizeValue(raw) != nil
}

func shouldPreferResponsesForExactFHLSize(opts Options) bool {
	if opts.APIMode != APIModeImages || !isFHLBaseURL(opts.BaseURL) || isGPTImage2Model(opts.ImageModelID) {
		return false
	}
	size := strings.ToLower(strings.TrimSpace(opts.Size))
	if !isExactSizeString(size) {
		return false
	}
	if _, ok := safeFHLImagesExactSizes[size]; ok {
		return false
	}
	if _, ok := stableFHLImagesSizeOverrides[size]; ok {
		return false
	}
	return true
}

func stableFHLImagesSize(opts Options) string {
	size := strings.ToLower(strings.TrimSpace(opts.Size))
	if opts.APIMode != APIModeImages || !isFHLBaseURL(opts.BaseURL) || isGPTImage2Model(opts.ImageModelID) || !isExactSizeString(size) {
		return opts.Size
	}
	if stable, ok := stableFHLImagesSizeOverrides[size]; ok {
		return stable
	}
	return opts.Size
}

func responsesAPIWithRetries(
	ctx context.Context,
	transport Transport,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return ImageResult{}, "", fmt.Errorf("create output dir: %w", err)
	}

	var lastErr error
	var lastPath string

	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		attemptOpts := stabilizeResponsesOptionsForAttempt(opts, attempt)
		rawPath := filepath.Join(outputDir, fmt.Sprintf("sse-response-%s-attempt%d.txt", timestamp, attempt))
		lastPath = rawPath
		onLog(fmt.Sprintf("Responses API attempt %d/%d...", attempt, MaxAttempts))

		f, err := os.OpenFile(rawPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return ImageResult{}, lastPath, fmt.Errorf("create raw response file: %w", err)
		}

		result, reqErr := RequestAndExtractWithPartial(ctx, transport, attemptOpts, f, onProgress, onPartial)
		f.Close()

		if reqErr == nil {
			return result, rawPath, nil
		}
		if isResponseLimitError(reqErr) {
			return ImageResult{}, rawPath, reqErr
		}

		raw := readDiagnosticResponseFile(rawPath)

		if errors.Is(reqErr, ErrNoImageInResponse) {
			lastErr = reqErr
			reason := DescribeProblem(raw)
			if attempt < MaxAttempts && (IsRetryable(raw) || shouldRetryNoImageResponse(raw)) {
				onLog(reason)
				onLog(retryHintForResponsesAttempt(attempt, opts))
				onLog(fmt.Sprintf("Auto retrying in %d seconds...", RetryBackoffSeconds))
				if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
					return ImageResult{}, lastPath, ctx.Err()
				}
				continue
			}
			return ImageResult{}, lastPath, fmt.Errorf("%s", reason)
		}

		lastErr = reqErr
		if attempt < MaxAttempts {
			onLog(fmt.Sprintf("%v", reqErr))
			onLog(fmt.Sprintf("Auto retrying in %d seconds...", RetryBackoffSeconds))
			if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
				return ImageResult{}, lastPath, ctx.Err()
			}
			continue
		}
		return ImageResult{}, lastPath, reqErr
	}

	if lastErr != nil {
		return ImageResult{}, lastPath, fmt.Errorf("request failed after retries: %w", lastErr)
	}
	return ImageResult{}, lastPath, fmt.Errorf("request failed after retries")
}
func stabilizeResponsesOptionsForAttempt(opts Options, attempt int) Options {
	if attempt <= 1 {
		return opts
	}
	next := opts
	if attempt >= 2 {
		next.NoPromptRevision = false
		next.AllowPromptAdaptation = true
	}
	if attempt >= 3 {
		if !isGPTImage2Model(next.ImageModelID) {
			next.Size = stableResponsesRetrySize(next.Size)
		}
		if next.Quality == "" || next.Quality == "auto" || next.Quality == "high" {
			next.Quality = "medium"
		}
	}
	return next
}

func isGPTImage2Model(modelID string) bool {
	model := strings.TrimSpace(modelID)
	if model == "" {
		model = ImageModel
	}
	return strings.HasPrefix(strings.ToLower(model), "gpt-image-2")
}

func stableResponsesRetrySize(size string) string {
	switch size {
	case "2048x2048", "2880x2880":
		return "1024x1024"
	case "2048x1360", "3456x2304", "1536x1152", "1520x1216":
		return "1536x1024"
	case "1360x2048", "2304x3456", "1152x1536", "1216x1520":
		return "1024x1536"
	case "2048x1152", "3840x2160", "1536x768":
		return "1536x864"
	case "1152x2048", "2160x3840", "768x1536":
		return "864x1536"
	case "2208x1264", "3808x2176", "1536x512":
		return "1664x944"
	case "1264x2208", "2176x3808", "512x1536":
		return "944x1664"
	case "auto", "":
		return "1024x1024"
	default:
		return size
	}
}

func shouldRetryNoImageResponse(raw string) bool {
	lower := strings.ToLower(raw)
	return strings.Contains(lower, "response.output_text") ||
		strings.Contains(lower, "<image_generation") ||
		strings.Contains(lower, `"tools":[]`) ||
		strings.Contains(lower, `"tool_choice":"auto"`)
}

func retryHintForResponsesAttempt(attempt int, opts Options) string {
	if attempt == 1 {
		return "Auto retry: keeping Responses API and requiring the image_generation tool."
	}
	next := stabilizeResponsesOptionsForAttempt(opts, attempt+1)
	return fmt.Sprintf("Auto retry: keeping Responses API, using %s / %s, and requiring the image_generation tool.", next.Size, next.Quality)
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// imagesAPIWithRetries runs the standard OpenAI Images API path with the same
// 3-attempt retry policy. Raw response per attempt is dumped to
// images-response-{timestamp}-attempt{N}.json so users can inspect upstream
// error messages.
func imagesAPIWithRetries(
	ctx context.Context,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
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
		rawPath := filepath.Join(outputDir, fmt.Sprintf("images-response-%s-attempt%d.json", timestamp, attempt))
		lastPath = rawPath
		onLog(fmt.Sprintf("[Images API] attempt %d/%d...", attempt, MaxAttempts))

		f, err := os.OpenFile(rawPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return ImageResult{}, lastPath, fmt.Errorf("create raw response file: %w", err)
		}
		result, reqErr := RequestImagesAPIWithPartial(ctx, opts, f, onProgress, onPartial)
		f.Close()

		if reqErr == nil {
			return result, rawPath, nil
		}
		if isResponseLimitError(reqErr) {
			return ImageResult{}, rawPath, reqErr
		}

		raw := readDiagnosticResponseFile(rawPath)

		lastErr = reqErr
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

// isTransportishError treats common transport-layer failures as retryable.
func isTransportishError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, needle := range []string{
		"connection reset",
		"EOF",
		"timeout",
		"deadline exceeded",
		"i/o timeout",
		"TLS handshake",
		"no such host",
		"upstream connect error",
	} {
		if strings.Contains(msg, needle) {
			return true
		}
	}
	return false
}
