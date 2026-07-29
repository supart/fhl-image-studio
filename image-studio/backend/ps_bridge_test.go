package backend

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const psBridgeTestToken = "ps-bridge-test-token"

type psBridgeCapturedEvents struct {
	mu     sync.Mutex
	events []string
	args   [][]any
}

func (c *psBridgeCapturedEvents) sink(eventName string, args ...any) {
	c.mu.Lock()
	c.events = append(c.events, eventName)
	c.args = append(c.args, append([]any(nil), args...))
	c.mu.Unlock()
}

func (c *psBridgeCapturedEvents) count(eventName string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	count := 0
	for _, candidate := range c.events {
		if candidate == eventName {
			count++
		}
	}
	return count
}

func (c *psBridgeCapturedEvents) firstArg(eventName string) any {
	c.mu.Lock()
	defer c.mu.Unlock()
	for index, candidate := range c.events {
		if candidate == eventName && len(c.args[index]) > 0 {
			return c.args[index][0]
		}
	}
	return nil
}

func newPSBridgeHandlerTest(t *testing.T) (*Service, *PSBridge, *psBridgeCapturedEvents) {
	t.Helper()
	service := NewService()
	service.apiKeys = &memoryAPIKeyStore{values: map[string]string{}}
	captured := &psBridgeCapturedEvents{}
	service.SetEventSink(captured.sink)
	bridge := service.psBridge
	bridge.mu.Lock()
	bridge.sessionToken = psBridgeTestToken
	bridge.instanceID = "test-instance"
	bridge.port = psBridgePortFirst
	bridge.mu.Unlock()
	return service, bridge, captured
}

func syncPSBridgeRemoteProfile(t *testing.T, bridge *PSBridge, mode string) {
	t.Helper()
	credentialUser := ""
	if mode != "runninghub" {
		credentialUser = "profile:ps-bridge-test"
		if err := bridge.service.SetStoredAPIKey(credentialUser, "sk-ps-bridge-secret"); err != nil {
			t.Fatalf("store test credential: %v", err)
		}
	}
	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID:      "ps-bridge-test",
		Name:           "PS Bridge Test",
		APIMode:        mode,
		BaseURL:        "http://127.0.0.1:9999/v1",
		CredentialUser: credentialUser,
		ImageModelID:   "test-image-model",
	})
	if err != nil {
		t.Fatalf("sync test profile: %v", err)
	}
	if !status.ProfileReady {
		t.Fatal("test profile should be ready")
	}
}

func servePSBridgeRequest(bridge *PSBridge, request *http.Request) *httptest.ResponseRecorder {
	if request.Host == "" {
		request.Host = "127.0.0.1:" + strconv.Itoa(psBridgePortFirst)
	}
	if request.RemoteAddr == "" || strings.HasPrefix(request.RemoteAddr, "192.0.2.") {
		request.RemoteAddr = "127.0.0.1:54321"
	}
	recorder := httptest.NewRecorder()
	bridge.Handler().ServeHTTP(recorder, request)
	return recorder
}

func newAuthorizedPSBridgeRequest(method, path string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, "http://127.0.0.1"+path, body)
	request.Header.Set("Authorization", "Bearer "+psBridgeTestToken)
	request.Host = "127.0.0.1:" + strconv.Itoa(psBridgePortFirst)
	request.RemoteAddr = "127.0.0.1:54321"
	return request
}

func tinyPSBridgePNG(t *testing.T) []byte {
	return psBridgePNG(t, 3, 2)
}

func psBridgePNG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < canvas.Bounds().Dy(); y++ {
		for x := 0; x < canvas.Bounds().Dx(); x++ {
			canvas.SetNRGBA(x, y, color.NRGBA{R: uint8(40 + x*20), G: uint8(90 + y*30), B: 180, A: 255})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		t.Fatalf("encode test PNG: %v", err)
	}
	return output.Bytes()
}

func psBridgeJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	var output bytes.Buffer
	if err := jpeg.Encode(&output, canvas, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode test JPEG: %v", err)
	}
	return output.Bytes()
}

type psBridgeZeroReader struct{}

func (psBridgeZeroReader) Read(buffer []byte) (int, error) {
	clear(buffer)
	return len(buffer), nil
}

func psBridgeMultipartImageHeader(t *testing.T, imageSize int64) *multipart.FileHeader {
	t.Helper()
	body, err := os.CreateTemp(t.TempDir(), "ps-bridge-image-*.multipart")
	if err != nil {
		t.Fatal(err)
	}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("base", "base.png")
	if err != nil {
		t.Fatal(err)
	}
	imageBytes := tinyPSBridgePNG(t)
	if imageSize < int64(len(imageBytes)) {
		t.Fatalf("multipart image size %d is smaller than PNG fixture %d", imageSize, len(imageBytes))
	}
	if _, err := part.Write(imageBytes); err != nil {
		t.Fatal(err)
	}
	if _, err := io.CopyN(part, psBridgeZeroReader{}, imageSize-int64(len(imageBytes))); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := body.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/fhl-ps/v1/jobs", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(psBridgeMultipartMemory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if request.MultipartForm != nil {
			_ = request.MultipartForm.RemoveAll()
		}
		_ = request.Body.Close()
	})
	files := request.MultipartForm.File["base"]
	if len(files) != 1 {
		t.Fatalf("multipart base files = %d, want 1", len(files))
	}
	return files[0]
}

