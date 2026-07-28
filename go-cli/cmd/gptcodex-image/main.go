package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	imagedraw "image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/yuanhua/image-gptcodex/internal/fsio"
	"github.com/yuanhua/image-gptcodex/internal/promptui"
	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	defaultBaseURL       = "https://www.fhl.mom"
	defaultRunningHubURL = "http://127.0.0.1:8117"
	defaultAPIMode       = string(client.APIModeResponses)
	defaultRequestPolicy = string(client.RequestPolicyOpenAI)
	defaultTextModel     = "gpt-5.5"
	defaultImageModel    = "gpt-image-2"
	defaultSize          = "1024x1024"
	defaultQuality       = "medium"
	defaultOutputFormat  = "png"
)

var packageVersion = "V2.0.3.1"

type multiFlag []string

func (m *multiFlag) String() string {
	if m == nil {
		return ""
	}
	return strings.Join(*m, ",")
}

func (m *multiFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	*m = append(*m, value)
	return nil
}

type commandResult struct {
	OK                      bool     `json:"ok"`
	Error                   string   `json:"error,omitempty"`
	ImagePath               string   `json:"imagePath,omitempty"`
	RawPath                 string   `json:"rawPath,omitempty"`
	Mode                    string   `json:"mode,omitempty"`
	APIMode                 string   `json:"apiMode,omitempty"`
	Size                    string   `json:"size,omitempty"`
	Quality                 string   `json:"quality,omitempty"`
	OutputFormat            string   `json:"outputFormat,omitempty"`
	SourceEvent             string   `json:"sourceEvent,omitempty"`
	RevisedPrompt           string   `json:"revisedPrompt,omitempty"`
	ElapsedSec              float64  `json:"elapsedSec,omitempty"`
	FallbackMode            string   `json:"fallbackMode,omitempty"`
	FallbackInputPath       string   `json:"fallbackInputPath,omitempty"`
	FallbackReason          string   `json:"fallbackReason,omitempty"`
	AttemptSummary          []string `json:"attemptSummary,omitempty"`
	PackageVersion          string   `json:"packageVersion,omitempty"`
	ConfigPath              string   `json:"configPath,omitempty"`
	BaseURL                 string   `json:"baseURL,omitempty"`
	RequestPolicy           string   `json:"requestPolicy,omitempty"`
	TextModelID             string   `json:"textModel,omitempty"`
	ImageModelID            string   `json:"imageModel,omitempty"`
	InputDir                string   `json:"inputDir,omitempty"`
	OutputDir               string   `json:"outputDir,omitempty"`
	RawDir                  string   `json:"rawDir,omitempty"`
	APIKeyConfigured        *bool    `json:"apiKeyConfigured,omitempty"`
	APIKeySource            string   `json:"apiKeySource,omitempty"`
	RunningHubReachable     *bool    `json:"runningHubBridgeReachable,omitempty"`
	RunningHubKeyConfigured *bool    `json:"runningHubAPIKeyConfigured,omitempty"`
	RunningHubBridgeError   string   `json:"runningHubBridgeError,omitempty"`
}

type cliOptions struct {
	apiKey             string
	mode               client.Mode
	prompt             string
	imagePaths         []string
	size               string
	quality            string
	outputFormat       string
	outDir             string
	rawDir             string
	inputDir           string
	baseURL            string
	apiMode            client.APIMode
	requestPolicy      client.RequestPolicy
	textModelID        string
	imageModelID       string
	negativePrompt     string
	seed               int64
	partialImages      int
	imagesNewAPICompat bool
	maskB64            string
	jsonMode           bool
	jsonlEvents        bool
	interactive        bool
	statusOnly         bool
	configPath         string
}

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

