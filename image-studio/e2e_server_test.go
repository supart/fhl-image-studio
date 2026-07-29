package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"image-studio/backend"
)

const e2eTestPort = 9230

func TestE2EBridgeIsExplicitAndExcludesSensitiveCapabilities(t *testing.T) {
	expected := []string{
		"GetAutomationStatus",
		"GetOutputDir",
		"RegisterImportedImageAsset",
		"RegisterMediaAsset",
	}
	if strings.Join(e2eBridgeMethods, ",") != strings.Join(expected, ",") {
		t.Fatalf("unexpected E2E capability list: %#v", e2eBridgeMethods)
	}
	for _, forbidden := range []string{
		"Generate",
		"Edit",
		"ProbeUpstream",
		"GetStoredAPIKey",
		"SetStoredAPIKey",
		"DeleteStoredAPIKey",
		"OpenExternalURL",
		"OpenFile",
		"ReadImageAsBase64",
		"ReadTextFile",
	} {
		if _, ok := e2eBridgeMethodSet[forbidden]; ok {
			t.Fatalf("sensitive method %s must not be exposed", forbidden)
		}
	}

	script := e2eBootstrapScript(backend.AutomationStatus{E2EOnly: true}, "test-session-token")
	for _, fragment := range []string{
		"window.runtime.EventsOnMultiple",
		"new EventSource",
		"X-Image-Studio-E2E-Token",
		"Object.defineProperty(window, \"localStorage\"",
		`dataset.e2eStorage = "memory"`,
		`localStorage.setItem("gptcodex.kernelRuntimeMode", "auto")`,
	} {
		if !strings.Contains(script, fragment) {
			t.Fatalf("E2E bootstrap script missing %q", fragment)
		}
	}
	for _, fragment := range []string{`"Generate"`, `"Edit"`, `"GetStoredAPIKey"`} {
		if strings.Contains(script, fragment) {
			t.Fatalf("E2E bootstrap script must not contain capability %s", fragment)
		}
	}
}

func TestInjectE2EBootstrapBeforeFrontendModule(t *testing.T) {
	input := []byte(`<!doctype html><html><head><script type="module" crossorigin src="/assets/index.js"></script></head><body></body></html>`)
	output := string(injectE2EBootstrap(input, backend.AutomationStatus{E2EOnly: true}, "test-session-token"))
	bootstrapIndex := strings.Index(output, "__IMAGE_STUDIO_E2E_BOOTSTRAP")
	moduleIndex := strings.Index(output, `type="module"`)
	if bootstrapIndex < 0 {
		t.Fatalf("expected injected E2E bootstrap script")
	}
	if moduleIndex < 0 {
		t.Fatalf("expected frontend module script to remain")
	}
	if bootstrapIndex > moduleIndex {
		t.Fatalf("E2E bootstrap must run before the frontend module; bootstrap=%d module=%d", bootstrapIndex, moduleIndex)
	}
}

func TestE2EHandlerRejectsUnauthorizedAndRemovedCapabilities(t *testing.T) {
	runtime, handler := newE2ETestHandler(t)

	badHost := httptest.NewRequest(http.MethodGet, "/", nil)
	badHost.Host = "attacker.example:9230"
	badHostRecorder := httptest.NewRecorder()
	handler.ServeHTTP(badHostRecorder, badHost)
	if badHostRecorder.Code != http.StatusMisdirectedRequest {
		t.Fatalf("bad Host status = %d, want %d", badHostRecorder.Code, http.StatusMisdirectedRequest)
	}

	missingToken := newE2ETestRequest(http.MethodPost, e2eServicePrefix+"GetAutomationStatus", []byte("[]"), runtime, false)
	missingTokenRecorder := httptest.NewRecorder()
	handler.ServeHTTP(missingTokenRecorder, missingToken)
	if missingTokenRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d, want %d", missingTokenRecorder.Code, http.StatusUnauthorized)
	}

	wrongOrigin := newE2ETestRequest(http.MethodPost, e2eServicePrefix+"GetAutomationStatus", []byte("[]"), runtime, true)
	wrongOrigin.Header.Set("Origin", "http://attacker.example:9230")
	wrongOriginRecorder := httptest.NewRecorder()
	handler.ServeHTTP(wrongOriginRecorder, wrongOrigin)
	if wrongOriginRecorder.Code != http.StatusForbidden {
		t.Fatalf("wrong Origin status = %d, want %d", wrongOriginRecorder.Code, http.StatusForbidden)
	}

	missingSSEToken := newE2ETestRequest(http.MethodGet, e2eEventsPath+"?eventName=result:job-1", nil, runtime, false)
	missingSSEToken.Header.Set("Origin", e2eTestOrigin())
	missingSSETokenRecorder := httptest.NewRecorder()
	handler.ServeHTTP(missingSSETokenRecorder, missingSSEToken)
	if missingSSETokenRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing SSE token status = %d, want %d", missingSSETokenRecorder.Code, http.StatusUnauthorized)
	}

	allowed := newE2ETestRequest(http.MethodPost, e2eServicePrefix+"GetAutomationStatus", []byte("[]"), runtime, true)
	allowedRecorder := httptest.NewRecorder()
	handler.ServeHTTP(allowedRecorder, allowed)
	if allowedRecorder.Code != http.StatusOK {
		t.Fatalf("allowed call status = %d: %s", allowedRecorder.Code, allowedRecorder.Body.String())
	}
	if strings.Contains(allowedRecorder.Body.String(), "executable") {
		t.Fatalf("sanitized automation status must not expose executable path: %s", allowedRecorder.Body.String())
	}

	forbidden := newE2ETestRequest(http.MethodPost, e2eServicePrefix+"Generate", []byte("[{}]"), runtime, true)
	forbiddenRecorder := httptest.NewRecorder()
	handler.ServeHTTP(forbiddenRecorder, forbidden)
	if forbiddenRecorder.Code != http.StatusNotFound {
		t.Fatalf("removed Generate status = %d, want %d", forbiddenRecorder.Code, http.StatusNotFound)
	}

	for _, path := range []string{
		e2eLocalConfigPrefix + "/fhl-api",
		"/__image-studio-fhl/v1/models",
		"/__image-studio-apimart/v1/balance",
		"/__image-studio-apimart-image/download",
	} {
		req := newE2ETestRequest(http.MethodGet, path, nil, runtime, false)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("disabled route %s status = %d, want %d", path, recorder.Code, http.StatusNotFound)
		}
		if recorder.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("disabled route %s unexpectedly enables CORS", path)
		}
	}
}