func newPSBridgeContractJobRequest(t *testing.T, clientTaskID string, canvasWidth, canvasHeight int, preparedBase bool, base, mask []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"clientTaskId": clientTaskID,
		"mode":         "edit",
		"prompt":       "replace the selected area",
		"size":         "1:1@1k",
		"aspect":       "1:1",
		"resolution":   "1k",
		"canvasWidth":  strconv.Itoa(canvasWidth),
		"canvasHeight": strconv.Itoa(canvasHeight),
		"preparedBase": strconv.FormatBool(preparedBase),
		"quality":      "medium",
		"outputFormat": "png",
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write multipart field: %v", err)
		}
	}
	basePart, err := writer.CreateFormFile("base", "base.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := basePart.Write(base); err != nil {
		t.Fatal(err)
	}
	if mask != nil {
		maskPart, err := writer.CreateFormFile("mask", "mask.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := maskPart.Write(mask); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := newAuthorizedPSBridgeRequest(http.MethodPost, "/fhl-ps/v1/jobs", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func newPSBridgeOutputContractRequest(values url.Values) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/fhl-ps/v1/jobs", strings.NewReader(values.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return request
}

func newPSBridgeJobRequest(t *testing.T, clientTaskID, mode, size string, baseCount, referenceCount int) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"clientTaskId": clientTaskID,
		"mode":         mode,
		"prompt":       "replace the selected area",
		"size":         size,
		"aspect":       "1:1",
		"resolution":   "1k",
		"canvasWidth":  "1024",
		"canvasHeight": "1024",
		"preparedBase": "false",
		"quality":      "medium",
		"outputFormat": "png",
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write multipart field: %v", err)
		}
	}
	imageBytes := psBridgePNG(t, 1024, 1024)
	addImages := func(field string, count int) {
		for index := 0; index < count; index++ {
			part, err := writer.CreateFormFile(field, fmt.Sprintf("%s-%02d.png", field, index+1))
			if err != nil {
				t.Fatalf("create multipart image: %v", err)
			}
			if _, err := part.Write(imageBytes); err != nil {
				t.Fatalf("write multipart image: %v", err)
			}
		}
	}
	addImages("base", baseCount)
	addImages("reference", referenceCount)
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart request: %v", err)
	}
	request := newAuthorizedPSBridgeRequest(http.MethodPost, "/fhl-ps/v1/jobs", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func newPSBridgePromptRequest(t *testing.T, guidance string, sourceCount int) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{
		"mode": "edit", "prompt": "remove the glasses", "optimizationGuidance": guidance,
	} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	for index := 0; index < sourceCount; index++ {
		part, err := writer.CreateFormFile("source", fmt.Sprintf("source-%02d.png", index+1))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(tinyPSBridgePNG(t)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := newAuthorizedPSBridgeRequest(http.MethodPost, "/fhl-ps/v1/prompts/optimize", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func syncPSBridgePromptProfile(t *testing.T, service *Service, bridge *PSBridge) {
	t.Helper()
	promptUser := "profile:ps-bridge-prompt-endpoint"
	if err := service.SetStoredAPIKey(promptUser, strings.Join([]string{"sk", "prompt-endpoint-test"}, "-")); err != nil {
		t.Fatalf("store prompt test credential: %v", err)
	}
	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID: "prompt-endpoint-test", Name: "Prompt Endpoint Test", APIMode: "runninghub",
		BaseURL: "http://127.0.0.1:9999/v1", ImageModelID: "prompt-endpoint-image",
		PromptProfile: &PSBridgePromptProfileInput{
			Provider: "responses", Label: "Responses text", BaseURL: "https://text.example/v1",
			CredentialUser: promptUser, TextModelID: "text-test",
		},
	})
	if err != nil || status.Profile == nil || !status.Profile.PromptOptimizationReady {
		t.Fatalf("sync prompt endpoint profile status=%+v err=%v", status, err)
	}
}

func decodePSBridgeJob(t *testing.T, recorder *httptest.ResponseRecorder) PSBridgeJobSnapshot {
	t.Helper()
	var snapshot PSBridgeJobSnapshot
	if err := json.Unmarshal(recorder.Body.Bytes(), &snapshot); err != nil {
		t.Fatalf("decode job response %q: %v", recorder.Body.String(), err)
	}
	return snapshot
}

func TestPSBridgeSelectsAnotherPortWhenCandidateIsOccupied(t *testing.T) {
	var occupied net.Listener
	occupiedPort := 0
	for candidate := psBridgePortFirst; candidate < psBridgePortLast; candidate++ {
		listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(candidate)))
		if err == nil {
			occupied = listener
			occupiedPort = candidate
			break
		}
	}
	if occupied == nil {
		t.Skip("no bridge port available to reserve")
	}
	defer occupied.Close()

	service := NewService()
	bridge := service.psBridge
	if err := bridge.Start(); err != nil {
		t.Fatalf("start bridge with an occupied candidate: %v", err)
	}
	defer bridge.Stop()
	status := bridge.Status()
	if status.Port == occupiedPort {
		t.Fatalf("bridge reused occupied port %d", occupiedPort)
	}
	if status.Port < psBridgePortFirst || status.Port > psBridgePortLast {
		t.Fatalf("bridge port %d is outside the reserved range", status.Port)
	}
}