func main() {
	jsonHint := hasFlag(os.Args[1:], "json") || hasFlag(os.Args[1:], "status")
	result, err := run(os.Args[1:], jsonHint)
	if jsonHint {
		if result.Error == "" && err != nil {
			result.Error = err.Error()
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
	}
	if err != nil {
		if !jsonHint {
			fmt.Fprintln(os.Stderr, "error:", err)
		}
		os.Exit(1)
	}
}

func run(args []string, jsonHint bool) (commandResult, error) {
	opts, err := buildOptions(args, jsonHint)
	if err != nil {
		return failResult(opts, err)
	}
	if opts.statusOnly {
		return statusResult(opts), nil
	}
	return execute(opts)
}

func buildOptions(args []string, jsonHint bool) (cliOptions, error) {
	var images multiFlag
	var opts cliOptions
	fs := flag.NewFlagSet("gptcodex-image", flag.ContinueOnError)
	if jsonHint {
		fs.SetOutput(io.Discard)
	} else {
		fs.SetOutput(os.Stderr)
	}

	apiKey := fs.String("api-key", "", "API key; env IMAGE_STUDIO_API_KEY or GPTCODEX_API_KEY also accepted")
	mode := fs.String("mode", "", "generate | edit; empty auto-selects edit when --image is provided")
	fs.Var(&images, "image", "source image path; repeat for multiple reference images")
	size := fs.String("size", "", "image size, e.g. 1024x1024, 864x1536, auto")
	quality := fs.String("quality", "", "auto | high | medium | low")
	prompt := fs.String("prompt", "", "prompt text or edit instruction")
	promptFile := fs.String("prompt-file", "", "UTF-8 text file containing the prompt")
	outDir := fs.String("out-dir", "", "image output directory")
	rawDir := fs.String("raw-dir", "", "raw upstream response output directory")
	inputDir := fs.String("input-dir", "", "base directory for relative --image paths")
	baseURL := fs.String("base-url", "", "upstream base URL")
	apiMode := fs.String("api-mode", "", "responses | images | apimart | runninghub")
	requestPolicy := fs.String("request-policy", "", "openai | compat")
	textModel := fs.String("text-model", "", "Responses API text model")
	imageModel := fs.String("image-model", "", "image model")
	outputFormat := fs.String("output-format", "", "png | jpeg | webp")
	negativePrompt := fs.String("negative-prompt", "", "negative prompt; sent only in compat policy")
	seed := fs.Int64("seed", 0, "seed; 0 lets upstream choose")
	partialImages := fs.Int("partial-images", 0, "stream early image previews; 0 uses the upstream default")
	imagesNewAPICompat := fs.Bool("images-newapi-compat", false, "Images API compatibility mode: response_format=b64_json without stream/partial_images")
	maskPath := fs.String("mask", "", "optional mask image path")
	configPath := fs.String("config", "", "env-style config file; default config/cli.env.local")
	jsonMode := fs.Bool("json", false, "print final result JSON to stdout")
	jsonlEvents := fs.Bool("jsonl-events", false, "print progress JSON lines to stderr")
	noInput := fs.Bool("no-input", false, "fail instead of prompting for missing values")
	interactive := fs.Bool("interactive", false, "enable legacy terminal prompts for missing values")
	statusOnly := fs.Bool("status", false, "print the current package and API profile status as JSON")

	if err := fs.Parse(args); err != nil {
		return opts, err
	}
	jsonOutput := jsonHint || *jsonMode
	if *noInput && *interactive {
		return opts, fmt.Errorf("--no-input and --interactive cannot be used together")
	}

	resolvedConfigPath := resolveConfigPath(*configPath)
	cfg, err := loadConfig(resolvedConfigPath)
	if err != nil {
		return opts, err
	}

	opts = cliOptions{
		apiKey:             resolveString(*apiKey, []string{"IMAGE_STUDIO_API_KEY", "GPTCODEX_API_KEY"}, cfg, []string{"IMAGE_STUDIO_API_KEY", "GPTCODEX_API_KEY"}, ""),
		prompt:             strings.TrimSpace(*prompt),
		size:               resolveString(*size, []string{"IMAGE_STUDIO_SIZE"}, cfg, []string{"IMAGE_STUDIO_SIZE"}, defaultSize),
		quality:            resolveString(*quality, []string{"IMAGE_STUDIO_QUALITY"}, cfg, []string{"IMAGE_STUDIO_QUALITY"}, defaultQuality),
		outputFormat:       resolveString(*outputFormat, []string{"IMAGE_STUDIO_OUTPUT_FORMAT"}, cfg, []string{"IMAGE_STUDIO_OUTPUT_FORMAT"}, defaultOutputFormat),
		outDir:             resolveString(*outDir, []string{"IMAGE_STUDIO_OUTPUT_DIR"}, cfg, []string{"IMAGE_STUDIO_OUTPUT_DIR"}, defaultOutputDir()),
		inputDir:           resolveString(*inputDir, []string{"IMAGE_STUDIO_INPUT_DIR"}, cfg, []string{"IMAGE_STUDIO_INPUT_DIR"}, defaultInputDir()),
		baseURL:            resolveString(*baseURL, []string{"IMAGE_STUDIO_UPSTREAM_BASE_URL"}, cfg, []string{"IMAGE_STUDIO_UPSTREAM_BASE_URL"}, ""),
		textModelID:        resolveString(*textModel, []string{"IMAGE_STUDIO_TEXT_MODEL"}, cfg, []string{"IMAGE_STUDIO_TEXT_MODEL"}, defaultTextModel),
		imageModelID:       resolveString(*imageModel, []string{"IMAGE_STUDIO_IMAGE_MODEL"}, cfg, []string{"IMAGE_STUDIO_IMAGE_MODEL"}, defaultImageModel),
		negativePrompt:     strings.TrimSpace(*negativePrompt),
		seed:               *seed,
		partialImages:      *partialImages,
		imagesNewAPICompat: *imagesNewAPICompat,
		jsonMode:           jsonOutput,
		jsonlEvents:        *jsonlEvents,
		interactive:        *interactive,
		statusOnly:         *statusOnly,
		configPath:         resolvedConfigPath,
	}
	opts.rawDir = resolveString(*rawDir, []string{"IMAGE_STUDIO_RAW_DIR"}, cfg, []string{"IMAGE_STUDIO_RAW_DIR"}, filepath.Join(opts.outDir, "log"))
	if opts.negativePrompt == "" {
		opts.negativePrompt = resolveString("", []string{"IMAGE_STUDIO_NEGATIVE_PROMPT"}, cfg, []string{"IMAGE_STUDIO_NEGATIVE_PROMPT"}, "")
	}
	if opts.seed == 0 {
		if rawSeed := resolveString("", []string{"IMAGE_STUDIO_SEED"}, cfg, []string{"IMAGE_STUDIO_SEED"}, ""); rawSeed != "" {
			parsed, err := strconv.ParseInt(rawSeed, 10, 64)
			if err != nil {
				return opts, fmt.Errorf("IMAGE_STUDIO_SEED must be an integer: %w", err)
			}
			opts.seed = parsed
		}
	}
	if opts.partialImages == 0 {
		if rawPartial := resolveString("", []string{"IMAGE_STUDIO_PARTIAL_IMAGES"}, cfg, []string{"IMAGE_STUDIO_PARTIAL_IMAGES"}, ""); rawPartial != "" {
			parsed, err := strconv.Atoi(rawPartial)
			if err != nil {
				return opts, fmt.Errorf("IMAGE_STUDIO_PARTIAL_IMAGES must be an integer: %w", err)
			}
			opts.partialImages = parsed
		}
	}
	if !opts.imagesNewAPICompat {
		opts.imagesNewAPICompat = resolveBool([]string{"IMAGE_STUDIO_IMAGES_NEWAPI_COMPAT"}, cfg, []string{"IMAGE_STUDIO_IMAGES_NEWAPI_COMPAT"}, false)
	}

	apiModeValue := resolveString(*apiMode, []string{"IMAGE_STUDIO_API_MODE"}, cfg, []string{"IMAGE_STUDIO_API_MODE"}, defaultAPIMode)
	opts.apiMode, err = normalizeAPIMode(apiModeValue)
	if err != nil {
		return opts, err
	}
	if strings.TrimSpace(opts.baseURL) == "" {
		if opts.apiMode == client.APIModeRunningHub {
			opts.baseURL = defaultRunningHubURL
		} else {
			opts.baseURL = defaultBaseURL
		}
	}
	policyValue := resolveString(*requestPolicy, []string{"IMAGE_STUDIO_REQUEST_POLICY"}, cfg, []string{"IMAGE_STUDIO_REQUEST_POLICY"}, defaultRequestPolicy)
	opts.requestPolicy, err = normalizeRequestPolicy(policyValue)
	if err != nil {
		return opts, err
	}

	if opts.statusOnly {
		return opts, nil
	}

	if opts.prompt == "" && strings.TrimSpace(*promptFile) != "" {
		b, err := os.ReadFile(strings.TrimSpace(*promptFile))
		if err != nil {
			return opts, fmt.Errorf("read prompt-file: %w", err)
		}
		opts.prompt = strings.TrimSpace(string(b))
	}

	if len(images) > 0 {
		opts.imagePaths, err = resolveImagePaths(images, opts.inputDir)
		if err != nil {
			return opts, err
		}
	}

	if strings.TrimSpace(*maskPath) != "" {
		opts.maskB64, err = readImageBase64(resolveMaybeInputPath(*maskPath, opts.inputDir))
		if err != nil {
			return opts, fmt.Errorf("read mask: %w", err)
		}
	}

	if err := resolveInteractive(&opts, *mode); err != nil {
		return opts, err
	}
	return opts, nil
}

func resolveInteractive(opts *cliOptions, modeFlag string) error {
	p := promptui.NewPrompter()
	if strings.TrimSpace(opts.apiKey) == "" && opts.apiMode != client.APIModeRunningHub {
		if !opts.interactive {
			return client.ErrEmptyAPIKey
		}
		v, err := p.APIKey()
		if err != nil {
			return err
		}
		opts.apiKey = v
	}

	switch strings.ToLower(strings.TrimSpace(modeFlag)) {
	case "generate":
		if len(opts.imagePaths) > 0 {
			return fmt.Errorf("--mode generate cannot be used with --image")
		}
		opts.mode = client.ModeGenerate
	case "edit":
		opts.mode = client.ModeEdit
	case "":
		if len(opts.imagePaths) > 0 || opts.maskB64 != "" {
			opts.mode = client.ModeEdit
		} else if opts.interactive {
			mode, err := p.Mode()
			if err != nil {
				return err
			}
			opts.mode = mode
		} else {
			opts.mode = client.ModeGenerate
		}
	default:
		return fmt.Errorf("--mode must be generate or edit")
	}

	if opts.mode == client.ModeEdit && len(opts.imagePaths) == 0 {
		if !opts.interactive {
			return fmt.Errorf("edit mode requires at least one --image")
		}
		source, err := p.ImagePath()
		if err != nil {
			return err
		}
		opts.imagePaths = []string{resolveMaybeInputPath(source, opts.inputDir)}
	}
	if strings.TrimSpace(opts.prompt) == "" {
		if !opts.interactive {
			return client.ErrEmptyPrompt
		}
		v, err := p.PromptText(opts.mode)
		if err != nil {
			return err
		}
		opts.prompt = v
	}
	return nil
}

func normalizeBaseURLForFHLComparison(raw string) string {
	cleaned := strings.TrimRight(strings.TrimSpace(raw), "/")
	for strings.HasSuffix(strings.ToLower(cleaned), "/v1") {
		cleaned = strings.TrimRight(cleaned[:len(cleaned)-3], "/")
	}
	return strings.ToLower(cleaned)
}

func isExactSizeString(raw string) bool {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(raw)), "x")
	if len(parts) != 2 {
		return false
	}
	width, err := strconv.Atoi(parts[0])
	if err != nil || width <= 0 {
		return false
	}
	height, err := strconv.Atoi(parts[1])
	if err != nil || height <= 0 {
		return false
	}
	return true
}

