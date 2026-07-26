package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureManagedReadablePath(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(publicRootEnvName, "")
	svc := NewService()
	root := t.TempDir()
	svc.addTrustedOutputRoot(root)
	importsRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}

	imagesDir := imagesSubdir(root)
	previewsDir := previewsSubdir(root)
	importPreviewsDir := previewsSubdir(importsRoot)
	logDir := logSubdir(root)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(previewsDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(importPreviewsDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(logDir, secureDirMode); err != nil {
		t.Fatal(err)
	}

	imagePath := filepath.Join(imagesDir, "a.png")
	if err := os.WriteFile(imagePath, []byte("png"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	previewPath := filepath.Join(previewsDir, "a.avif")
	if err := os.WriteFile(previewPath, []byte("avif"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	importPreviewPath := filepath.Join(importPreviewsDir, "import.avif")
	if err := os.WriteFile(importPreviewPath, []byte("avif"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(logDir, "a.txt")
	if err := os.WriteFile(logPath, []byte("log"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ensureManagedReadablePath(imagePath, managedImageFile); err != nil {
		t.Fatalf("expected managed image path to pass: %v", err)
	}
	if _, err := svc.ensureManagedReadablePath(previewPath, managedImageFile); err != nil {
		t.Fatalf("expected managed preview path to pass: %v", err)
	}
	if _, err := svc.ensureManagedReadablePath(importPreviewPath, managedImageFile); err != nil {
		t.Fatalf("expected managed import preview path to pass: %v", err)
	}
	if _, err := svc.ensureManagedReadablePath(logPath, managedRawLogFile); err != nil {
		t.Fatalf("expected managed log path to pass: %v", err)
	}
	if _, err := svc.ensureManagedReadablePath(outside, managedImageFile); err == nil {
		t.Fatalf("expected outside image path to be rejected")
	}
	if _, err := svc.ensureManagedReadablePath(outside, managedRawLogFile); err == nil {
		t.Fatalf("expected outside log path to be rejected")
	}
}

func TestEnsureManagedReadablePathAllowsPortablePackageImageDirs(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)

	svc := NewService()
	cases := map[string]string{
		"input":        portableInputDir(root),
		"output":       portableOutputDir(root),
		"intermediate": portableIntermediateDir(root),
	}

	for name, dir := range cases {
		if err := os.MkdirAll(dir, secureDirMode); err != nil {
			t.Fatal(err)
		}
		imagePath := filepath.Join(dir, name+".png")
		if err := os.WriteFile(imagePath, []byte("png"), secureFileMode); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ensureManagedReadablePath(imagePath, managedImageFile); err != nil {
			t.Fatalf("expected portable %s image path to pass: %v", name, err)
		}
	}
}

func TestManagedOpenAndWritePathsRejectOutsideRoots(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(publicRootEnvName, "")
	svc := NewService()
	root := t.TempDir()
	svc.addTrustedOutputRoot(root)

	imagesDir := imagesSubdir(root)
	logDir := logSubdir(root)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(logDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(imagesDir, "managed.png")
	logPath := filepath.Join(logDir, "managed.txt")
	if err := os.WriteFile(imagePath, []byte("png"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(logPath, []byte("log"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{imagePath, logPath} {
		if _, err := svc.ensureManagedOpenPath(path); err != nil {
			t.Fatalf("expected managed open path %s to pass: %v", path, err)
		}
	}
	if allowed, err := svc.ensureManagedWritableDirectory(root); err != nil || allowed == "" {
		t.Fatalf("expected trusted output root to be writable: %v", err)
	}

	outsideRoot := t.TempDir()
	outsideFile := filepath.Join(outsideRoot, "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ensureManagedOpenPath(outsideFile); err == nil {
		t.Fatal("expected unmanaged open path to be rejected")
	}
	if _, err := svc.ensureManagedWritableDirectory(outsideRoot); err == nil {
		t.Fatal("expected untrusted write directory to be rejected")
	}
}

func TestManagedWritableDirectoryRejectsSymlinkEscape(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("creating symlinks on Windows requires an optional privilege")
	}
	t.Setenv("HOME", t.TempDir())
	t.Setenv(publicRootEnvName, "")
	svc := NewService()
	root := t.TempDir()
	outside := t.TempDir()
	svc.addTrustedOutputRoot(root)
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ensureManagedWritableDirectory(link); err == nil {
		t.Fatal("expected writable symlink escape to be rejected")
	}
}

func TestResetOutputDirRevokesCurrentOutputRoot(t *testing.T) {
	t.Setenv(publicRootEnvName, "")
	svc := NewService()
	root := t.TempDir()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ensureManagedWritableDirectory(root); err != nil {
		t.Fatalf("current output root should be writable: %v", err)
	}
	if err := svc.SetOutputDir(""); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ensureManagedWritableDirectory(root); err == nil {
		t.Fatal("reset output root should no longer be writable")
	}
}