func TestPSBridgeRejectsNonLoopbackAndOrdinaryWebRequests(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)

	nonLoopback := httptest.NewRequest(http.MethodGet, "http://example.test/fhl-ps/v1/health", nil)
	nonLoopback.Host = "example.test"
	nonLoopback.RemoteAddr = "127.0.0.1:54321"
	if recorder := servePSBridgeRequest(bridge, nonLoopback); recorder.Code != http.StatusForbidden {
		t.Fatalf("non-loopback host status = %d, want %d", recorder.Code, http.StatusForbidden)
	}

	webOrigin := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/fhl-ps/v1/health", nil)
	webOrigin.Host = "127.0.0.1:" + strconv.Itoa(psBridgePortFirst)
	webOrigin.RemoteAddr = "127.0.0.1:54321"
	webOrigin.Header.Set("Origin", "http://127.0.0.1:5173")
	if recorder := servePSBridgeRequest(bridge, webOrigin); recorder.Code != http.StatusForbidden {
		t.Fatalf("ordinary web origin status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestPSBridgeProfileResponseDoesNotExposeCredentials(t *testing.T) {
	service, bridge, _ := newPSBridgeHandlerTest(t)
	credentialUser := "profile:ps-bridge-secret-profile"
	secret := strings.Join([]string{"sk", "do-not-expose-this-value"}, "-")
	if err := service.SetStoredAPIKey(credentialUser, secret); err != nil {
		t.Fatalf("store test credential: %v", err)
	}
	promptCredentialUser := "profile:ps-bridge-prompt-secret"
	promptSecret := strings.Join([]string{"sk", "prompt-do-not-expose"}, "-")
	if err := service.SetStoredAPIKey(promptCredentialUser, promptSecret); err != nil {
		t.Fatal(err)
	}
	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID:      "ps-bridge-secret-profile",
		Name:           "Secret Profile",
		APIMode:        "images",
		BaseURL:        "https://private-upstream.example/v1",
		CredentialUser: credentialUser,
		ImageModelID:   "gpt-image-test",
		ProxyMode:      "custom",
		ProxyURL:       "http://private-proxy.example:8080",
		PromptProfile: &PSBridgePromptProfileInput{
			Provider: "private-prompt-provider", Label: "Prompt Provider Label", BaseURL: "https://prompt-private.example/v1",
			CredentialUser: promptCredentialUser, TextModelID: "text-model-private",
		},
	})
	if err != nil || !status.ProfileReady {
		t.Fatalf("sync profile status=%+v err=%v", status, err)
	}

	request := newAuthorizedPSBridgeRequest(http.MethodGet, "/fhl-ps/v1/profile", nil)
	recorder := servePSBridgeRequest(bridge, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("profile status = %d: %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, forbidden := range []string{
		secret, promptSecret, credentialUser, promptCredentialUser, "private-prompt-provider", "text-model-private",
		"prompt-private.example", "private-upstream.example", "private-proxy.example", "baseURL", "proxyURL",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public profile exposed %q in %s", forbidden, body)
		}
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &fields); err != nil {
		t.Fatalf("decode public profile: %v", err)
	}
	allowedFields := map[string]bool{
		"profileId": true, "name": true, "provider": true, "apiMode": true, "imageModelID": true,
		"supportsMask": true, "maxImages": true, "ready": true,
		"promptOptimizationReady": true, "promptProviderLabel": true,
		"imageCapabilities": true,
	}
	for field := range fields {
		if !allowedFields[field] {
			t.Fatalf("public profile exposed unexpected field %q in %s", field, body)
		}
	}
	if !strings.Contains(body, "gpt-image-test") || !strings.Contains(body, `"supportsMask":true`) {
		t.Fatalf("public profile omitted required capabilities: %s", body)
	}
	if !strings.Contains(body, `"promptOptimizationReady":true`) || !strings.Contains(body, "Prompt Provider Label") {
		t.Fatalf("public prompt capability missing: %s", body)
	}
	if !strings.Contains(body, `"qualityControl":true`) || !strings.Contains(body, `"sizeEncoding":"pixels"`) {
		t.Fatalf("public image capabilities missing: %s", body)
	}
}

