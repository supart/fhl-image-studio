package main

import (
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func TestCreateContactSheetFallback(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "main.png")
	b := filepath.Join(dir, "ref.png")
	writeTestPNG(t, a, color.RGBA{R: 255, A: 255})
	writeTestPNG(t, b, color.RGBA{B: 255, A: 255})

	out, err := createContactSheetFallback([]string{a, b}, dir, "20260602-200000")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, filepath.Join("fallback-inputs", "contact-sheet-20260602-200000.jpg")) {
		t.Fatalf("unexpected fallback path: %s", out)
	}
	f, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 1536 || img.Bounds().Dy() != 1536 {
		t.Fatalf("contact sheet size = %dx%d, want 1536x1536", img.Bounds().Dx(), img.Bounds().Dy())
	}
}

func TestShouldNotFallbackFHLGPTImage2EditToContactSheet(t *testing.T) {
	dir := t.TempDir()
	raw := filepath.Join(dir, "raw.json")
	if err := os.WriteFile(raw, []byte(`{"error":{"message":"无可用账号，请稍后重试","type":"upstream_error"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	opts := cliOptions{
		mode:         client.ModeEdit,
		apiMode:      client.APIModeImages,
		baseURL:      defaultBaseURL,
		imageModelID: "gpt-image-2",
		imagePaths:   []string{"a.png", "b.png"},
	}
	err := errors.New("上游返回 503:无可用账号，请稍后重试")
	if shouldFallbackEditToContactSheet(opts, err, raw) {
		t.Fatal("FHL gpt-image-2 must preserve native multi-reference semantics")
	}
}

func TestShouldFallbackLegacyEditToContactSheetForFHLBusy(t *testing.T) {
	dir := t.TempDir()
	raw := filepath.Join(dir, "raw.json")
	if err := os.WriteFile(raw, []byte(`{"error":{"message":"无可用账号，请稍后重试","type":"upstream_error"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	opts := cliOptions{
		mode:         client.ModeEdit,
		apiMode:      client.APIModeImages,
		baseURL:      defaultBaseURL,
		imageModelID: "legacy-image-model",
		imagePaths:   []string{"a.png", "b.png"},
	}
	err := errors.New("上游返回 503:无可用账号，请稍后重试")
	if !shouldFallbackEditToContactSheet(opts, err, raw) {
		t.Fatal("expected legacy contact sheet fallback")
	}
}

func TestImageOutputDirForSourceEvent(t *testing.T) {
	root := t.TempDir()
	outDir := filepath.Join(root, "output")

	if got := imageOutputDirForSourceEvent(outDir, "final"); got != outDir {
		t.Fatalf("final output dir = %s, want %s", got, outDir)
	}
	if got := imageOutputDirForSourceEvent(outDir, "images_api"); got != outDir {
		t.Fatalf("images_api output dir = %s, want %s", got, outDir)
	}
	if got := imageOutputDirForSourceEvent(outDir, "partial"); got != filepath.Join(root, "intermediate") {
		t.Fatalf("partial output dir = %s, want intermediate sibling", got)
	}
	if got := imageOutputDirForSourceEvent(outDir, "images_api_partial"); got != filepath.Join(root, "intermediate") {
		t.Fatalf("images_api_partial output dir = %s, want intermediate sibling", got)
	}
}

func TestShouldPreferResponsesForExactFHLSize(t *testing.T) {
	tests := []struct {
		name string
		opts cliOptions
		want bool
	}{
		{
			name: "keeps FHL gpt-image-2 4K portrait exact size on Images",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "2160x3840"},
			want: false,
		},
		{
			name: "keeps FHL gpt-image-2 7:4 exact size on Images",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "1664x944"},
			want: false,
		},
		{
			name: "reroutes non gpt-image-2 FHL 7:4 exact size",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, imageModelID: "legacy-image-model", size: "1664x944"},
			want: true,
		},
		{
			name: "keeps safe Android 1K portrait size on images",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "864x1536"},
			want: false,
		},
		{
			name: "keeps safe Android 1K landscape size on images",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "1536x1024"},
			want: false,
		},
		{
			name: "does not reroute non-FHL upstreams",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: "https://upstream.example", size: "2160x3840"},
			want: false,
		},
		{
			name: "does not reroute non-exact sizes",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "auto"},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldPreferResponsesForExactFHLSize(tt.opts); got != tt.want {
				t.Fatalf("shouldPreferResponsesForExactFHLSize() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStableFHLImagesSize(t *testing.T) {
	tests := []struct {
		name string
		opts cliOptions
		want string
	}{
		{
			name: "keeps FHL gpt-image-2 9:16 exact size",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "1152x2048"},
			want: "1152x2048",
		},
		{
			name: "keeps FHL gpt-image-2 16:9 exact size",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "2048x1152"},
			want: "2048x1152",
		},
		{
			name: "maps non gpt-image-2 FHL 9:16 exact size to stable portrait",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, imageModelID: "legacy-image-model", size: "1152x2048"},
			want: "864x1536",
		},
		{
			name: "maps non gpt-image-2 FHL 16:9 exact size to stable landscape",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, imageModelID: "legacy-image-model", size: "2048x1152"},
			want: "1536x864",
		},
		{
			name: "keeps stable FHL size",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: defaultBaseURL, size: "864x1536"},
			want: "864x1536",
		},
		{
			name: "does not map non-FHL upstream",
			opts: cliOptions{apiMode: client.APIModeImages, baseURL: "https://upstream.example", size: "1152x2048"},
			want: "1152x2048",
		},
		{
			name: "does not map Responses mode",
			opts: cliOptions{apiMode: client.APIModeResponses, baseURL: defaultBaseURL, size: "1152x2048"},
			want: "1152x2048",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stableFHLImagesSize(tt.opts); got != tt.want {
				t.Fatalf("stableFHLImagesSize() = %q, want %q", got, tt.want)
			}
		})
	}
}