func isGPTImage2Model(modelID string) bool {
	model := strings.TrimSpace(modelID)
	if model == "" {
		model = client.ImageModel
	}
	return strings.HasPrefix(strings.ToLower(model), "gpt-image-2")
}

func shouldPreferResponsesForExactFHLSize(opts cliOptions) bool {
	if opts.apiMode != client.APIModeImages {
		return false
	}
	if normalizeBaseURLForFHLComparison(opts.baseURL) != strings.ToLower(defaultBaseURL) {
		return false
	}
	if isGPTImage2Model(opts.imageModelID) {
		return false
	}
	size := strings.ToLower(strings.TrimSpace(opts.size))
	if !isExactSizeString(size) {
		return false
	}
	_, ok := safeFHLImagesExactSizes[size]
	return !ok
}

func stableFHLImagesSize(opts cliOptions) string {
	size := strings.ToLower(strings.TrimSpace(opts.size))
	if opts.apiMode != client.APIModeImages {
		return opts.size
	}
	if normalizeBaseURLForFHLComparison(opts.baseURL) != strings.ToLower(defaultBaseURL) {
		return opts.size
	}
	if isGPTImage2Model(opts.imageModelID) {
		return opts.size
	}
	if !isExactSizeString(size) {
		return opts.size
	}
	if stable, ok := stableFHLImagesSizeOverrides[size]; ok {
		return stable
	}
	return opts.size
}