func TestPSBridgeMaskCapabilityMatchesTransport(t *testing.T) {
	tests := []struct {
		name  string
		input PSBridgeProfileInput
		want  bool
	}{
		{name: "responses", input: PSBridgeProfileInput{APIMode: "responses"}, want: true},
		{name: "standard images", input: PSBridgeProfileInput{APIMode: "images", BaseURL: "https://images.example"}, want: true},
		{name: "FHL images", input: PSBridgeProfileInput{APIMode: "images", BaseURL: "https://www.fhl.mom"}, want: false},
		{name: "FHL images v1", input: PSBridgeProfileInput{APIMode: "images", BaseURL: "https://www.fhl.mom/v1/"}, want: false},
		{name: "free images compatibility", input: PSBridgeProfileInput{APIMode: "images", BaseURL: "https://images.example", ImagesNewAPICompat: true}, want: false},
		{name: "APIMart", input: PSBridgeProfileInput{APIMode: "apimart"}, want: false},
		{name: "RunningHub", input: PSBridgeProfileInput{APIMode: "runninghub"}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := publicPSBridgeProfile(tt.input, true, false).SupportsMask; got != tt.want {
				t.Fatalf("SupportsMask = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestPSBridgePromptOptimizationEnforcesMethodSessionAndOrigin(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)

	t.Run("method", func(t *testing.T) {
		request := newAuthorizedPSBridgeRequest(http.MethodGet, "/fhl-ps/v1/prompts/optimize", nil)
		if recorder := servePSBridgeRequest(bridge, request); recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("GET optimize status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("session", func(t *testing.T) {
		request := newPSBridgePromptRequest(t, "", 0)
		request.Header.Del("Authorization")
		if recorder := servePSBridgeRequest(bridge, request); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("unauthorized optimize status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	})

	t.Run("origin", func(t *testing.T) {
		request := newPSBridgePromptRequest(t, "", 0)
		request.Header.Set("Origin", "http://127.0.0.1:5173")
		if recorder := servePSBridgeRequest(bridge, request); recorder.Code != http.StatusForbidden {
			t.Fatalf("web-origin optimize status = %d, want %d", recorder.Code, http.StatusForbidden)
		}
	})
}

func TestPSBridgePromptOptimizationEnforcesTenImageLimit(t *testing.T) {
	service, bridge, _ := newPSBridgeHandlerTest(t)
	syncPSBridgePromptProfile(t, service, bridge)
	bridge.optimizePrompt = func(PromptOptimizeOptions) (string, error) {
		t.Fatal("optimizer must not run when the request exceeds the image limit")
		return "", nil
	}

	recorder := servePSBridgeRequest(bridge, newPSBridgePromptRequest(t, "", psBridgeMaxImages+1))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("prompt image-limit status = %d, want %d: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
}

func TestPSBridgePromptOptimizationCleansInputsWhenOptimizerFails(t *testing.T) {
	service, bridge, _ := newPSBridgeHandlerTest(t)
	syncPSBridgePromptProfile(t, service, bridge)
	var capturedPaths []string
	bridge.optimizePrompt = func(opts PromptOptimizeOptions) (string, error) {
		capturedPaths = append([]string(nil), opts.ImagePaths...)
		if len(capturedPaths) != 1 {
			t.Fatalf("optimizer image paths = %d, want 1", len(capturedPaths))
		}
		if _, err := os.Stat(capturedPaths[0]); err != nil {
			t.Fatalf("temporary prompt input unavailable during optimization: %v", err)
		}
		return "", fmt.Errorf("synthetic upstream failure")
	}

	recorder := servePSBridgeRequest(bridge, newPSBridgePromptRequest(t, "", 1))
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("failed optimize status = %d, want %d: %s", recorder.Code, http.StatusBadGateway, recorder.Body.String())
	}
	if len(capturedPaths) != 1 {
		t.Fatalf("captured image paths = %d, want 1", len(capturedPaths))
	}
	if _, err := os.Stat(capturedPaths[0]); !os.IsNotExist(err) {
		t.Fatalf("temporary prompt input remained after optimizer failure: %v", err)
	}
}

func TestPSBridgePromptOptimizationUsesPrivateCredentialAndCleansInputs(t *testing.T) {
	service, bridge, _ := newPSBridgeHandlerTest(t)
	imageUser := "profile:ps-bridge-image"
	promptUser := "profile:ps-bridge-prompt"
	if err := service.SetStoredAPIKey(imageUser, "sk-image-private"); err != nil {
		t.Fatal(err)
	}
	if err := service.SetStoredAPIKey(promptUser, "sk-prompt-private"); err != nil {
		t.Fatal(err)
	}
	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID: "prompt-test", Name: "Prompt Test", APIMode: "images", BaseURL: "https://images.example/v1",
		CredentialUser: imageUser, ImageModelID: "image-test",
		PromptProfile: &PSBridgePromptProfileInput{Provider: "responses", Label: "Responses text", BaseURL: "https://text.example/v1", CredentialUser: promptUser, TextModelID: "text-test"},
	})
	if err != nil || !status.Profile.PromptOptimizationReady {
		t.Fatalf("prompt profile not ready: %+v %v", status, err)
	}
	var captured PromptOptimizeOptions
	bridge.optimizePrompt = func(opts PromptOptimizeOptions) (string, error) {
		captured = opts
		if len(opts.ImagePaths) != 1 {
			t.Fatalf("image paths = %d", len(opts.ImagePaths))
		}
		if _, err := os.Stat(opts.ImagePaths[0]); err != nil {
			t.Fatalf("prompt image unavailable: %v", err)
		}
		return "remove glasses, preserve identity", nil
	}
	recorder := servePSBridgeRequest(bridge, newPSBridgePromptRequest(t, "preserve identity", 1))
	if recorder.Code != http.StatusOK {
		t.Fatalf("optimize status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if captured.APIKey != "sk-prompt-private" || captured.BaseURL != "https://text.example/v1" || captured.TextModelID != "text-test" {
		t.Fatalf("unexpected prompt options: %+v", captured)
	}
	if captured.OptimizationGuidance != "preserve identity" {
		t.Fatalf("guidance=%q", captured.OptimizationGuidance)
	}
	if len(captured.ImagePaths) != 1 {
		t.Fatal("missing captured image path")
	}
	if _, err := os.Stat(captured.ImagePaths[0]); !os.IsNotExist(err) {
		t.Fatalf("temporary prompt input was not removed: %v", err)
	}
	if strings.Contains(recorder.Body.String(), "sk-prompt-private") {
		t.Fatal("prompt response exposed credential")
	}
}

func TestPSBridgeRejectsSubmissionWithoutCredential(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)
	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID:      "missing-key-profile",
		Name:           "Missing Key",
		APIMode:        "responses",
		BaseURL:        "https://example.test/v1",
		CredentialUser: "profile:missing-key-profile",
		ImageModelID:   "gpt-image-test",
	})
	if err != nil {
		t.Fatalf("sync missing-key profile: %v", err)
	}
	if status.ProfileReady {
		t.Fatal("profile without a stored credential should not be ready")
	}
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "missing-key-task", "generate", "1024x1024", 0, 0))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing-key submission status = %d, want %d: %s", recorder.Code, http.StatusServiceUnavailable, recorder.Body.String())
	}
}

func TestPSBridgeEnforcesTenImageLimit(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)
	syncPSBridgeRemoteProfile(t, bridge, "runninghub")
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "too-many-images", "edit", "1:1@1k", 1, psBridgeMaxImages))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("image-limit status = %d, want %d: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
}