func writeTestPNG(t *testing.T, path string, c color.Color) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 80, 60))
	for y := 0; y < img.Bounds().Dy(); y++ {
		for x := 0; x < img.Bounds().Dx(); x++ {
			img.Set(x, y, c)
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeAPIModeAcceptsAPIMart(t *testing.T) {
	got, err := normalizeAPIMode("apimart")
	if err != nil {
		t.Fatalf("normalizeAPIMode returned error: %v", err)
	}
	if got != client.APIModeApimart {
		t.Fatalf("normalizeAPIMode = %q, want %q", got, client.APIModeApimart)
	}
}

func TestNormalizeAPIModeAcceptsRunningHub(t *testing.T) {
	got, err := normalizeAPIMode("runninghub")
	if err != nil {
		t.Fatalf("normalizeAPIMode returned error: %v", err)
	}
	if got != client.APIModeRunningHub {
		t.Fatalf("normalizeAPIMode = %q, want %q", got, client.APIModeRunningHub)
	}
}

func TestBuildOptionsRunningHubDoesNotRequireAPIKey(t *testing.T) {
	opts, err := buildOptions([]string{
		"--api-mode", "runninghub",
		"--prompt", "cli bridge check",
		"--config", filepath.Join(t.TempDir(), "missing.env"),
	}, true)
	if err != nil {
		t.Fatalf("buildOptions returned error: %v", err)
	}
	if opts.apiMode != client.APIModeRunningHub {
		t.Fatalf("apiMode = %q, want runninghub", opts.apiMode)
	}
	if opts.apiKey != "" {
		t.Fatalf("apiKey should stay empty for RunningHub")
	}
	if opts.baseURL != defaultRunningHubURL {
		t.Fatalf("baseURL = %q, want %q", opts.baseURL, defaultRunningHubURL)
	}
}

func TestStatusDoesNotRequirePromptAndMasksAPIKey(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "cli.env.local")
	secret := "sk-never-print-this"
	if err := os.WriteFile(cfg, []byte(strings.Join([]string{
		"IMAGE_STUDIO_API_KEY=" + secret,
		"IMAGE_STUDIO_API_MODE=apimart",
		"IMAGE_STUDIO_UPSTREAM_BASE_URL=https://api.apimart.ai",
		"IMAGE_STUDIO_TEXT_MODEL=gpt-4o-mini",
		"IMAGE_STUDIO_IMAGE_MODEL=gpt-image-2",
		"IMAGE_STUDIO_SIZE=9:16@1k",
		"IMAGE_STUDIO_QUALITY=low",
	}, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}

	inputDir := filepath.Join(dir, "input")
	outDir := filepath.Join(dir, "output")
	rawDir := filepath.Join(outDir, "log")
	result, err := run([]string{
		"--status",
		"--config", cfg,
		"--input-dir", inputDir,
		"--out-dir", outDir,
		"--raw-dir", rawDir,
	}, false)
	if err != nil {
		t.Fatalf("status returned error: %v", err)
	}
	if !result.OK || result.APIMode != "apimart" {
		t.Fatalf("status result = %#v", result)
	}
	if result.APIKeyConfigured == nil || *result.APIKeyConfigured != true {
		t.Fatalf("apiKeyConfigured = %v, want true", result.APIKeyConfigured)
	}
	if result.APIKeySource != "config" {
		t.Fatalf("apiKeySource = %q, want config", result.APIKeySource)
	}
	if _, err := os.Stat(inputDir); err != nil {
		t.Fatalf("input dir was not created: %v", err)
	}
	if _, err := os.Stat(rawDir); err != nil {
		t.Fatalf("raw dir was not created: %v", err)
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), secret) {
		t.Fatalf("status leaked API key: %s", data)
	}
}

func TestStatusRunningHubUsesBridgeKeySource(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/config" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true,"config":{"api_key_configured":true}}`)
	}))
	defer srv.Close()

	result, err := run([]string{
		"--status",
		"--api-mode", "runninghub",
		"--base-url", srv.URL,
		"--image-model", "banana2",
		"--config", filepath.Join(t.TempDir(), "missing.env"),
	}, false)
	if err != nil {
		t.Fatalf("status returned error: %v", err)
	}
	if result.APIKeySource != "bridge" {
		t.Fatalf("apiKeySource = %q, want bridge", result.APIKeySource)
	}
	if result.APIKeyConfigured == nil || *result.APIKeyConfigured != true {
		t.Fatalf("apiKeyConfigured = %v, want true", result.APIKeyConfigured)
	}
	if result.RunningHubReachable == nil || *result.RunningHubReachable != true {
		t.Fatalf("runningHubBridgeReachable = %v, want true", result.RunningHubReachable)
	}
	if result.RunningHubKeyConfigured == nil || *result.RunningHubKeyConfigured != true {
		t.Fatalf("runningHubAPIKeyConfigured = %v, want true", result.RunningHubKeyConfigured)
	}
	if result.ImageModelID != "banana2" {
		t.Fatalf("imageModel = %q, want banana2", result.ImageModelID)
	}
}
