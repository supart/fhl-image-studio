package client

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

const noPromptRevisionInstructions = "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave."
const safeImageToolInstructions = "Use the image_generation tool and return an image result, not a text-only answer. If the user's wording is ambiguous or may trigger a safety refusal, adapt it into a policy-compliant visual prompt while preserving the creative intent."

// BuildPayload mirrors Python's build_payload. Returns canonical JSON bytes.
//
// When opts has one or more image data URLs (via ImageDataURLs or the legacy
// single ImageDataURL field), action becomes "edit" and each URL is appended
// as its own input_image content block, in order. When opts.MaskB64 is
// non-empty, it is embedded as the tool's "input_image_mask.image_url"
// parameter using a base64 data URL.
func BuildPayload(opts Options) ([]byte, error) {
	if strings.TrimSpace(opts.Prompt) == "" {
		return nil, ErrEmptyPrompt
	}
	if err := ValidateBackgroundMode(opts.BackgroundMode, opts.ImageModelID); err != nil {
		return nil, err
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
	if opts.BackgroundMode == BackgroundTransparent {
		outputFormat = "png"
	}
	if outputFormat == "" {
		outputFormat = OutputFormat
	}
	includeExtended := shouldSendExtendedImageParameters(opts.RequestPolicy)

	promptText := opts.Prompt
	if aspectPrompt := fhlExactResponsesAspectPromptSuffix(opts, size); aspectPrompt != "" {
		promptText = strings.TrimSpace(promptText) + "\n\n" + aspectPrompt
	}
	content := []map[string]any{
		{"type": "input_text", "text": promptText},
	}
	action := "generate"
	imageURLs := opts.EffectiveImageDataURLs()
	for _, url := range imageURLs {
		content = append(content, map[string]any{
			"type":      "input_image",
			"image_url": url,
		})
	}
	if len(imageURLs) > 0 {
		action = "edit"
	}

	imgModel := opts.ImageModelID
	if imgModel == "" {
		imgModel = ImageModel
	}
	tool := map[string]any{
		"type":           "image_generation",
		"model":          imgModel,
		"action":         action,
		"size":           size,
		"quality":        quality,
		"output_format":  outputFormat,
		"moderation":     "low",
		"partial_images": 0,
	}
	if opts.BackgroundMode == BackgroundTransparent {
		tool["background"] = "transparent"
	}
	if opts.MaskB64 != "" {
		tool["input_image_mask"] = map[string]any{
			"image_url": imageDataURLFromBase64(opts.MaskB64, "image/png"),
		}
	}
	if includeExtended && opts.Seed != 0 {
		tool["seed"] = opts.Seed
	}
	if includeExtended && strings.TrimSpace(opts.NegativePrompt) != "" {
		tool["negative_prompt"] = opts.NegativePrompt
	}
	tool["partial_images"] = effectiveResponsesPartialImages(opts)

	textModel := opts.TextModelID
	if textModel == "" {
		textModel = TextModel
	}
	payload := map[string]any{
		"model":       textModel,
		"input":       []map[string]any{{"role": "user", "content": content}},
		"tools":       []map[string]any{tool},
		"tool_choice": map[string]any{"type": "image_generation"},
		"reasoning":   map[string]any{"effort": "xhigh"},
		"store":       false,
		"stream":      true,
	}
	instructions := noPromptRevisionInstructions
	if opts.AllowPromptAdaptation {
		instructions = safeImageToolInstructions
	}
	if aspectInstruction := fhlExactResponsesAspectInstruction(opts, size); aspectInstruction != "" {
		instructions += " " + aspectInstruction
	}
	payload["instructions"] = instructions

	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(payload); err != nil {
		return nil, fmt.Errorf("encode payload: %w", err)
	}
	out := strings.TrimRight(buf.String(), "\n")
	return []byte(out), nil
}

const (
	openAIImageMinPixels = 655_360
	openAIImageMaxPixels = 8_294_400
	openAIImageMaxSide   = 3_840
	openAIImageAlignment = 16
	openAIImageMaxAspect = 3.0
)

type parsedSizeValue struct {
	width  int
	height int
}

func parseSizeValue(size string) *parsedSizeValue {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return nil
	}
	width, err := strconv.Atoi(parts[0])
	if err != nil || width <= 0 {
		return nil
	}
	height, err := strconv.Atoi(parts[1])
	if err != nil || height <= 0 {
		return nil
	}
	return &parsedSizeValue{width: width, height: height}
}