func TestE2EIndexUsesMemoryStorageAndBlocksExternalConnections(t *testing.T) {
	runtime, handler := newE2ETestHandler(t)
	req := newE2ETestRequest(http.MethodGet, "/", nil, runtime, false)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("index status = %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Header().Get("Content-Security-Policy"), "connect-src 'self'") {
		t.Fatalf("index CSP does not block external connections: %q", recorder.Header().Get("Content-Security-Policy"))
	}
	if recorder.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("E2E index unexpectedly enables CORS")
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "External network access is disabled in E2E mode") {
		t.Fatal("bootstrap does not reject external fetch requests")
	}
	for _, fragment := range []string{"test-session-token", "dataset.e2eStorage", "createMemoryStorage"} {
		if fragment == "test-session-token" {
			continue
		}
		if !strings.Contains(body, fragment) {
			t.Fatalf("E2E index missing %q", fragment)
		}
	}
	if !strings.Contains(body, runtime.token) {
		t.Fatalf("E2E index must inject the per-process session token")
	}
}

func TestE2EProjectFilesStayInsideCanonicalSandbox(t *testing.T) {
	runtime, handler := newE2ETestHandler(t)
	png := mustDecodeE2ETestBase64(t, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	saveBody, err := json.Marshal(e2eSaveImageRequest{
		Kind:          "input",
		ImageB64:      base64.StdEncoding.EncodeToString(png),
		SuggestedName: "fixture.png",
		MimeType:      "image/png",
		PreserveName:  true,
	})
	if err != nil {
		t.Fatal(err)
	}
	saveRequest := newE2ETestRequest(http.MethodPost, e2eProjectFilesPrefix+"/save-image", saveBody, runtime, true)
	saveRecorder := httptest.NewRecorder()
	handler.ServeHTTP(saveRecorder, saveRequest)
	if saveRecorder.Code != http.StatusOK {
		t.Fatalf("save image status = %d: %s", saveRecorder.Code, saveRecorder.Body.String())
	}
	var saved struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(saveRecorder.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if _, err := e2eAssertSandboxFile(runtime.root, saved.Path); err != nil {
		t.Fatalf("saved file is outside sandbox: %v", err)
	}

	readBody, _ := json.Marshal(map[string]string{"path": saved.Path})
	readRequest := newE2ETestRequest(http.MethodPost, e2eProjectFilesPrefix+"/read-image", readBody, runtime, true)
	readRecorder := httptest.NewRecorder()
	handler.ServeHTTP(readRecorder, readRequest)
	if readRecorder.Code != http.StatusOK || !strings.Contains(readRecorder.Body.String(), base64.StdEncoding.EncodeToString(png)) {
		t.Fatalf("read image failed: %d %s", readRecorder.Code, readRecorder.Body.String())
	}

	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	outsideBody, _ := json.Marshal(map[string]string{"path": outsidePath})
	outsideRequest := newE2ETestRequest(http.MethodPost, e2eProjectFilesPrefix+"/read-text", outsideBody, runtime, true)
	outsideRecorder := httptest.NewRecorder()
	handler.ServeHTTP(outsideRecorder, outsideRequest)
	if outsideRecorder.Code != http.StatusBadRequest {
		t.Fatalf("outside read status = %d, want %d", outsideRecorder.Code, http.StatusBadRequest)
	}

	link := filepath.Join(runtime.root, "input", "outside-link.txt")
	if err := os.Symlink(outsidePath, link); err != nil {
		t.Logf("symlink assertion skipped on this host: %v", err)
	} else if _, err := e2eAssertSandboxFile(runtime.root, link); err == nil {
		t.Fatalf("symlink escaping the sandbox was accepted")
	}
}

func TestE2EMediaRequiresTokenAndUsesSandboxOnly(t *testing.T) {
	runtime, handler := newE2ETestHandler(t)
	path := filepath.Join(runtime.root, "output", "result.png")
	if err := os.WriteFile(path, []byte("image-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal([]string{path})
	registerRequest := newE2ETestRequest(http.MethodPost, e2eServicePrefix+"RegisterImportedImageAsset", args, runtime, true)
	registerRecorder := httptest.NewRecorder()
	handler.ServeHTTP(registerRecorder, registerRequest)
	if registerRecorder.Code != http.StatusOK {
		t.Fatalf("register media status = %d: %s", registerRecorder.Code, registerRecorder.Body.String())
	}
	var response struct {
		Result backend.MediaAssetRef `json:"result"`
	}
	if err := json.Unmarshal(registerRecorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	mediaURL, err := url.Parse(response.Result.PreviewURL)
	if err != nil {
		t.Fatal(err)
	}

	withoutToken := newE2ETestRequest(http.MethodGet, mediaURL.Path, nil, runtime, false)
	withoutTokenRecorder := httptest.NewRecorder()
	handler.ServeHTTP(withoutTokenRecorder, withoutToken)
	if withoutTokenRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("media without token status = %d, want %d", withoutTokenRecorder.Code, http.StatusUnauthorized)
	}

	withToken := newE2ETestRequest(http.MethodGet, response.Result.PreviewURL, nil, runtime, false)
	withTokenRecorder := httptest.NewRecorder()
	handler.ServeHTTP(withTokenRecorder, withToken)
	if withTokenRecorder.Code != http.StatusOK || withTokenRecorder.Body.String() != "image-fixture" {
		t.Fatalf("sandbox media read failed: %d %q", withTokenRecorder.Code, withTokenRecorder.Body.String())
	}
}

func TestE2ERuntimeUsesUniqueSystemTempSandbox(t *testing.T) {
	first, err := newE2ERuntime(backend.AutomationStatus{E2EOnly: true, Port: e2eTestPort, Executable: `C:\\package\\FHL Studio.exe`})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := newE2ERuntime(backend.AutomationStatus{E2EOnly: true, Port: e2eTestPort})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if first.root == second.root || first.token == second.token {
		t.Fatalf("E2E runtimes must have unique roots and tokens")
	}
	tempRoot, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tempRoot, err = filepath.Abs(tempRoot)
	if err != nil {
		t.Fatal(err)
	}
	if rel, err := filepath.Rel(tempRoot, first.root); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		t.Fatalf("E2E root %q is not under system temp %q", first.root, tempRoot)
	}
	if first.status.Executable != "" {
		t.Fatalf("E2E status leaked executable path: %q", first.status.Executable)
	}
}

func newE2ETestHandler(t *testing.T) (*e2eRuntime, http.Handler) {
	t.Helper()
	runtime, err := newE2ERuntime(backend.AutomationStatus{
		E2EOnly: true,
		Port:    e2eTestPort,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(runtime.Close)
	assets := fstest.MapFS{
		"frontend/dist/index.html": &fstest.MapFile{
			Data: []byte(`<!doctype html><html><head><script type="module" src="/assets/index.js"></script></head><body></body></html>`),
			Mode: fs.FileMode(0o644),
		},
		"frontend/dist/assets/index.js": &fstest.MapFile{
			Data: []byte("export {};"),
			Mode: fs.FileMode(0o644),
		},
	}
	handler, err := newE2EHTTPHandler(assets, runtime)
	if err != nil {
		t.Fatal(err)
	}
	return runtime, handler
}

func newE2ETestRequest(method, target string, body []byte, runtime *e2eRuntime, authorized bool) *http.Request {
	request := httptest.NewRequest(method, target, bytes.NewReader(body))
	request.Host = "127.0.0.1:9230"
	if method != http.MethodGet && method != http.MethodHead {
		request.Header.Set("Origin", e2eTestOrigin())
	}
	if authorized {
		request.Header.Set(e2eTokenHeader, runtime.token)
	}
	return request
}

func e2eTestOrigin() string {
	return "http://127.0.0.1:9230"
}

func mustDecodeE2ETestBase64(t *testing.T, value string) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
