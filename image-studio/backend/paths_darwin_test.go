//go:build darwin

package backend

import (
	"os"
	"path/filepath"
	"strings"
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

func TestPortableAndCustomMacOutputKeepAdjacentLogDir(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)
	portableRoot := portableOutputDir(packageRoot)
	if got, want := logSubdir(portableRoot), filepath.Join(portableRoot, "log"); got != want {
		t.Fatalf("portable logSubdir() = %q, want %q", got, want)
	}

	t.Setenv(publicRootEnvName, "")
	custom := filepath.Join(t.TempDir(), "custom")
	if got, want := logSubdir(custom), filepath.Join(custom, "log"); got != want {
		t.Fatalf("custom logSubdir() = %q, want %q", got, want)
	}
}

func TestDefaultMacLogDirIsAllowedForManagedReads(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	outputRoot, err := platformDefaultOutputDir()
	if err != nil {
		t.Fatal(err)
	}
	logDir := logSubdir(outputRoot)
	if err := os.MkdirAll(logDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(logDir, "managed.log")
	if err := os.WriteFile(logPath, []byte("log"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if _, err := NewService().ensureManagedReadablePath(logPath, managedRawLogFile); err != nil {
		t.Fatalf("default macOS log path should be managed: %v", err)
	}
}

func TestDefaultMacRuntimeLogUsesLibraryLogs(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	home := t.TempDir()
	t.Setenv("HOME", home)

	NewService().appendRuntimeLog("mac-runtime-log-sentinel")
	path := filepath.Join(home, "Library", "Logs", appDocumentDirName, "e2e-runtime.log")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "mac-runtime-log-sentinel") {
		t.Fatalf("runtime log missing sentinel: %s", raw)
	}
}

func TestDarwinVarAliasContainmentUsesResolvedAncestor(t *testing.T) {
	aliasRoot := t.TempDir()
	resolvedRoot, err := filepath.EvalSymlinks(aliasRoot)
	if err != nil {
		t.Fatal(err)
	}
	resolvedCandidate, err := resolvePathWithExistingAncestor(filepath.Join(aliasRoot, "missing", "preview.png"))
	if err != nil {
		t.Fatal(err)
	}
	if !isWithinRoot(resolvedCandidate, aliasRoot) {
		t.Fatalf("resolved candidate %q should remain within alias root %q (resolved %q)", resolvedCandidate, aliasRoot, resolvedRoot)
	}
}
