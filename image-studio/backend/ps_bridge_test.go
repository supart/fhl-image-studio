package backend

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
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
	t.Helper()
	canvas := image.NewNRGBA(image.Rect(0, 0, 3, 2))
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

func newPSBridgeJobRequest(t *testing.T, clientTaskID, mode string, baseCount, referenceCount int) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"clientTaskId": clientTaskID,
		"mode":         mode,
		"prompt":       "replace the selected area",
		"size":         "1024x1024",
		"quality":      "medium",
		"outputFormat": "png",
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write multipart field: %v", err)
		}
	}
	imageBytes := tinyPSBridgePNG(t)
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
	status, err := bridge.SyncProfile(PSBridgeProfileInput{
		ProfileID:      "ps-bridge-secret-profile",
		Name:           "Secret Profile",
		APIMode:        "images",
		BaseURL:        "https://private-upstream.example/v1",
		CredentialUser: credentialUser,
		ImageModelID:   "gpt-image-test",
		ProxyMode:      "custom",
		ProxyURL:       "http://private-proxy.example:8080",
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
	for _, forbidden := range []string{secret, credentialUser, "private-upstream.example", "private-proxy.example", "baseURL", "proxyURL"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public profile exposed %q in %s", forbidden, body)
		}
	}
	if !strings.Contains(body, "gpt-image-test") || !strings.Contains(body, `"supportsMask":true`) {
		t.Fatalf("public profile omitted required capabilities: %s", body)
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
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "missing-key-task", "generate", 0, 0))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing-key submission status = %d, want %d: %s", recorder.Code, http.StatusServiceUnavailable, recorder.Body.String())
	}
}

func TestPSBridgeEnforcesTenImageLimit(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)
	syncPSBridgeRemoteProfile(t, bridge, "runninghub")
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "too-many-images", "edit", 1, psBridgeMaxImages))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("image-limit status = %d, want %d: %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
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
			responses <- servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "same-client-task", "generate", 0, 0))
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

	busy := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "different-client-task", "generate", 0, 0))
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

	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "remote-result-task", "generate", 0, 0))
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
	recorder := servePSBridgeRequest(bridge, newPSBridgeJobRequest(t, "clear-profile-task", "generate", 0, 0))
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