func normalizeOpenAIImageSize(size string) string {
	parsed := parseSizeValue(size)
	if parsed == nil {
		return ""
	}
	targetWidth := float64(parsed.width)
	targetHeight := float64(parsed.height)
	targetAspect := targetWidth / targetHeight
	if targetAspect < 1.0/openAIImageMaxAspect {
		targetAspect = 1.0 / openAIImageMaxAspect
	}
	if targetAspect > openAIImageMaxAspect {
		targetAspect = openAIImageMaxAspect
	}
	if math.Abs((targetWidth/targetHeight)-targetAspect) > 1e-9 {
		if targetWidth >= targetHeight {
			targetWidth = targetHeight * targetAspect
		} else {
			targetHeight = targetWidth / targetAspect
		}
	}
	maxSide := math.Max(targetWidth, targetHeight)
	if maxSide > openAIImageMaxSide {
		scale := openAIImageMaxSide / maxSide
		targetWidth *= scale
		targetHeight *= scale
	}
	pixelCount := targetWidth * targetHeight
	if pixelCount > openAIImageMaxPixels {
		scale := math.Sqrt(openAIImageMaxPixels / pixelCount)
		targetWidth *= scale
		targetHeight *= scale
	}
	if pixelCount < openAIImageMinPixels {
		scale := math.Sqrt(openAIImageMinPixels / math.Max(pixelCount, 1))
		targetWidth *= scale
		targetHeight *= scale
	}
	postFloorMaxSide := math.Max(targetWidth, targetHeight)
	if postFloorMaxSide > openAIImageMaxSide {
		scale := openAIImageMaxSide / postFloorMaxSide
		targetWidth *= scale
		targetHeight *= scale
	}
	widthCandidates := sizeCandidateSet(targetWidth, openAIImageAlignment, openAIImageMaxSide, openAIImageAlignment)
	heightCandidates := sizeCandidateSet(targetHeight, openAIImageAlignment, openAIImageMaxSide, openAIImageAlignment)
	bestWidth, bestHeight := 0, 0
	bestDistance := math.Inf(1)
	bestAspectDistance := math.Inf(1)
	bestAreaDistance := math.Inf(1)
	for _, width := range widthCandidates {
		for _, height := range heightCandidates {
			if !sizeWithinLimits(width, height) {
				continue
			}
			distance := sizeDistance(float64(width), float64(height), targetWidth, targetHeight)
			aspectDistance := math.Abs((float64(width) / float64(height)) - (targetWidth / targetHeight))
			areaDistance := math.Abs(float64(width*height)-targetWidth*targetHeight) / math.Max(targetWidth*targetHeight, 1)
			if distance < bestDistance ||
				(distance == bestDistance && aspectDistance < bestAspectDistance) ||
				(distance == bestDistance && aspectDistance == bestAspectDistance && areaDistance < bestAreaDistance) {
				bestWidth, bestHeight = width, height
				bestDistance = distance
				bestAspectDistance = aspectDistance
				bestAreaDistance = areaDistance
			}
		}
	}
	if bestWidth == 0 || bestHeight == 0 {
		return ""
	}
	return fmt.Sprintf("%dx%d", bestWidth, bestHeight)
}