func execute(opts cliOptions) (commandResult, error) {
	if err := fsio.EnsureDir(opts.outDir); err != nil {
		return failResult(opts, err)
	}
	if err := fsio.EnsureDir(opts.rawDir); err != nil {
		return failResult(opts, err)
	}

	transport, err := client.PickTransport()
	if err != nil {
		return failResult(opts, err)
	}

	effectiveAPIMode := opts.apiMode
	effectiveSize := stableFHLImagesSize(opts)
	attemptSummary := []string{fmt.Sprintf("%s:%s", opts.mode, opts.apiMode)}
	if effectiveSize != opts.size {
		attemptSummary = append(attemptSummary, fmt.Sprintf("fhl_stable_size:%s->%s", opts.size, effectiveSize))
	}
	routingOpts := opts
	routingOpts.size = effectiveSize
	if shouldPreferResponsesForExactFHLSize(routingOpts) {
		effectiveAPIMode = client.APIModeResponses
		attemptSummary = append(attemptSummary, fmt.Sprintf("fhl_exact_size_via_responses:%s", effectiveSize))
	}

	clientOpts := client.Options{
		APIKey:             strings.TrimSpace(opts.apiKey),
		Prompt:             strings.TrimSpace(opts.prompt),
		Mode:               opts.mode,
		Size:               effectiveSize,
		Quality:            opts.quality,
		OutputFormat:       opts.outputFormat,
		ImagePaths:         opts.imagePaths,
		APIMode:            effectiveAPIMode,
		RequestPolicy:      opts.requestPolicy,
		MaskB64:            opts.maskB64,
		Seed:               opts.seed,
		NegativePrompt:     opts.negativePrompt,
		BaseURL:            opts.baseURL,
		TextModelID:        opts.textModelID,
		ImageModelID:       opts.imageModelID,
		NoPromptRevision:   true,
		PartialImages:      opts.partialImages,
		ImagesNewAPICompat: opts.imagesNewAPICompat,
	}
	if effectiveAPIMode == client.APIModeResponses && opts.mode == client.ModeEdit {
		for _, p := range opts.imagePaths {
			dataURL, err := client.ImageFileToDataURL(p)
			if err != nil {
				return failResult(opts, err)
			}
			clientOpts.ImageDataURLs = append(clientOpts.ImageDataURLs, dataURL)
		}
	}

	startedAt := time.Now()
	timestamp := timestampWithMillis(startedAt)
	log := logger(opts)
	progress := func(stage string, elapsed int, bytes int64) {
		if opts.jsonlEvents {
			emitEvent("progress", map[string]any{
				"stage":      stage,
				"elapsedSec": elapsed,
				"bytes":      bytes,
			})
			return
		}
		fmt.Fprintf(log, "waiting %ds, stage=%s, received=%s\n", elapsed, stage, client.FormatBytes(bytes))
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if !opts.jsonMode {
		fmt.Fprintln(log, "FHL Studio CLI")
		fmt.Fprintf(log, "requesting %s, size %s, quality %s...\n", modeActionLabel(opts.mode), effectiveSize, opts.quality)
		if effectiveSize != opts.size {
			fmt.Fprintf(log, "FHL Images size %s uses stable %s for reliable aspect output.\n", opts.size, effectiveSize)
		}
	}
	if effectiveAPIMode != opts.apiMode {
		rerouteMessage := fmt.Sprintf("FHL exact size %s uses Responses API for stable output.", effectiveSize)
		if opts.jsonlEvents {
			emitEvent("log", map[string]any{"message": rerouteMessage})
		} else if !opts.jsonMode {
			fmt.Fprintln(log, rerouteMessage)
		}
	}

	result, rawPath, err := client.RequestAndExtractWithRetries(ctx, transport, clientOpts, opts.rawDir, timestamp, func(msg string) {
		if opts.jsonlEvents {
			emitEvent("log", map[string]any{"message": msg})
			return
		}
		fmt.Fprintln(log, msg)
	}, progress)
	if rawPath != "" {
		rawPath, _ = filepath.Abs(rawPath)
	}
	actualAPIMode := effectiveAPIMode
	fallbackMode := ""
	fallbackInputPath := ""
	fallbackReason := ""
	if err != nil && shouldFallbackResponsesToImages(opts, err, rawPath) {
		attemptSummary = append(attemptSummary, "responses_to_images")
		if !opts.jsonMode {
			fmt.Fprintln(log, "Responses returned text-only/no image tool; retrying once with Images API...")
		} else if opts.jsonlEvents {
			emitEvent("log", map[string]any{"message": "Responses returned text-only/no image tool; retrying once with Images API"})
		}
		fallbackOpts := clientOpts
		fallbackOpts.APIMode = client.APIModeImages
		fallbackTimestamp := timestamp + "-images-fallback"
		result, rawPath, err = client.RequestAndExtractWithRetries(ctx, transport, fallbackOpts, opts.rawDir, fallbackTimestamp, func(msg string) {
			if opts.jsonlEvents {
				emitEvent("log", map[string]any{"message": msg})
				return
			}
			fmt.Fprintln(log, msg)
		}, progress)
		if rawPath != "" {
			rawPath, _ = filepath.Abs(rawPath)
		}
		if err == nil {
			actualAPIMode = client.APIModeImages
		}
	}
	if err != nil && shouldFallbackEditToContactSheet(opts, err, rawPath) {
		fallbackMode = "contact_sheet"
		fallbackReason = fallbackReasonForEditFailure(err, rawPath)
		attemptSummary = append(attemptSummary, "contact_sheet_fallback")
		if opts.jsonlEvents {
			emitEvent("log", map[string]any{"message": "\u591a\u56fe\u7f16\u8f91\u56de\u9000\uff1a\u4e0a\u6e38\u6682\u65f6\u4e0d\u7a33\u5b9a\uff0c\u6539\u7528\u53c2\u8003\u62fc\u56fe\u517c\u5bb9\u6a21\u5f0f\u91cd\u8bd5..."})
		} else {
			fmt.Fprintln(log, "\u591a\u56fe\u7f16\u8f91\u56de\u9000\uff1a\u4e0a\u6e38\u6682\u65f6\u4e0d\u7a33\u5b9a\uff0c\u6539\u7528\u53c2\u8003\u62fc\u56fe\u517c\u5bb9\u6a21\u5f0f\u91cd\u8bd5...")
		}
		sheetPath, sheetErr := createContactSheetFallback(opts.imagePaths, opts.rawDir, timestamp)
		if sheetErr == nil {
			fallbackInputPath = sheetPath
			fallbackOpts := clientOpts
			fallbackOpts.APIMode = client.APIModeImages
			fallbackOpts.ImagePaths = []string{sheetPath}
			fallbackOpts.ImageDataURLs = nil
			fallbackOpts.Prompt = contactSheetFallbackPrompt(clientOpts.Prompt, len(opts.imagePaths))
			fallbackTimestamp := timestamp + "-contact-sheet-fallback"
			result, rawPath, err = client.RequestAndExtractWithRetries(ctx, transport, fallbackOpts, opts.rawDir, fallbackTimestamp, func(msg string) {
				if opts.jsonlEvents {
					emitEvent("log", map[string]any{"message": msg})
					return
				}
				fmt.Fprintln(log, msg)
			}, progress)
			if rawPath != "" {
				rawPath, _ = filepath.Abs(rawPath)
			}
			if err == nil {
				actualAPIMode = client.APIModeImages
			}
		} else {
			err = fmt.Errorf("%w; contact sheet fallback failed: %v", err, sheetErr)
		}
	}
	if err != nil {
		out := baseResult(opts)
		out.RawPath = rawPath
		out.Error = err.Error()
		out.FallbackMode = fallbackMode
		out.FallbackInputPath = fallbackInputPath
		out.FallbackReason = fallbackReason
		out.AttemptSummary = attemptSummary
		return out, err
	}

	imageName := fsio.BuildImageName(opts.mode, opts.prompt, timestamp, opts.outputFormat)
	imageDir := imageOutputDirForSourceEvent(opts.outDir, result.SourceEvent)
	if err := fsio.EnsureDir(imageDir); err != nil {
		out := baseResult(opts)
		out.RawPath = rawPath
		out.Error = err.Error()
		out.FallbackMode = fallbackMode
		out.FallbackInputPath = fallbackInputPath
		out.FallbackReason = fallbackReason
		out.AttemptSummary = attemptSummary
		return out, err
	}
	imagePath, err := fsio.SaveImage(result.ImageB64, filepath.Join(imageDir, imageName))
	if err != nil {
		out := baseResult(opts)
		out.RawPath = rawPath
		out.Error = err.Error()
		out.FallbackMode = fallbackMode
		out.FallbackInputPath = fallbackInputPath
		out.FallbackReason = fallbackReason
		out.AttemptSummary = attemptSummary
		return out, err
	}

	out := baseResult(opts)
	out.OK = true
	out.APIMode = string(actualAPIMode)
	out.ImagePath = imagePath
	out.RawPath = rawPath
	out.SourceEvent = result.SourceEvent
	out.RevisedPrompt = result.RevisedPrompt
	out.ElapsedSec = roundElapsed(time.Since(startedAt).Seconds())
	out.FallbackMode = fallbackMode
	out.FallbackInputPath = fallbackInputPath
	out.FallbackReason = fallbackReason
	out.AttemptSummary = attemptSummary
	if !opts.jsonMode {
		fmt.Fprintf(log, "image saved: %s\n", imagePath)
		fmt.Fprintf(log, "raw response saved: %s\n", rawPath)
		if result.RevisedPrompt != "" {
			fmt.Fprintf(log, "revised prompt: %s\n", result.RevisedPrompt)
		}
	}
	return out, nil
}

func shouldFallbackResponsesToImages(opts cliOptions, err error, rawPath string) bool {
	if opts.apiMode != client.APIModeResponses || err == nil {
		return false
	}
	if opts.mode != client.ModeGenerate && opts.mode != client.ModeEdit {
		return false
	}
	if !strings.Contains(err.Error(), "image_generation_call.result") {
		return false
	}
	rawBytes, readErr := os.ReadFile(rawPath)
	if readErr != nil {
		return false
	}
	raw := string(rawBytes)
	if strings.Contains(raw, `"type":"image_generation_call"`) ||
		strings.Contains(raw, `"partial_image_b64"`) ||
		strings.Contains(raw, `"tools":[{"type":"image_generation"`) {
		return false
	}
	return strings.Contains(raw, `<image_generation`) ||
		strings.Contains(raw, `"tools":[]`) ||
		strings.Contains(raw, `"tool_choice":"auto"`)
}

func shouldFallbackEditToContactSheet(opts cliOptions, err error, rawPath string) bool {
	if err == nil || opts.mode != client.ModeEdit || len(opts.imagePaths) < 2 {
		return false
	}
	if opts.apiMode == client.APIModeImages &&
		normalizeBaseURLForFHLComparison(opts.baseURL) == strings.ToLower(defaultBaseURL) &&
		isGPTImage2Model(opts.imageModelID) {
		return false
	}
	rawBytes, _ := os.ReadFile(rawPath)
	raw := string(rawBytes)
	lowerRaw := strings.ToLower(raw)
	lowerErr := strings.ToLower(err.Error())
	if strings.Contains(lowerRaw, "content_policy") ||
		strings.Contains(lowerRaw, "moderation") ||
		strings.Contains(lowerRaw, "invalid_api_key") ||
		strings.Contains(lowerRaw, "incorrect_api_key") ||
		strings.Contains(lowerRaw, "insufficient_quota") ||
		strings.Contains(lowerRaw, "billing_hard_limit") ||
		strings.Contains(lowerRaw, "model_not_found") {
		return false
	}
	if client.IsRetryable(raw) {
		return true
	}
	for _, marker := range []string{
		"image_generation_call.result",
		"no image",
		"503",
		"502",
		"504",
		"524",
		"upstream_error",
		"no available account",
		"temporarily unavailable",
		"multipart",
		"image[]",
		"too many images",
		"unsupported image",
	} {
		if strings.Contains(lowerErr, marker) || strings.Contains(lowerRaw, marker) {
			return true
		}
	}
	for _, marker := range []string{"\u65e0\u53ef\u7528\u8d26\u53f7", "\u8bf7\u7a0d\u540e\u91cd\u8bd5", "\u7a0d\u540e\u91cd\u8bd5", "\u4e0a\u6e38\u8fd4\u56de"} {
		if strings.Contains(err.Error(), marker) || strings.Contains(raw, marker) {
			return true
		}
	}
	return false
}

func fallbackReasonForEditFailure(err error, rawPath string) string {
	rawBytes, _ := os.ReadFile(rawPath)
	raw := string(rawBytes)
	lower := strings.ToLower(err.Error() + "\n" + raw)
	if strings.Contains(err.Error(), "\u65e0\u53ef\u7528\u8d26\u53f7") ||
		strings.Contains(raw, "\u65e0\u53ef\u7528\u8d26\u53f7") ||
		strings.Contains(err.Error(), "\u8bf7\u7a0d\u540e\u91cd\u8bd5") ||
		strings.Contains(raw, "\u8bf7\u7a0d\u540e\u91cd\u8bd5") ||
		strings.Contains(lower, "no available account") ||
		strings.Contains(lower, "503") {
		return "upstream_busy"
	}
	if strings.Contains(lower, "multipart") ||
		strings.Contains(lower, "image[]") ||
		strings.Contains(lower, "too many images") ||
		strings.Contains(lower, "unsupported image") {
		return "multi_image_compatibility"
	}
	if strings.Contains(lower, "image_generation_call.result") || strings.Contains(lower, "no image") {
		return "no_final_image"
	}
	return "retryable_edit_failure"
}

func contactSheetFallbackPrompt(prompt string, sourceCount int) string {
	return strings.TrimSpace(prompt) + fmt.Sprintf(
		"\n\n\u591a\u53c2\u8003\u56fe\u517c\u5bb9\u6a21\u5f0f\u8bf4\u660e: \u8f93\u5165\u56fe\u662f\u4e00\u5f20\u53c2\u8003\u5408\u6210\u56fe\uff0c\u5de6\u4fa7\u5927\u56fe\u662f\u7b2c 1 \u5f20\u4e3b\u56fe\uff0c\u53f3\u4fa7\u4ece\u4e0a\u5230\u4e0b\u6216\u4ece\u5de6\u5230\u53f3\u662f\u7b2c 2 \u5230\u7b2c %d \u5f20\u53c2\u8003\u56fe\u3002\u8bf7\u4ee5\u5de6\u4fa7\u4e3b\u56fe\u4e3a\u88ab\u4fee\u6539\u5bf9\u8c61\uff0c\u53ea\u5438\u6536\u53f3\u4fa7\u53c2\u8003\u56fe\u7684\u4eba\u7269\u3001\u98ce\u683c\u3001\u573a\u666f\u6216\u6750\u8d28\u4fe1\u606f\uff0c\u4e0d\u8981\u8f93\u51fa\u62fc\u56fe\u3001\u8fb9\u6846\u3001\u5206\u680f\u6216\u53c2\u8003\u56fe\u7248\u5f0f\u3002",
		sourceCount,
	)
}

func createContactSheetFallback(paths []string, rawDir string, timestamp string) (string, error) {
	if len(paths) < 2 {
		return "", errors.New("contact sheet fallback needs at least two images")
	}
	decoded := make([]image.Image, 0, len(paths))
	for _, p := range paths {
		img, err := decodeInputImage(p)
		if err != nil {
			return "", fmt.Errorf("decode %s: %w", filepath.Base(p), err)
		}
		decoded = append(decoded, img)
	}

	const (
		sheetSize = 1536
		margin    = 28
		gap       = 18
		mainWidth = 1020
		jpegQ     = 88
	)
	canvas := image.NewRGBA(image.Rect(0, 0, sheetSize, sheetSize))
	imagedraw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{R: 246, G: 246, B: 246, A: 255}), image.Point{}, imagedraw.Src)

	mainRect := image.Rect(margin, margin, margin+mainWidth, sheetSize-margin)
	drawCell(canvas, mainRect)
	drawImageFit(canvas, decoded[0], insetRect(mainRect, 10))

	refs := decoded[1:]
	refX := mainRect.Max.X + gap
	refW := sheetSize - margin - refX
	cols := 1
	if len(refs) > 3 {
		cols = 2
	}
	rows := (len(refs) + cols - 1) / cols
	if rows < 1 {
		rows = 1
	}
	cellW := (refW - gap*(cols-1)) / cols
	cellH := (sheetSize - margin*2 - gap*(rows-1)) / rows
	for i, ref := range refs {
		col := i % cols
		row := i / cols
		x := refX + col*(cellW+gap)
		y := margin + row*(cellH+gap)
		rect := image.Rect(x, y, x+cellW, y+cellH)
		drawCell(canvas, rect)
		drawImageFit(canvas, ref, insetRect(rect, 8))
	}

	outDir := filepath.Join(rawDir, "fallback-inputs")
	if err := fsio.EnsureDir(outDir); err != nil {
		return "", err
	}
	outPath := filepath.Join(outDir, fmt.Sprintf("contact-sheet-%s.jpg", timestamp))
	f, err := os.OpenFile(outPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if err := jpeg.Encode(f, canvas, &jpeg.Options{Quality: jpegQ}); err != nil {
		return "", err
	}
	return filepath.Abs(outPath)
}

func decodeInputImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

func insetRect(rect image.Rectangle, inset int) image.Rectangle {
	return image.Rect(rect.Min.X+inset, rect.Min.Y+inset, rect.Max.X-inset, rect.Max.Y-inset)
}

func drawCell(dst *image.RGBA, rect image.Rectangle) {
	imagedraw.Draw(dst, rect, image.NewUniform(color.RGBA{R: 255, G: 255, B: 255, A: 255}), image.Point{}, imagedraw.Src)
	border := color.RGBA{R: 218, G: 218, B: 218, A: 255}
	imagedraw.Draw(dst, image.Rect(rect.Min.X, rect.Min.Y, rect.Max.X, rect.Min.Y+2), image.NewUniform(border), image.Point{}, imagedraw.Src)
	imagedraw.Draw(dst, image.Rect(rect.Min.X, rect.Max.Y-2, rect.Max.X, rect.Max.Y), image.NewUniform(border), image.Point{}, imagedraw.Src)
	imagedraw.Draw(dst, image.Rect(rect.Min.X, rect.Min.Y, rect.Min.X+2, rect.Max.Y), image.NewUniform(border), image.Point{}, imagedraw.Src)
	imagedraw.Draw(dst, image.Rect(rect.Max.X-2, rect.Min.Y, rect.Max.X, rect.Max.Y), image.NewUniform(border), image.Point{}, imagedraw.Src)
}

