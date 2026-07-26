package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClearLocalCredentialFilesRemovesOnlyKnownSecretFiles(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	cliPath := filepath.Join(root, "config", "cli.env.local")
	fhlPath := filepath.Join(root, "image-studio", "frontend", ".local", "fhl-api.local.json")
	ordinaryPath := filepath.Join(root, "config", "ordinary-setting.json")
	for _, path := range []string{cliPath, fhlPath, ordinaryPath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("test-only"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if err := NewService().ClearLocalCredentialFiles(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{cliPath, fhlPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("credential file still exists: %s", path)
		}
	}
	if _, err := os.Stat(ordinaryPath); err != nil {
		t.Fatalf("ordinary setting was removed: %v", err)
	}
}

func TestClearLocalCredentialFilesIsIdempotent(t *testing.T) {
	t.Setenv(publicRootEnvName, t.TempDir())
	service := NewService()
	if err := service.ClearLocalCredentialFiles(); err != nil {
		t.Fatal(err)
	}
	if err := service.ClearLocalCredentialFiles(); err != nil {
		t.Fatal(err)
	}
}

func TestClearLocalCredentialFilesRemovesSourceBuildFallbackCLIConfig(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	path, err := cliConfigFilePath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test-only"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := NewService().ClearLocalCredentialFiles(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("source-build CLI credential file still exists: %s", path)
	}
}