func TestPSBridgeAcceptsExactlyTenImages(t *testing.T) {
	_, bridge, captured := newPSBridgeHandlerTest(t)
	syncPSBridgeRemoteProfile(t, bridge, "runninghub")
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "exactly-ten-images", "edit", "1:1@1k", 1, psBridgeMaxImages-1))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("exact image-limit status = %d, want %d: %s", recorder.Code, http.StatusAccepted, recorder.Body.String())
	}
	dispatch, ok := captured.firstArg("ps-bridge:remote-job").(PSBridgeRemoteDispatch)
	if !ok || len(dispatch.ImagePaths) != psBridgeMaxImages {
		t.Fatalf("dispatched image count = %d, want %d", len(dispatch.ImagePaths), psBridgeMaxImages)
	}
}

func TestReadBridgeMultipartImageEnforces50MiBBoundary(t *testing.T) {
	t.Run("exact-limit-accepted", func(t *testing.T) {
		header := psBridgeMultipartImageHeader(t, int64(client.MaxInputImageBytes))
		validated, err := readBridgeMultipartImage(header)
		if err != nil {
			t.Fatalf("exact 50 MiB image rejected: %v", err)
		}
		if len(validated.Bytes) != client.MaxInputImageBytes {
			t.Fatalf("validated image bytes = %d, want %d", len(validated.Bytes), client.MaxInputImageBytes)
		}
	})

	t.Run("one-byte-over-rejected", func(t *testing.T) {
		header := psBridgeMultipartImageHeader(t, int64(client.MaxInputImageBytes)+1)
		if _, err := readBridgeMultipartImage(header); err == nil || !strings.Contains(err.Error(), "50MB") {
			t.Fatalf("one-byte-over image error = %v", err)
		}
	})
}

func TestPSBridgeRejectsInvalidImageCapabilityEnums(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)
	_, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID: "invalid-capabilities", Name: "Invalid Capabilities", APIMode: "runninghub",
		BaseURL: "http://127.0.0.1:8117",
		ImageCapabilities: PSBridgeImageCapabilities{
			AspectPresets: []string{"1:1", "13:7"}, ResolutionPresets: []string{"2k"},
			SizeEncoding: "ratio-resolution",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported Photoshop aspect preset") {
		t.Fatalf("invalid capabilities error = %v", err)
	}
}

func TestPSBridgeSanitizesProviderSpecificImageCapabilities(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)
	_, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID: "invalid-apimart-ratio", Name: "Invalid APIMart Ratio", APIMode: "apimart",
		BaseURL: "https://example.test/v1", CredentialUser: "profile:invalid-apimart-ratio",
		ImageCapabilities: PSBridgeImageCapabilities{
			AspectPresets: []string{"1:1", "7:4"}, ResolutionPresets: []string{"2k"},
			SizeEncoding: "ratio-resolution",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "unavailable for apimart") {
		t.Fatalf("provider-specific aspect error = %v", err)
	}

	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID: "apimart-quality", Name: "APIMart Quality", APIMode: "apimart",
		BaseURL: "https://example.test/v1", CredentialUser: "profile:apimart-quality",
		ImageCapabilities: PSBridgeImageCapabilities{
			AspectPresets: []string{"1:1"}, ResolutionPresets: []string{"2k"},
			QualityControl: true, SizeEncoding: "ratio-resolution",
		},
	})
	if err != nil {
		t.Fatalf("sync APIMart capabilities: %v", err)
	}
	if status.Profile == nil || status.Profile.ImageCapabilities.QualityControl {
		t.Fatalf("APIMart quality capability was not sanitized: %+v", status.Profile)
	}
}

