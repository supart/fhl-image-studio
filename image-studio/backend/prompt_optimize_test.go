package backend

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func TestFlattenTransparentImageRewritesPNG(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "transparent.png")
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 0, B: 0, A: 0})
	img.SetNRGBA(1, 0, color.NRGBA{R: 0, G: 255, B: 0, A: 255})
	img.SetNRGBA(0, 1, color.NRGBA{R: 0, G: 0, B: 255, A: 255})
	img.SetNRGBA(1, 1, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	rewritten, tmp, err := flattenTransparentImage(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if rewritten == srcPath {
		t.Fatal("expected transparent PNG to be rewritten")
	}
	if tmp == "" {
		t.Fatal("expected temp file path")
	}
	defer os.Remove(tmp)

	got, err := os.ReadFile(rewritten)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(got, []byte("\x89PNG")) {
		t.Fatalf("rewritten file is not png: %q", got[:8])
	}
}

func TestFlattenOpaquePNGKeepsOriginalPath(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "opaque.png")
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	rewritten, tmp, err := flattenTransparentImage(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if rewritten != srcPath {
		t.Fatalf("opaque png should not be rewritten, got %s", rewritten)
	}
	if tmp != "" {
		t.Fatalf("opaque png should not create temp file, got %s", tmp)
	}
}

func TestExtractResponseTextPrefersOutputText(t *testing.T) {
	raw := []byte(`{"output_text":"优化后的 prompt"}`)
	if got := extractResponseText(raw); got != "优化后的 prompt" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractResponseTextFromStreamDeltas(t *testing.T) {
	raw := []byte(strings.Join([]string{
		`data: {"type":"response.output_text.delta","delta":"优化后的 "}`,
		`data: {"type":"response.output_text.delta","delta":"prompt"}`,
		`data: [DONE]`,
	}, "\n"))
	if got := extractResponseText(raw); got != "优化后的 prompt" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractResponseTextFromChatCompletionCompat(t *testing.T) {
	raw := []byte(`{"choices":[{"message":{"role":"assistant","content":"兼容层 prompt"}}]}`)
	if got := extractResponseText(raw); got != "兼容层 prompt" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractResponseTextFromNestedResponsesMessageText(t *testing.T) {
	raw := []byte(`{"id":"resp_test","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"text","text":{"value":"nested reverse prompt"}}]}]}`)
	if got := extractResponseText(raw); got != "nested reverse prompt" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractResponseTextFromUntypedNestedResponsesContent(t *testing.T) {
	raw := []byte(`{"id":"resp_test","status":"completed","output":[{"type":"message","role":"assistant","content":[{"text":"untyped reverse prompt"}]}]}`)
	if got := extractResponseText(raw); got != "untyped reverse prompt" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractResponseErrorMessage(t *testing.T) {
	raw := []byte(`{"error":{"message":"boom"}}`)
	if got := extractResponseErrorMessage(raw); got != "boom" {
		t.Fatalf("got %q", got)
	}
}

func TestOptimizePromptRejectsEmptyPrompt(t *testing.T) {
	if _, err := optimizePromptWithLLM(t.Context(), "https://example.com", "sk-test", "", "generate", "   ", "", nil, client.ProxyConfig{}); err == nil || !strings.Contains(err.Error(), "提示词") {
		t.Fatalf("expected prompt error, got %v", err)
	}
}

func TestOptimizePromptUsesBaseInstructionsWithoutGuidance(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output_text":"optimized prompt"}`))
	}))
	defer server.Close()

	got, err := optimizePromptWithLLM(t.Context(), server.URL, "sk-test", "gpt-test", "generate", "cat", "", nil, client.ProxyConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if got != "optimized prompt" {
		t.Fatalf("unexpected response %q", got)
	}
	if payload["instructions"] != promptOptimizeBaseInstructions {
		t.Fatalf("unexpected base instructions: %q", payload["instructions"])
	}
	input := payload["input"].([]any)
	content := input[0].(map[string]any)["content"].([]any)
	text := content[0].(map[string]any)["text"].(string)
	if text != "Original prompt:\ncat" {
		t.Fatalf("unexpected payload text: %q", text)
	}
}

func TestOptimizePromptIncludesGuidanceInPayload(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output_text":"optimized prompt"}`))
	}))
	defer server.Close()

	got, err := optimizePromptWithLLM(t.Context(), server.URL, "sk-test", "gpt-test", "generate", "cat", "more cinematic lighting", nil, client.ProxyConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if got != "optimized prompt" {
		t.Fatalf("unexpected response %q", got)
	}
	instructions, _ := payload["instructions"].(string)
	if !strings.Contains(instructions, "required modification direction") {
		t.Fatalf("instructions missing guidance rule: %q", instructions)
	}
	if !strings.Contains(instructions, "mandatory edit") {
		t.Fatalf("instructions missing mandatory edit rule: %q", instructions)
	}
	if payload["stream"] != true {
		t.Fatalf("prompt optimization should request stream response, got %#v", payload["stream"])
	}
	input := payload["input"].([]any)
	content := input[0].(map[string]any)["content"].([]any)
	text := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "Required modification direction:\nmore cinematic lighting") {
		t.Fatalf("payload text missing guidance: %q", text)
	}
}

func TestReversePromptIncludesImageInPayload(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "source.png")
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 120, G: 90, B: 60, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output_text":"a detailed generated prompt"}`))
	}))
	defer server.Close()

	got, err := reversePromptWithLLM(t.Context(), server.URL, "sk-test", "gpt-test", []string{srcPath}, client.ProxyConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if got != "a detailed generated prompt" {
		t.Fatalf("unexpected response %q", got)
	}
	instructions, _ := payload["instructions"].(string)
	if !strings.Contains(instructions, "Simplified Chinese text-to-image prompt") || !strings.Contains(instructions, "must be in Simplified Chinese") {
		t.Fatalf("instructions missing reverse prompt rule: %q", instructions)
	}
	if payload["stream"] != true {
		t.Fatalf("reverse prompt should request stream response, got %#v", payload["stream"])
	}
	input := payload["input"].([]any)
	content := input[0].(map[string]any)["content"].([]any)
	if content[0].(map[string]any)["text"] != promptReverseUserText {
		t.Fatalf("unexpected user text: %#v", content[0])
	}
	if content[1].(map[string]any)["type"] != "input_image" {
		t.Fatalf("missing input_image: %#v", content)
	}
	if !strings.HasPrefix(content[1].(map[string]any)["image_url"].(string), "data:image/png;base64,") {
		t.Fatalf("unexpected image data URL: %#v", content[1])
	}
}

