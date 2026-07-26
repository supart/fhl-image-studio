//go:build windows

package backend

import (
	"path/filepath"
	"testing"
)

func TestAppendUniquePathDeduplicatesCaseInsensitiveWindowsPaths(t *testing.T) {
	root := filepath.Join("C:", "Users", "alice", "AppData", "Roaming")
	paths := []string{}
	paths = appendUniquePath(paths, filepath.Join(root, "image-studio.exe"))
	paths = appendUniquePath(paths, filepath.Join(root, "IMAGE-STUDIO.EXE"))
	paths = appendUniquePath(paths, filepath.Join(root, "old-custom-name.exe"))

	if len(paths) != 2 {
		t.Fatalf("paths = %#v, want two unique entries", paths)
	}
	if paths[1] != filepath.Join(root, "old-custom-name.exe") {
		t.Fatalf("historical exe path was not preserved: %#v", paths)
	}
}

func TestWindowsLegacyWebviewUserDataPathsSkipsPortableMode(t *testing.T) {
	portableRoot := t.TempDir()
	t.Setenv(publicRootEnvName, portableRoot)
	t.Setenv(windowsLegacyWebviewDirEnvName, filepath.Join(t.TempDir(), "legacy-webview"))

	paths, err := WindowsLegacyWebviewUserDataPaths()
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 0 {
		t.Fatalf("portable legacy WebView paths = %#v, want none", paths)
	}
}

func TestWindowsLegacyWebviewUserDataPathsHonorsOverrideOutsidePortableMode(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	legacy := filepath.Join(t.TempDir(), "legacy-webview")
	t.Setenv(windowsLegacyWebviewDirEnvName, legacy)

	paths, err := WindowsLegacyWebviewUserDataPaths()
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || filepath.Clean(paths[0]) != filepath.Clean(legacy) {
		t.Fatalf("legacy WebView paths = %#v, want %q", paths, legacy)
	}
}