func drawImageFit(dst *image.RGBA, src image.Image, rect image.Rectangle) {
	srcBounds := src.Bounds()
	sw := srcBounds.Dx()
	sh := srcBounds.Dy()
	if sw <= 0 || sh <= 0 || rect.Dx() <= 0 || rect.Dy() <= 0 {
		return
	}
	scaleW := float64(rect.Dx()) / float64(sw)
	scaleH := float64(rect.Dy()) / float64(sh)
	scale := scaleW
	if scaleH < scale {
		scale = scaleH
	}
	dw := int(float64(sw)*scale + 0.5)
	dh := int(float64(sh)*scale + 0.5)
	if dw < 1 {
		dw = 1
	}
	if dh < 1 {
		dh = 1
	}
	x := rect.Min.X + (rect.Dx()-dw)/2
	y := rect.Min.Y + (rect.Dy()-dh)/2
	for yy := 0; yy < dh; yy++ {
		sy := srcBounds.Min.Y + yy*sh/dh
		for xx := 0; xx < dw; xx++ {
			sx := srcBounds.Min.X + xx*sw/dw
			dst.Set(x+xx, y+yy, src.At(sx, sy))
		}
	}
}

func failResult(opts cliOptions, err error) (commandResult, error) {
	out := baseResult(opts)
	if err != nil {
		out.Error = err.Error()
	}
	return out, err
}

