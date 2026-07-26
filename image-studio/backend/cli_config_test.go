package backend

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSyncCLIConfigPortablePreservesExistingKey(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	path := filepath.Join(root, "config", cliEnvFileName)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("IMAGE_STUDIO_API_KEY=existing-key\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := NewService().SyncCLIConfig(CLIConfigSyncInput{
		APIMode:            "images",
		BaseURL:            "https://www.fhl.mom\n",
		ImagesNewAPICompat: true,
		Size:               "9:16@2K",
		PartialImages:      9,
	})
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(result.Path) != filepath.Clean(path) || !result.APIKeyPresent {
		t.Fatalf("SyncCLIConfig() result = %#v, want portable path with key", result)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{
		"IMAGE_STUDIO_API_KEY=existing-key",
		"IMAGE_STUDIO_API_MODE=images",
		"IMAGE_STUDIO_IMAGES_NEWAPI_COMPAT=1",
		"IMAGE_STUDIO_SIZE=9:16@2k",
		"IMAGE_STUDIO_PARTIAL_IMAGES=3",
		"IMAGE_STUDIO_INPUT_DIR=" + filepath.Join(root, "input"),
		"IMAGE_STUDIO_OUTPUT_DIR=" + filepath.Join(root, "output"),
		"IMAGE_STUDIO_RAW_DIR=" + filepath.Join(root, "output", "log"),
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("CLI config missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "\n\nhttps://") {
		t.Fatalf("CLI config retained an injected newline:\n%s", text)
	}
}

func TestSyncCLIConfigSourceBuildFallbackUsesUserConfigDir(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	result, err := NewService().SyncCLIConfig(CLIConfigSyncInput{
		APIKey:        "source-build-key",
		APIMode:       "apimart",
		BaseURL:       "https://api.apib.ai",
		OutputFormat:  "webp",
		Quality:       "high",
		Size:          "1024x1024",
		PartialImages: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	configRoot, err := configDataRoot()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(configRoot, cliEnvFileName)
	if filepath.Clean(result.Path) != filepath.Clean(want) {
		t.Fatalf("SyncCLIConfig() path = %q, want %q on %s", result.Path, want, runtime.GOOS)
	}
	if _, err := os.Stat(want); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(want)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	outputRoot, err := defaultOutputDir()
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"IMAGE_STUDIO_INPUT_DIR=" + filepath.Join(outputRoot, "input"),
		"IMAGE_STUDIO_OUTPUT_DIR=" + filepath.Join(outputRoot, "cli"),
		"IMAGE_STUDIO_RAW_DIR=" + filepath.Join(logSubdir(outputRoot), "cli"),
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("CLI config missing %q:\n%s", expected, text)
		}
	}
}

func TestSyncCLIConfigRunningHubNeverPersistsAPIKey(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	result, err := NewService().SyncCLIConfig(CLIConfigSyncInput{
		APIKey:  "must-not-be-written",
		APIMode: "runninghub",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.APIKeyPresent {
		t.Fatal("RunningHub config reported an API key")
	}
	raw, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "must-not-be-written") {
		t.Fatal("RunningHub config persisted the supplied API key")
	}
}