func roundAligned(value float64, mode string, alignment int) int {
	scaled := value / float64(alignment)
	if math.IsNaN(scaled) || math.IsInf(scaled, 0) {
		return 0
	}
	switch mode {
	case "down":
		return int(math.Floor(scaled)) * alignment
	case "up":
		return int(math.Ceil(scaled)) * alignment
	default:
		return int(math.Round(scaled)) * alignment
	}
}

func sizeCandidateSet(value float64, min int, max int, alignment int) []int {
	clamped := math.Max(float64(min), math.Min(float64(max), value))
	candidates := []int{
		clampInt(roundAligned(clamped, "nearest", alignment), min, max),
		clampInt(roundAligned(clamped, "down", alignment), min, max),
		clampInt(roundAligned(clamped, "up", alignment), min, max),
	}
	seen := map[int]struct{}{}
	uniq := make([]int, 0, len(candidates))
	for _, candidate := range candidates {
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		uniq = append(uniq, candidate)
	}
	sort.Slice(uniq, func(i, j int) bool {
		left := math.Abs(float64(uniq[i]) - clamped)
		right := math.Abs(float64(uniq[j]) - clamped)
		if left == right {
			return uniq[i] > uniq[j]
		}
		return left < right
	})
	return uniq
}

func sizeWithinLimits(width int, height int) bool {
	if width < openAIImageAlignment || height < openAIImageAlignment {
		return false
	}
	if width%openAIImageAlignment != 0 || height%openAIImageAlignment != 0 {
		return false
	}
	if width > openAIImageMaxSide || height > openAIImageMaxSide {
		return false
	}
	pixels := width * height
	if pixels < openAIImageMinPixels || pixels > openAIImageMaxPixels {
		return false
	}
	aspect := float64(width) / float64(height)
	return aspect <= openAIImageMaxAspect && aspect >= 1.0/openAIImageMaxAspect
}