func baseResult(opts cliOptions) commandResult {
	return commandResult{
		OK:           false,
		Mode:         string(opts.mode),
		APIMode:      string(opts.apiMode),
		Size:         opts.size,
		Quality:      opts.quality,
		OutputFormat: opts.outputFormat,
	}
}

func statusResult(opts cliOptions) commandResult {
	_ = fsio.EnsureDir(opts.inputDir)
	_ = fsio.EnsureDir(opts.outDir)
	_ = fsio.EnsureDir(opts.rawDir)

	apiKeyConfigured := strings.TrimSpace(opts.apiKey) != ""
	apiKeySource := "none"
	if apiKeyConfigured {
		apiKeySource = "config"
	}

	out := baseResult(opts)
	out.OK = true
	out.PackageVersion = packageVersion
	out.ConfigPath = absPathForStatus(opts.configPath)
	out.BaseURL = sanitizeURLForStatus(opts.baseURL)
	out.RequestPolicy = string(opts.requestPolicy)
	out.TextModelID = opts.textModelID
	out.ImageModelID = opts.imageModelID
	out.InputDir = absPathForStatus(opts.inputDir)
	out.OutputDir = absPathForStatus(opts.outDir)
	out.RawDir = absPathForStatus(opts.rawDir)
	out.APIKeySource = apiKeySource

	if opts.apiMode == client.APIModeRunningHub {
		apiKeySource = "bridge"
		reachable, bridgeKeyConfigured, bridgeErr := runningHubBridgeStatus(opts.baseURL)
		out.APIKeySource = apiKeySource
		out.RunningHubReachable = boolPtr(reachable)
		out.RunningHubKeyConfigured = boolPtr(bridgeKeyConfigured)
		out.APIKeyConfigured = boolPtr(bridgeKeyConfigured)
		if bridgeErr != "" {
			out.RunningHubBridgeError = bridgeErr
		}
		return out
	}

	out.APIKeyConfigured = boolPtr(apiKeyConfigured)
	return out
}

func boolPtr(v bool) *bool {
	return &v
}

func absPathForStatus(path string) string {
	cleaned := strings.TrimSpace(path)
	if cleaned == "" {
		return ""
	}
	abs, err := filepath.Abs(cleaned)
	if err != nil {
		return cleaned
	}
	return abs
}

