package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type forbiddenPSBridgeCLIKeyStore struct{}

func (forbiddenPSBridgeCLIKeyStore) Get(string) (string, error) {
	panic("CLI fallback must not read Credential Manager")
}

func (forbiddenPSBridgeCLIKeyStore) Set(string, string) error {
	panic("CLI fallback must not write Credential Manager")
}

func (forbiddenPSBridgeCLIKeyStore) Delete(string) error {
	panic("CLI fallback must not delete Credential Manager entries")
}

func enablePSBridgeCLITestRuntime(bridge *PSBridge, runner psBridgeCLIRunFunc) {
	bridge.mu.Lock()
	bridge.cliRuntime = &psBridgeCLIRuntime{
		NodePath:   filepath.Join("C:", "Program Files", "nodejs", "node.exe"),
		ScriptPath: filepath.Join("C:", "Codex", "fhl-image-gen", "generate.mjs"),
	}
	bridge.runCLI = runner
	bridge.mu.Unlock()
}

func newPSBridgeCLIJobRequest(t *testing.T, clientTaskID, mode, size string, baseCount, referenceCount int) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{
		"clientTaskId": clientTaskID,
		"mode":         mode,
		"prompt":       "replace the selected area",
		"size":         size,
		"aspect":       "1:1",
		"resolution":   "2k",
		"canvasWidth":  "2048",
		"canvasHeight": "2048",
		"preparedBase": "false",
		"quality":      "medium",
		"outputFormat": "png",
	} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	imageBytes := psBridgePNG(t, 2048, 2048)
	for _, group := range []struct {
		field string
		count int
	}{{"base", baseCount}, {"reference", referenceCount}} {
		for index := 0; index < group.count; index++ {
			part, err := writer.CreateFormFile(group.field, fmt.Sprintf("%s-%02d.png", group.field, index+1))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(imageBytes); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := newAuthorizedPSBridgeRequest(http.MethodPost, "/fhl-ps/v1/jobs", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func TestPSBridgeCLIFallbackPublishesSanitizedSyntheticProfile(t *testing.T) {
	service, bridge, _ := newPSBridgeHandlerTest(t)
	service.apiKeys = forbiddenPSBridgeCLIKeyStore{}
	enablePSBridgeCLITestRuntime(bridge, nil)

	status := bridge.Status()
	if !status.ProfileReady || status.Profile == nil {
		t.Fatalf("Status() = %+v, want ready CLI fallback", status)
	}
	profile := status.Profile
	if profile.ProfileID != psBridgeCLIProfileID || profile.Name != psBridgeCLIProfileName {
		t.Fatalf("synthetic profile identity = %+v", profile)
	}
	if profile.Provider != "fhl" || profile.APIMode != "images" || profile.ImageModelID != "gpt-image-2" {
		t.Fatalf("synthetic profile route = %+v", profile)
	}
	if profile.SupportsMask || profile.MaxImages != psBridgeMaxImages || !profile.Ready {
		t.Fatalf("synthetic profile capabilities = %+v", profile)
	}
	encoded, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"node.exe", "generate.mjs", "credential", "baseURL", "apiKey"} {
		if strings.Contains(strings.ToLower(string(encoded)), strings.ToLower(forbidden)) {
			t.Fatalf("public profile leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestPSBridgeReadyImageProfileTakesPriorityOverCLIFallback(t *testing.T) {
	_, bridge, _ := newPSBridgeHandlerTest(t)
	enablePSBridgeCLITestRuntime(bridge, nil)
	syncPSBridgeRemoteProfile(t, bridge, "images")

	status := bridge.Status()
	if !status.ProfileReady || status.Profile == nil {
		t.Fatalf("Status() = %+v", status)
	}
	if status.Profile.ProfileID != "ps-bridge-test" || status.Profile.Name != "PS Bridge Test" {
		t.Fatalf("ready desktop profile did not win: %+v", status.Profile)
	}
	if !status.Profile.SupportsMask {
		t.Fatalf("desktop Images profile capabilities were replaced: %+v", status.Profile)
	}
}

func TestPSBridgeCLIFallbackReplacesUnreadyImageProfileAndKeepsPromptStatus(t *testing.T) {
	service, bridge, _ := newPSBridgeHandlerTest(t)
	service.apiKeys = forbiddenPSBridgeCLIKeyStore{}
	enablePSBridgeCLITestRuntime(bridge, nil)
	bridge.mu.Lock()
	bridge.profile = &PSBridgeProfileInput{
		ProfileID: "unready-private", Name: "Unready Private", APIMode: "images",
		BaseURL: "https://private.invalid/v1", CredentialUser: "profile:private",
	}
	bridge.profileView = &PSBridgeProfilePublic{
		ProfileID: "unready-private", Name: "Unready Private", APIMode: "images",
		Ready: false, PromptOptimizationReady: true, PromptProviderLabel: "FHL Text",
	}
	bridge.mu.Unlock()

	status := bridge.Status()
	if !status.ProfileReady || status.Profile == nil || status.Profile.ProfileID != psBridgeCLIProfileID {
		t.Fatalf("unready image profile did not select CLI fallback: %+v", status)
	}
	if !status.Profile.PromptOptimizationReady || status.Profile.PromptProviderLabel != "FHL Text" {
		t.Fatalf("prompt status was not preserved: %+v", status.Profile)
	}
	encoded, err := json.Marshal(status.Profile)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private.invalid", "profile:private", "unready-private"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("synthetic profile leaked private value %q: %s", private, encoded)
		}
	}
}

func TestBuildPSBridgeCLIArgsKeepsPromptAtomicAndReferencesOrdered(t *testing.T) {
	runtime := psBridgeCLIRuntime{NodePath: `C:\node.exe`, ScriptPath: `C:\plugin\generate.mjs`}
	prompt := `portrait & whoami | echo $HOME; $(Get-ChildItem) "quoted"`
	images := []string{`C:\input\base one.png`, `C:\input\ref&two.png`, `C:\input\ref three.png`}
	request := psBridgeCLIRequest{
		Mode: "edit", Prompt: prompt, Size: "2048x2048", OutputFormat: "png",
		ImagePaths: images, TempDir: t.TempDir(),
	}
	args, err := buildPSBridgeCLIArgs(runtime, request)
	if err != nil {
		t.Fatal(err)
	}
	promptIndex := -1
	var actualImages []string
	for index, arg := range args {
		if arg == "--prompt" {
			promptIndex = index
		}
		if arg == "--image" && index+1 < len(args) {
			actualImages = append(actualImages, args[index+1])
		}
	}
	if promptIndex < 0 || promptIndex+1 >= len(args) || args[promptIndex+1] != prompt {
		t.Fatalf("prompt was not preserved as one argv entry: %#v", args)
	}
	if fmt.Sprint(actualImages) != fmt.Sprint(images) {
		t.Fatalf("image order = %#v, want %#v", actualImages, images)
	}
	joined := strings.Join(args, "\x00")
	for _, forbidden := range []string{"--api-key", "Authorization", "--batch-edit", "-Command", "cmd.exe"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("unsafe or semantic-changing argument %q in %#v", forbidden, args)
		}
	}
}

func TestPSBridgeCLIFallbackCompletesSingleImageAndCleansInputs(t *testing.T) {
	service, bridge, captured := newPSBridgeHandlerTest(t)
	service.apiKeys = forbiddenPSBridgeCLIKeyStore{}
	service.outputDir = t.TempDir()
	service.SetAutomationStatus(AutomationStatus{E2EOnly: true})
	service.Startup(context.Background())
	t.Cleanup(func() { service.Shutdown(context.Background()) })
	imageBytes := tinyPSBridgePNG(t)
	var mu sync.Mutex
	tempDir := ""
	runner := func(_ context.Context, _ psBridgeCLIRuntime, request psBridgeCLIRequest) (string, error) {
		mu.Lock()
		tempDir = request.TempDir
		mu.Unlock()
		path := filepath.Join(request.TempDir, "cli-output", "result.png")
		if err := os.MkdirAll(filepath.Dir(path), secureDirMode); err != nil {
			return "", err
		}
		if err := os.WriteFile(path, imageBytes, secureFileMode); err != nil {
			return "", err
		}
		return path, nil
	}
	enablePSBridgeCLITestRuntime(bridge, runner)

	recorder := servePSBridgeRequest(bridge, newPSBridgeCLIJobRequest(t, "cli-success", "generate", "2048x2048", 0, 0))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("submit status = %d: %s", recorder.Code, recorder.Body.String())
	}
	started := decodePSBridgeJob(t, recorder)
	waitFor(t, func() bool {
		snapshot := bridge.jobSnapshot(started.JobID)
		return snapshot != nil && terminalPSBridgeState(snapshot.State)
	}, "CLI fallback did not settle")
	snapshot := bridge.jobSnapshot(started.JobID)
	if snapshot == nil || snapshot.State != "succeeded" || snapshot.ResultURL == "" {
		t.Fatalf("CLI job = %+v", snapshot)
	}
	bridge.mu.Lock()
	savedPath := bridge.jobs[started.JobID].Result.SavedPath
	bridge.mu.Unlock()
	if info, err := os.Stat(savedPath); err != nil || info.IsDir() {
		t.Fatalf("saved result %q is unavailable: %v", savedPath, err)
	}
	mu.Lock()
	capturedTempDir := tempDir
	mu.Unlock()
	if capturedTempDir == "" {
		t.Fatal("runner did not receive the Bridge temp directory")
	}
	waitFor(t, func() bool {
		_, err := os.Stat(capturedTempDir)
		return errors.Is(err, os.ErrNotExist)
	}, "successful CLI fallback did not clean its temp directory")
	if _, err := os.Stat(capturedTempDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary input directory still exists: %q err=%v", capturedTempDir, err)
	}
	if captured.count("ps-bridge:history") != 1 {
		t.Fatalf("history event count = %d, want 1", captured.count("ps-bridge:history"))
	}
}

func TestPSBridgeCLIFallbackFailureIsGenericAndCleansInputs(t *testing.T) {
	service, bridge, captured := newPSBridgeHandlerTest(t)
	service.apiKeys = forbiddenPSBridgeCLIKeyStore{}
	service.SetAutomationStatus(AutomationStatus{E2EOnly: true})
	service.Startup(context.Background())
	t.Cleanup(func() { service.Shutdown(context.Background()) })
	var mu sync.Mutex
	tempDir := ""
	runner := func(_ context.Context, _ psBridgeCLIRuntime, request psBridgeCLIRequest) (string, error) {
		mu.Lock()
		tempDir = request.TempDir
		mu.Unlock()
		return "", errors.New("child stderr included secret-token and full prompt")
	}
	enablePSBridgeCLITestRuntime(bridge, runner)

	recorder := servePSBridgeRequest(bridge, newPSBridgeCLIJobRequest(t, "cli-failure", "edit", "2048x2048", 1, 2))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("submit status = %d: %s", recorder.Code, recorder.Body.String())
	}
	started := decodePSBridgeJob(t, recorder)
	waitFor(t, func() bool {
		snapshot := bridge.jobSnapshot(started.JobID)
		return snapshot != nil && terminalPSBridgeState(snapshot.State)
	}, "failed CLI fallback did not settle")
	snapshot := bridge.jobSnapshot(started.JobID)
	if snapshot == nil || snapshot.State != "failed" || snapshot.Error != psBridgeCLIFailureMessage {
		t.Fatalf("failed CLI job = %+v", snapshot)
	}
	if strings.Contains(snapshot.Error, "secret-token") || strings.Contains(snapshot.Error, "full prompt") {
		t.Fatalf("child error leaked through job snapshot: %q", snapshot.Error)
	}
	mu.Lock()
	capturedTempDir := tempDir
	mu.Unlock()
	if capturedTempDir == "" {
		t.Fatal("runner did not receive the Bridge temp directory")
	}
	waitFor(t, func() bool {
		_, err := os.Stat(capturedTempDir)
		return errors.Is(err, os.ErrNotExist)
	}, "failed CLI fallback did not clean its temp directory")
	if _, err := os.Stat(capturedTempDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed job temp directory still exists: %q err=%v", capturedTempDir, err)
	}
	if captured.count("ps-bridge:history") != 0 {
		t.Fatalf("failed fallback emitted history")
	}
}