func sizeDistance(width float64, height float64, targetWidth float64, targetHeight float64) float64 {
	return math.Abs(width-targetWidth)/math.Max(targetWidth, 1) + math.Abs(height-targetHeight)/math.Max(targetHeight, 1)
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func normalizePartialImages(value int) int {
	if value <= 0 {
		return DefaultPartialImages
	}
	if value > 3 {
		return 3
	}
	return value
}

func effectiveResponsesPartialImages(opts Options) int {
	if shouldDisablePartialImagesForFHLExactResponses(opts) {
		return 0
	}
	return normalizePartialImages(opts.PartialImages)
}

func shouldDisablePartialImagesForFHLExactResponses(opts Options) bool {
	if opts.APIMode != "" && opts.APIMode != APIModeResponses {
		return false
	}
	if !isFHLBaseURL(opts.BaseURL) || !isGPTImage2Model(opts.ImageModelID) {
		return false
	}
	size := strings.ToLower(strings.TrimSpace(opts.Size))
	return size != "" && size != "auto" && isExactSizeString(size)
}

func fhlExactResponsesAspectInstruction(opts Options, size string) string {
	if !shouldDisablePartialImagesForFHLExactResponses(opts) {
		return ""
	}
	parsed := parseSizeValue(size)
	if parsed == nil {
		return ""
	}
	width, height := parsed.width, parsed.height
	divisor := gcd(width, height)
	if divisor <= 0 {
		return ""
	}
	aspect := fmt.Sprintf("%d:%d", width/divisor, height/divisor)
	orientation := "square"
	if width > height {
		orientation = "landscape"
	} else if height > width {
		orientation = "portrait"
	}
	return fmt.Sprintf("The selected output aspect ratio is %s (%s). The image_generation result MUST use a %s canvas and must not return any other aspect ratio.", aspect, orientation, aspect)
}
func fhlExactResponsesAspectPromptSuffix(opts Options, size string) string {
	if !shouldDisablePartialImagesForFHLExactResponses(opts) {
		return ""
	}
	parsed := parseSizeValue(size)
	if parsed == nil {
		return ""
	}
	width, height := parsed.width, parsed.height
	divisor := gcd(width, height)
	if divisor <= 0 {
		return ""
	}
	aspect := fmt.Sprintf("%d:%d", width/divisor, height/divisor)
	if width == height {
		return fmt.Sprintf("请严格按照 %s 正方形画幅生成最终图片，整张图片必须为 %s 比例。", aspect, aspect)
	}
	if height > width {
		return fmt.Sprintf("请严格按照 %s 竖版画幅生成最终图片，整张图片必须为 %s 竖向构图，不要正方形，不要横版。", aspect, aspect)
	}
	return fmt.Sprintf("请严格按照 %s 横版画幅生成最终图片，整张图片必须为 %s 横向构图，不要正方形，不要竖版。", aspect, aspect)
}
func gcd(a, b int) int {
	if a < 0 {
		a = -a
	}
	if b < 0 {
		b = -b
	}
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

var slugRe = regexp.MustCompile(`-{2,}`)

// Slugify mirrors Python's slugify: keep ASCII word chars and CJK; collapse separators.
func Slugify(text, fallback string) string {
	text = strings.ToLower(strings.TrimSpace(text))

	var b strings.Builder
	for _, r := range text {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), r == '_':
			b.WriteRune(r)
		case r >= 0x4e00 && r <= 0x9fff:
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	s := slugRe.ReplaceAllString(b.String(), "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		// Truncate by rune count, not byte count, to avoid splitting CJK.
		runes := []rune(s)
		if len(runes) > 40 {
			s = string(runes[:40])
		}
	}
	if s == "" {
		if fallback == "" {
			return "image"
		}
		return fallback
	}
	return s
}

// NormalizePath strips surrounding quotes and expands ~ like Python's normalize_path_input.
func NormalizePath(raw string) (string, error) {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.Trim(cleaned, `"`)
	cleaned = strings.Trim(cleaned, `'`)
	if cleaned == "" {
		return "", fmt.Errorf("image path must not be empty")
	}
	if strings.HasPrefix(cleaned, "~") {
		home, err := os.UserHomeDir()
		if err == nil {
			cleaned = filepath.Join(home, strings.TrimPrefix(cleaned, "~"))
		}
	}
	return cleaned, nil
}

// ImageFileToDataURL reads a local image and returns a base64 data: URL.
func ImageFileToDataURL(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("image file not found: %s", path)
	}
	if info.IsDir() {
		return "", fmt.Errorf("image path points to a directory: %s", path)
	}
	ext := strings.ToLower(filepath.Ext(path))
	mime, ok := SupportedImageMime[ext]
	if !ok {
		supported := strings.Join([]string{".jpeg", ".jpg", ".png", ".webp"}, ", ")
		extLabel := ext
		if extLabel == "" {
			extLabel = "(no extension)"
		}
		return "", fmt.Errorf("unsupported image extension %s; supported: %s", extLabel, supported)
	}
	if info.Size() > MaxInputImageBytes {
		return "", fmt.Errorf("image file exceeds 50 MB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mime, encoded), nil
}
func imageDataURLFromBase64(raw, mime string) string {
	encoded := strings.TrimSpace(raw)
	if encoded == "" {
		return ""
	}
	cleanMime := strings.TrimSpace(mime)
	if cleanMime == "" {
		cleanMime = "image/png"
	}
	return fmt.Sprintf("data:%s;base64,%s", cleanMime, encoded)
}

func normalizeRequestPolicy(policy RequestPolicy) RequestPolicy {
	if policy == RequestPolicyCompat {
		return RequestPolicyCompat
	}
	return RequestPolicyOpenAI
}

func shouldSendExtendedImageParameters(policy RequestPolicy) bool {
	return normalizeRequestPolicy(policy) == RequestPolicyCompat
}

// FormatBytes mirrors Python's format_bytes.
func FormatBytes(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}
	if size < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(size)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(size)/1024/1024)
}