func sanitizeURLForStatus(raw string) string {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" {
		return ""
	}
	parsed, err := url.Parse(cleaned)
	if err != nil || parsed.Scheme == "" {
		return strings.TrimRight(cleaned, "/")
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func runningHubBridgeStatus(baseURL string) (bool, bool, string) {
	cleaned := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if cleaned == "" {
		cleaned = defaultRunningHubURL
	}
	endpoint := cleaned + "/api/config"
	httpClient := &http.Client{Timeout: 2 * time.Second}
	resp, err := httpClient.Get(endpoint)
	if err != nil {
		return false, false, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, false, fmt.Sprintf("RunningHub bridge returned HTTP %d", resp.StatusCode)
	}
	var payload struct {
		APIKeyConfigured      bool `json:"api_key_configured"`
		APIKeyConfiguredCamel bool `json:"apiKeyConfigured"`
		Config                struct {
			APIKeyConfigured      bool `json:"api_key_configured"`
			APIKeyConfiguredCamel bool `json:"apiKeyConfigured"`
		} `json:"config"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return true, false, err.Error()
	}
	return true,
		payload.APIKeyConfigured ||
			payload.APIKeyConfiguredCamel ||
			payload.Config.APIKeyConfigured ||
			payload.Config.APIKeyConfiguredCamel,
		""
}

func logger(opts cliOptions) io.Writer {
	if opts.jsonMode {
		return os.Stderr
	}
	return os.Stdout
}

func emitEvent(kind string, payload map[string]any) {
	payload["type"] = kind
	_ = json.NewEncoder(os.Stderr).Encode(payload)
}

func modeActionLabel(mode client.Mode) string {
	if mode == client.ModeEdit {
		return "edit"
	}
	return "generate"
}

func resolveString(flagValue string, envNames []string, cfg map[string]string, cfgNames []string, fallback string) string {
	if strings.TrimSpace(flagValue) != "" {
		return strings.TrimSpace(flagValue)
	}
	for _, name := range envNames {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	for _, name := range cfgNames {
		if value := strings.TrimSpace(cfg[name]); value != "" {
			return value
		}
	}
	return fallback
}

func resolveBool(envNames []string, cfg map[string]string, cfgNames []string, fallback bool) bool {
	for _, name := range envNames {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return parseBoolLike(value, fallback)
		}
	}
	for _, name := range cfgNames {
		if value := strings.TrimSpace(cfg[name]); value != "" {
			return parseBoolLike(value, fallback)
		}
	}
	return fallback
}

func parseBoolLike(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func resolveConfigPath(flagValue string) string {
	if strings.TrimSpace(flagValue) != "" {
		return strings.TrimSpace(flagValue)
	}
	if env := strings.TrimSpace(os.Getenv("IMAGE_STUDIO_CONFIG")); env != "" {
		return env
	}
	candidate := filepath.Join("config", "cli.env.local")
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return ""
}

func loadConfig(path string) (map[string]string, error) {
	out := map[string]string{}
	if strings.TrimSpace(path) == "" {
		return out, nil
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		value = strings.Trim(value, `"`)
		value = strings.Trim(value, `'`)
		out[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	return out, nil
}

func normalizeAPIMode(value string) (client.APIMode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(client.APIModeResponses):
		return client.APIModeResponses, nil
	case string(client.APIModeImages):
		return client.APIModeImages, nil
	case string(client.APIModeApimart):
		return client.APIModeApimart, nil
	case string(client.APIModeRunningHub):
		return client.APIModeRunningHub, nil
	default:
		return "", fmt.Errorf("--api-mode must be responses, images, apimart, or runninghub")
	}
}

func normalizeRequestPolicy(value string) (client.RequestPolicy, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(client.RequestPolicyOpenAI):
		return client.RequestPolicyOpenAI, nil
	case string(client.RequestPolicyCompat):
		return client.RequestPolicyCompat, nil
	default:
		return "", fmt.Errorf("--request-policy must be openai or compat")
	}
}

func resolveImagePaths(values []string, inputDir string) ([]string, error) {
	paths := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		path := resolveMaybeInputPath(value, inputDir)
		if seen[path] {
			continue
		}
		seen[path] = true
		paths = append(paths, path)
	}
	return paths, nil
}

func resolveMaybeInputPath(raw string, inputDir string) string {
	cleaned, err := client.NormalizePath(raw)
	if err != nil {
		return strings.TrimSpace(raw)
	}
	if filepath.IsAbs(cleaned) {
		return cleaned
	}
	if _, err := os.Stat(cleaned); err == nil {
		return cleaned
	}
	if strings.TrimSpace(inputDir) != "" {
		candidate := filepath.Join(inputDir, cleaned)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return cleaned
}

func readImageBase64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func defaultOutputDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "output"
	}
	return filepath.Join(cwd, "output")
}

func imageOutputDirForSourceEvent(outDir, sourceEvent string) string {
	if !isIntermediateSourceEvent(sourceEvent) {
		return outDir
	}
	parent := filepath.Dir(filepath.Clean(outDir))
	if parent == "." || parent == "" {
		return "intermediate"
	}
	return filepath.Join(parent, "intermediate")
}

func isIntermediateSourceEvent(sourceEvent string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(sourceEvent)), "partial")
}

func defaultInputDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "input"
	}
	return filepath.Join(cwd, "input")
}

func timestampWithMillis(t time.Time) string {
	return t.Format("20060102-150405") + fmt.Sprintf("-%03d", t.Nanosecond()/int(time.Millisecond))
}

func roundElapsed(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func hasFlag(args []string, name string) bool {
	prefix := "--" + name
	for _, arg := range args {
		if arg == prefix || strings.HasPrefix(arg, prefix+"=") {
			return true
		}
	}
	return false
}