func TestPSBridgeStandardCanvasMatchesDesktopMatrix(t *testing.T) {
	cases := []struct {
		aspect     string
		resolution string
		want       psBridgeCanvasSize
	}{
		{aspect: "1:1", resolution: "2k", want: psBridgeCanvasSize{Width: 2048, Height: 2048}},
		{aspect: "7:4", resolution: "4k", want: psBridgeCanvasSize{Width: 3808, Height: 2176}},
		{aspect: "21:9", resolution: "4k", want: psBridgeCanvasSize{Width: 3840, Height: 1648}},
		{aspect: "9:21", resolution: "1k", want: psBridgeCanvasSize{Width: 656, Height: 1536}},
	}
	for _, entry := range cases {
		got, ok := psBridgeStandardCanvas(entry.aspect, entry.resolution)
		if !ok || got != entry.want {
			t.Fatalf("standard canvas %s/%s = %+v, %v; want %+v", entry.aspect, entry.resolution, got, ok, entry.want)
		}
	}
}

func TestPSBridgeOutputContractRejectsNonStandardCanvasAndNormalizesQuality(t *testing.T) {
	runningHub := PSBridgeProfilePublic{ImageCapabilities: defaultPSBridgeImageCapabilities("runninghub")}
	if _, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(url.Values{}), runningHub); err == nil || !strings.Contains(err.Error(), "必须同时提供") {
		t.Fatalf("missing output contract error = %v", err)
	}
	valid := url.Values{
		"size": {"1:1@1k"}, "aspect": {"1:1"}, "resolution": {"1k"},
		"canvasWidth": {"1024"}, "canvasHeight": {"1024"}, "quality": {"high"},
	}
	contract, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(valid), runningHub)
	if err != nil {
		t.Fatalf("valid ratio-resolution contract: %v", err)
	}
	if contract.Quality != "auto" {
		t.Fatalf("unsupported quality normalized to %q, want auto", contract.Quality)
	}

	invalidRatioCanvas := url.Values{
		"size": {"1:1@1k"}, "aspect": {"1:1"}, "resolution": {"1k"},
		"canvasWidth": {"3"}, "canvasHeight": {"2"}, "quality": {"medium"},
	}
	if _, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(invalidRatioCanvas), runningHub); err == nil || !strings.Contains(err.Error(), "标准画布") {
		t.Fatalf("non-standard ratio canvas error = %v", err)
	}

	responses := PSBridgeProfilePublic{ImageCapabilities: defaultPSBridgeImageCapabilities("responses")}
	invalidPixelCanvas := url.Values{
		"size": {"2000x2000"}, "aspect": {"1:1"}, "resolution": {"2k"},
		"canvasWidth": {"2000"}, "canvasHeight": {"2000"}, "quality": {"medium"},
	}
	if _, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(invalidPixelCanvas), responses); err == nil || !strings.Contains(err.Error(), "标准画布") {
		t.Fatalf("non-standard pixel canvas error = %v", err)
	}
}

func TestPSBridgeOutputContractRespectsQualityCapability(t *testing.T) {
	for _, apiMode := range []string{"responses", "images"} {
		for _, quality := range []string{"auto", "low", "medium", "high"} {
			t.Run(apiMode+"/"+quality, func(t *testing.T) {
				profile := PSBridgeProfilePublic{ImageCapabilities: defaultPSBridgeImageCapabilities(apiMode)}
				values := url.Values{
					"size": {"1024x1024"}, "aspect": {"1:1"}, "resolution": {"1k"},
					"canvasWidth": {"1024"}, "canvasHeight": {"1024"}, "quality": {quality},
				}
				contract, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(values), profile)
				if err != nil {
					t.Fatalf("parse %s quality %s: %v", apiMode, quality, err)
				}
				if contract.Quality != quality {
					t.Fatalf("%s quality = %q, want %q", apiMode, contract.Quality, quality)
				}
			})
		}
	}

	for _, apiMode := range []string{"apimart", "runninghub"} {
		t.Run(apiMode+"/high", func(t *testing.T) {
			profile := PSBridgeProfilePublic{ImageCapabilities: defaultPSBridgeImageCapabilities(apiMode)}
			values := url.Values{
				"size": {"1:1@1k"}, "aspect": {"1:1"}, "resolution": {"1k"},
				"canvasWidth": {"1024"}, "canvasHeight": {"1024"}, "quality": {"high"},
			}
			contract, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(values), profile)
			if err != nil {
				t.Fatalf("parse %s quality: %v", apiMode, err)
			}
			if contract.Quality != "auto" {
				t.Fatalf("%s quality = %q, want auto", apiMode, contract.Quality)
			}
		})
	}
}

