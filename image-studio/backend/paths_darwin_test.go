//go:build darwin

package backend

import (
	"path/filepath"
	"testing"
)

func TestDefaultMacLogDirUsesLibraryLogs(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	outputRoot, err := platformDefaultOutputDir()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "Library", "Logs", appDocumentDirName)
	if got := logSubdir(outputRoot); got != want {
		t.Fatalf("logSubdir() = %q, want %q", got, want)
	}
}

func TestCustomMacOutputKeepsAdjacentLogDir(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	custom := filepath.Join(t.TempDir(), "custom")
	want := filepath.Join(custom, "log")
	if got := logSubdir(custom); got != want {
		t.Fatalf("logSubdir() = %q, want %q", got, want)
	}
}