func TestPrepareUploadSourcePathsReturnsOpaquePath(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "opaque.png")
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	paths, cleanup, err := prepareUploadSourcePaths([]string{srcPath})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if len(paths) != 1 || paths[0] != srcPath {
		t.Fatalf("unexpected paths: %#v", paths)
	}
}

func TestPrepareUploadSourcePathsKeepsPreparedBaseAndCompressesReferences(t *testing.T) {
	dir := t.TempDir()
	basePath := filepath.Join(dir, "prepared-base.png")
	referencePath := filepath.Join(dir, "reference.png")
	writeTestPNG(t, basePath, 2400, 1200, color.NRGBA{R: 20, G: 80, B: 160, A: 255})
	writeTestPNG(t, referencePath, 2400, 1200, color.NRGBA{R: 160, G: 80, B: 20, A: 255})

	paths, cleanup, err := prepareUploadSourcePathsWithPreparedBase([]string{basePath, referencePath}, true)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if len(paths) != 2 || paths[0] != basePath {
		t.Fatalf("prepared base was rewritten: %#v", paths)
	}
	if paths[1] == referencePath {
		t.Fatalf("reference should retain ordinary upload compression: %#v", paths)
	}
	width, height := decodeJPEGSize(t, paths[1])
	if width != 1600 || height != 800 {
		t.Fatalf("reference size = %dx%d, want 1600x800", width, height)
	}
}