func TestPSBridgeOutputContractEnforces100MPBoundary(t *testing.T) {
	profile := PSBridgeProfilePublic{ImageCapabilities: defaultPSBridgeImageCapabilities("runninghub")}
	exactLimit := url.Values{
		"size": {"1:1@4k"}, "aspect": {"1:1"}, "resolution": {"4k"},
		"canvasWidth": {"10000"}, "canvasHeight": {"10000"}, "quality": {"auto"},
	}
	if _, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(exactLimit), profile); err == nil || strings.Contains(err.Error(), "100MP") {
		t.Fatalf("exact 100MP canvas should pass the pixel ceiling and fail only the standard-canvas mapping: %v", err)
	}

	onePixelOver := url.Values{
		"size": {"1:1@4k"}, "aspect": {"1:1"}, "resolution": {"4k"},
		"canvasWidth": {"10001"}, "canvasHeight": {"10000"}, "quality": {"auto"},
	}
	if _, err := parsePSBridgeOutputContract(newPSBridgeOutputContractRequest(onePixelOver), profile); err == nil || !strings.Contains(err.Error(), "100MP") {
		t.Fatalf("one-pixel-over canvas error = %v", err)
	}
}

func TestPSBridgePreparedBaseContractValidatesCanvasAndDispatchesMarker(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		_, bridge, captured := newPSBridgeHandlerTest(t)
		syncPSBridgeRemoteProfile(t, bridge, "runninghub")
		base := psBridgePNG(t, 1024, 1024)
		mask := psBridgePNG(t, 1024, 1024)
		recorder := servePSBridgeRequest(bridge, newPSBridgeContractJobRequest(t, "prepared-base-valid", 1024, 1024, true, base, mask))
		if recorder.Code != http.StatusAccepted {
			t.Fatalf("prepared submission status = %d: %s", recorder.Code, recorder.Body.String())
		}
		dispatch, ok := captured.firstArg("ps-bridge:remote-job").(PSBridgeRemoteDispatch)
		if !ok || !dispatch.PreparedBase || dispatch.Quality != "auto" {
			t.Fatalf("prepared marker missing from dispatch: %+v", captured.firstArg("ps-bridge:remote-job"))
		}
	})

	t.Run("base-size-mismatch", func(t *testing.T) {
		_, bridge, captured := newPSBridgeHandlerTest(t)
		syncPSBridgeRemoteProfile(t, bridge, "runninghub")
		recorder := servePSBridgeRequest(bridge, newPSBridgeContractJobRequest(t, "prepared-base-mismatch", 1024, 1024, true, tinyPSBridgePNG(t), nil))
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "底图尺寸") {
			t.Fatalf("base mismatch status = %d: %s", recorder.Code, recorder.Body.String())
		}
		if captured.count("ps-bridge:remote-job") != 0 {
			t.Fatal("mismatched base must not dispatch")
		}
	})

	t.Run("mask-size-mismatch", func(t *testing.T) {
		_, bridge, captured := newPSBridgeHandlerTest(t)
		syncPSBridgeRemoteProfile(t, bridge, "runninghub")
		base := psBridgePNG(t, 1024, 1024)
		recorder := servePSBridgeRequest(bridge, newPSBridgeContractJobRequest(t, "prepared-mask-mismatch", 1024, 1024, true, base, psBridgePNG(t, 2, 2)))
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "蒙版尺寸") {
			t.Fatalf("mask mismatch status = %d: %s", recorder.Code, recorder.Body.String())
		}
		if captured.count("ps-bridge:remote-job") != 0 {
			t.Fatal("mismatched mask must not dispatch")
		}
	})

	t.Run("mask-must-be-png", func(t *testing.T) {
		_, bridge, captured := newPSBridgeHandlerTest(t)
		syncPSBridgeRemoteProfile(t, bridge, "runninghub")
		base := psBridgePNG(t, 1024, 1024)
		recorder := servePSBridgeRequest(bridge, newPSBridgeContractJobRequest(t, "prepared-mask-jpeg", 1024, 1024, true, base, psBridgeJPEG(t, 2, 2)))
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "蒙版必须是 PNG") {
			t.Fatalf("JPEG mask status = %d: %s", recorder.Code, recorder.Body.String())
		}
		if captured.count("ps-bridge:remote-job") != 0 {
			t.Fatal("non-PNG mask must not dispatch")
		}
	})
}

func TestPSBridgeSubmissionIsIdempotentAndSingleTask(t *testing.T) {
	_, bridge, captured := newPSBridgeHandlerTest(t)
	syncPSBridgeRemoteProfile(t, bridge, "runninghub")

	responses := make(chan *httptest.ResponseRecorder, 2)
	var wait sync.WaitGroup
	for index := 0; index < 2; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			responses <- servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "same-client-task", "generate", "1:1@1k", 0, 0))
		}()
	}
	wait.Wait()
	close(responses)
	var snapshots []PSBridgeJobSnapshot
	statuses := map[int]int{}
	for recorder := range responses {
		statuses[recorder.Code]++
		if recorder.Code != http.StatusAccepted && recorder.Code != http.StatusOK {
			t.Fatalf("idempotent submission status = %d: %s", recorder.Code, recorder.Body.String())
		}
		snapshots = append(snapshots, decodePSBridgeJob(t, recorder))
	}
	if statuses[http.StatusAccepted] != 1 || statuses[http.StatusOK] != 1 {
		t.Fatalf("idempotent statuses = %v, want one 202 and one 200", statuses)
	}
	if len(snapshots) != 2 || snapshots[0].JobID == "" || snapshots[0].JobID != snapshots[1].JobID {
		t.Fatalf("idempotent snapshots = %+v", snapshots)
	}
	if captured.count("ps-bridge:remote-job") != 1 {
		t.Fatalf("remote dispatch count = %d, want 1", captured.count("ps-bridge:remote-job"))
	}

	busy := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "different-client-task", "generate", "1:1@1k", 0, 0))
	if busy.Code != http.StatusConflict {
		t.Fatalf("second active task status = %d, want %d: %s", busy.Code, http.StatusConflict, busy.Body.String())
	}

	cancel := newAuthorizedPSBridgeRequest(http.MethodDelete, "/fhl-ps/v1/jobs/"+snapshots[0].JobID, nil)
	if recorder := servePSBridgeRequest(bridge, cancel); recorder.Code != http.StatusOK {
		t.Fatalf("cancel status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if captured.count("ps-bridge:remote-cancel") != 1 {
		t.Fatalf("remote cancel count = %d, want 1", captured.count("ps-bridge:remote-cancel"))
	}
}

func TestPSBridgeRemoteDispatchAndResultContainNoCredential(t *testing.T) {
	service, bridge, captured := newPSBridgeHandlerTest(t)
	service.outputDir = t.TempDir()
	syncPSBridgeRemoteProfile(t, bridge, "apimart")

	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "remote-result-task", "generate", "1:1@1k", 0, 0))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("remote submission status = %d: %s", recorder.Code, recorder.Body.String())
	}
	job := decodePSBridgeJob(t, recorder)
	dispatch, ok := captured.firstArg("ps-bridge:remote-job").(PSBridgeRemoteDispatch)
	if !ok {
		t.Fatalf("remote dispatch type = %T", captured.firstArg("ps-bridge:remote-job"))
	}
	encodedDispatch, err := json.Marshal(dispatch)
	if err != nil {
		t.Fatalf("marshal remote dispatch: %v", err)
	}
	if strings.Contains(string(encodedDispatch), "sk-ps-bridge-secret") || strings.Contains(string(encodedDispatch), "credential") {
		t.Fatalf("remote dispatch exposed credential material: %s", encodedDispatch)
	}

	imageBytes := tinyPSBridgePNG(t)
	if err := bridge.CompleteRemote(PSBridgeRemoteCompletion{
		JobID:         job.JobID,
		ImageB64:      base64.StdEncoding.EncodeToString(imageBytes),
		RevisedPrompt: "test result",
		SourceEvent:   "test.completed",
	}); err != nil {
		t.Fatalf("complete remote job: %v", err)
	}
	if captured.count("ps-bridge:history") != 1 {
		t.Fatalf("history event count = %d, want 1", captured.count("ps-bridge:history"))
	}

	imageRequest := newAuthorizedPSBridgeRequest(http.MethodGet, "/fhl-ps/v1/jobs/"+job.JobID+"/image", nil)
	imageResponse := servePSBridgeRequest(bridge, imageRequest)
	if imageResponse.Code != http.StatusOK {
		t.Fatalf("result image status = %d: %s", imageResponse.Code, imageResponse.Body.String())
	}
	if !bytes.Equal(imageResponse.Body.Bytes(), imageBytes) {
		t.Fatal("served result bytes differ from the saved image")
	}
}

func TestPSBridgeClearProfileCancelsTaskAndRotatesSession(t *testing.T) {
	_, bridge, captured := newPSBridgeHandlerTest(t)
	syncPSBridgeRemoteProfile(t, bridge, "runninghub")
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "clear-profile-task", "generate", "1:1@1k", 0, 0))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("submission status = %d: %s", recorder.Code, recorder.Body.String())
	}
	job := decodePSBridgeJob(t, recorder)

	bridge.ClearProfile()
	if captured.count("ps-bridge:remote-cancel") != 1 {
		t.Fatalf("remote cancel count = %d, want 1", captured.count("ps-bridge:remote-cancel"))
	}
	if snapshot := bridge.jobSnapshot(job.JobID); snapshot == nil || snapshot.State != "cancelled" {
		t.Fatalf("cleared job snapshot = %+v", snapshot)
	}

	oldSessionRequest := newAuthorizedPSBridgeRequest(http.MethodGet, "/fhl-ps/v1/profile", nil)
	if response := servePSBridgeRequest(bridge, oldSessionRequest); response.Code != http.StatusUnauthorized {
		t.Fatalf("old session status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	bridge.mu.Lock()
	newToken := bridge.sessionToken
	bridge.mu.Unlock()
	if newToken == "" || newToken == psBridgeTestToken {
		t.Fatal("clearing the profile did not rotate the session token")
	}
}