func TestPrepareTextModelUploadSingleLargeImageUses1600LongSide(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "large.png")
	writeTestPNG(t, srcPath, 2400, 1200, color.NRGBA{R: 20, G: 80, B: 160, A: 255})

	paths, summary, cleanup, err := prepareTextModelUploadSourcePaths([]string{srcPath}, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if summary.Count != 1 || summary.MaxLongSide != 1600 || summary.Compressed != 1 {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if len(paths) != 1 || paths[0] == srcPath {
		t.Fatalf("expected compressed temp path, got %#v", paths)
	}
	width, height := decodeJPEGSize(t, paths[0])
	if width != 1600 || height != 800 {
		t.Fatalf("compressed size = %dx%d, want 1600x800", width, height)
	}
}

func TestPrepareTextModelUploadTwoImagesUses1280LongSide(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first.png")
	second := filepath.Join(dir, "second.png")
	writeTestPNG(t, first, 2400, 1200, color.NRGBA{R: 220, G: 80, B: 80, A: 255})
	writeTestPNG(t, second, 2000, 1000, color.NRGBA{R: 80, G: 220, B: 80, A: 255})

	paths, summary, cleanup, err := prepareTextModelUploadSourcePaths([]string{first, second}, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if summary.Count != 2 || summary.MaxLongSide != 1280 || summary.Compressed != 2 {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	for i, path := range paths {
		width, _ := decodeJPEGSize(t, path)
		if width != 1280 {
			t.Fatalf("paths[%d] width = %d, want 1280", i, width)
		}
	}
}

func TestPrepareTextModelUploadThreeImagesUses1024LongSide(t *testing.T) {
	dir := t.TempDir()
	sources := []string{
		filepath.Join(dir, "a.png"),
		filepath.Join(dir, "b.png"),
		filepath.Join(dir, "c.png"),
	}
	for _, path := range sources {
		writeTestPNG(t, path, 2048, 1024, color.NRGBA{R: 120, G: 120, B: 220, A: 255})
	}

	paths, summary, cleanup, err := prepareTextModelUploadSourcePaths(sources, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if summary.Count != 3 || summary.MaxLongSide != 1024 || summary.Compressed != 3 {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	for i, path := range paths {
		width, _ := decodeJPEGSize(t, path)
		if width != 1024 {
			t.Fatalf("paths[%d] width = %d, want 1024", i, width)
		}
	}
}

func TestPrepareTextModelUploadSmallOpaqueImageKeepsOriginal(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "small.png")
	writeTestPNG(t, srcPath, 320, 160, color.NRGBA{R: 10, G: 20, B: 30, A: 255})

	paths, summary, cleanup, err := prepareTextModelUploadSourcePaths([]string{srcPath}, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if summary.Count != 1 || summary.Compressed != 0 {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if len(paths) != 1 || paths[0] != srcPath {
		t.Fatalf("small opaque image should keep original path, got %#v", paths)
	}
}

func TestPrepareTextModelUploadTransparentPNGBecomesWhiteJPEG(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "transparent.png")
	img := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 0, B: 0, A: 0})
	img.SetNRGBA(1, 0, color.NRGBA{R: 0, G: 255, B: 0, A: 255})
	writeTestImagePNG(t, srcPath, img)

	paths, summary, cleanup, err := prepareTextModelUploadSourcePaths([]string{srcPath}, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if summary.Compressed != 1 {
		t.Fatalf("expected transparent png compression, got %#v", summary)
	}
	if len(paths) != 1 || paths[0] == srcPath {
		t.Fatalf("expected jpeg temp path, got %#v", paths)
	}
	data, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(data, []byte{0xff, 0xd8}) {
		t.Fatalf("expected jpeg temp file, got first bytes %#v", data[:2])
	}
}

func TestPrepareTextModelUploadCleanupRemovesTempFiles(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "large.png")
	writeTestPNG(t, srcPath, 2400, 1200, color.NRGBA{R: 80, G: 80, B: 220, A: 255})

	paths, _, cleanup, err := prepareTextModelUploadSourcePaths([]string{srcPath}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] == srcPath {
		t.Fatalf("expected temp path, got %#v", paths)
	}
	tmpPath := paths[0]
	cleanup()
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatalf("expected temp file cleanup, stat err = %v", err)
	}
}

func TestPrepareTextModelUploadUndecodableImageFallsBackOriginal(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "broken.gif")
	if err := os.WriteFile(srcPath, []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}

	paths, summary, cleanup, err := prepareTextModelUploadSourcePaths([]string{srcPath}, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if summary.Compressed != 0 {
		t.Fatalf("broken image should not be compressed: %#v", summary)
	}
	if len(paths) != 1 || paths[0] != srcPath {
		t.Fatalf("broken image should fall back original path, got %#v", paths)
	}
}

func writeTestPNG(t *testing.T, path string, width, height int, c color.NRGBA) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
	writeTestImagePNG(t, path, img)
}

func writeTestImagePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func decodeJPEGSize(t *testing.T, path string) (int, int) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	cfg, err := jpeg.DecodeConfig(f)
	if err != nil {
		t.Fatal(err)
	}
	return cfg.Width, cfg.Height
}
