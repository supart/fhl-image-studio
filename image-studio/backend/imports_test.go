package backend

import (
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportImageFileCopiesExternalSourceIntoManagedImports(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)

	externalPath := filepath.Join(t.TempDir(), "reference.png")
	writeImportSourceTestPNG(t, externalPath)

	svc := NewService()
	if _, err := svc.ensureManagedReadablePath(externalPath, managedImageFile); err == nil {
		t.Fatal("expected original external source path to be rejected")
	}

	imported, err := svc.ImportImagePath(externalPath)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Path == "" || imported.Path == externalPath {
		t.Fatalf("imported path = %q, want managed copy different from source", imported.Path)
	}
	if imported.Width != 16 || imported.Height != 12 {
		t.Fatalf("imported dimensions = %dx%d, want 16x12", imported.Width, imported.Height)
	}

	importsRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	if !isWithinRoot(imported.Path, importsRoot) {
		t.Fatalf("imported path = %q, want within %q", imported.Path, importsRoot)
	}
	if _, err := svc.ensureManagedReadablePath(imported.Path, managedImageFile); err != nil {
		t.Fatalf("expected managed import copy to be readable: %v", err)
	}

	if imported.ImageID == "" || imported.PreviewURL == "" {
		t.Fatalf("expected imported path to register a preview asset, got %+v", imported)
	}
}

func TestListBatchInputImagesReturnsManagedCopiesForExternalDirectory(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)

	externalDir := t.TempDir()
	writeImportSourceTestPNG(t, filepath.Join(externalDir, "a.png"))
	writeImportSourceTestPNG(t, filepath.Join(externalDir, "b.png"))

	svc := NewService()
	result, err := svc.ListBatchInputImages(externalDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Images) != 2 {
		t.Fatalf("got %d images, want 2: %+v", len(result.Images), result.Images)
	}
	importsRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	if result.Directory != importsRoot {
		t.Fatalf("directory = %q, want managed imports root %q", result.Directory, importsRoot)
	}
	for _, item := range result.Images {
		if isWithinRoot(item.Path, externalDir) {
			t.Fatalf("batch item path = %q, want managed copy outside original %q", item.Path, externalDir)
		}
		if !isWithinRoot(item.Path, importsRoot) {
			t.Fatalf("batch item path = %q, want within imports root %q", item.Path, importsRoot)
		}
		if _, err := svc.ensureManagedReadablePath(item.Path, managedImageFile); err != nil {
			t.Fatalf("expected managed batch copy to be readable: %v", err)
		}
		if item.PreviewURL == "" || item.PreviewWidth == 0 || item.PreviewHeight == 0 {
			t.Fatalf("expected preview metadata for batch item, got %+v", item)
		}
		if item.Width != 16 || item.Height != 12 {
			t.Fatalf("batch image dimensions = %dx%d, want 16x12", item.Width, item.Height)
		}
	}
}

func TestListBatchInputImagesSkipsSymlinkEscapes(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)

	batchDir := t.TempDir()
	writeImportSourceTestPNG(t, filepath.Join(batchDir, "inside.png"))
	externalPath := filepath.Join(t.TempDir(), "outside.png")
	writeImportSourceTestPNG(t, externalPath)
	if err := os.Symlink(externalPath, filepath.Join(batchDir, "linked.png")); err != nil {
		t.Skipf("creating symlinks requires an optional privilege: %v", err)
	}

	result, err := NewService().ListBatchInputImages(batchDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Images) != 1 {
		t.Fatalf("got %d images, want only the in-root file: %+v", len(result.Images), result.Images)
	}
	if result.Images[0].Name != "inside.png" {
		t.Fatalf("imported image = %q, want inside.png", result.Images[0].Name)
	}
}

func TestDesktopAPIRejectsUnmanagedImagePathsAndDirectories(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)
	externalDir := t.TempDir()
	externalPath := filepath.Join(externalDir, "external.png")
	writeImportSourceTestPNG(t, externalPath)

	service := NewService()
	api := NewDesktopAPI(service)
	_, err := api.ImportImagePath(externalPath)
	assertManagedPathRejected(t, err)
	_, err = api.ListBatchInputImages(externalDir)
	assertManagedPathRejected(t, err)
	for _, opts := range []GenerateOptions{
		{ImagePaths: []string{externalPath}},
		{ImagePath: externalPath},
	} {
		_, err = api.Generate(opts)
		assertManagedPathRejected(t, err)
		_, err = api.Edit(opts)
		assertManagedPathRejected(t, err)
	}
	for _, opts := range []PromptOptimizeOptions{
		{ImagePaths: []string{externalPath}},
		{ImagePath: externalPath},
	} {
		_, err = api.OptimizePrompt(opts)
		assertManagedPathRejected(t, err)
	}
	for _, opts := range []PromptReverseOptions{
		{ImagePaths: []string{externalPath}},
		{ImagePath: externalPath},
	} {
		_, err = api.ReversePrompt(opts)
		assertManagedPathRejected(t, err)
	}

	imported, err := service.ImportImagePath(externalPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := api.ImportImagePath(imported.Path); err != nil {
		t.Fatalf("desktop API should accept a managed image path: %v", err)
	}
	if _, err := api.ListBatchInputImages(filepath.Dir(imported.Path)); err != nil {
		t.Fatalf("desktop API should accept a managed batch directory: %v", err)
	}
}

func TestImportImageFromB64RejectsNonImageBytes(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	service := NewService()
	encoded := base64.StdEncoding.EncodeToString([]byte("not an image"))
	if _, err := service.ImportImageFromB64(encoded, "secret.png"); err == nil {
		t.Fatal("expected non-image bytes to be rejected")
	}
	importsRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	entries, readErr := os.ReadDir(importsRoot)
	if readErr != nil && !os.IsNotExist(readErr) {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("invalid image left managed files behind: %v", entries)
	}
}

func TestManagedImageWritesValidateBytesAndForceImageExtensions(t *testing.T) {
	t.Setenv(publicRootEnvName, t.TempDir())
	service := NewService()
	targetDir := t.TempDir()
	service.addTrustedOutputRoot(targetDir)

	invalid := base64.StdEncoding.EncodeToString([]byte("echo unsafe"))
	if _, err := service.SaveImageToDir(invalid, targetDir, "payload.bat"); err == nil {
		t.Fatal("expected arbitrary base64 payload to be rejected")
	}
	if _, err := os.Stat(filepath.Join(targetDir, "payload.bat")); !os.IsNotExist(err) {
		t.Fatalf("unsafe payload was written: %v", err)
	}

	sourcePath := filepath.Join(t.TempDir(), "source.png")
	writeImportSourceTestPNG(t, sourcePath)
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	saved, err := service.SaveImageToDir(encoded, targetDir, "payload.bat")
	if err != nil {
		t.Fatal(err)
	}
	if strings.ToLower(filepath.Ext(saved)) != ".png" {
		t.Fatalf("saved extension = %q, want .png", filepath.Ext(saved))
	}
	if _, err := service.ensureManagedOpenPath(saved); err != nil {
		t.Fatalf("validated image should be safe to open: %v", err)
	}

	unsafeDir := imagesSubdir(targetDir)
	if err := os.MkdirAll(unsafeDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	unsafePath := filepath.Join(unsafeDir, "payload.bat")
	if err := os.WriteFile(unsafePath, []byte("echo unsafe"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ensureManagedOpenPath(unsafePath); err == nil {
		t.Fatal("managed OpenFile policy should reject executable extensions")
	}
	invalidImagePath := filepath.Join(unsafeDir, "not-image.png")
	if err := os.WriteFile(invalidImagePath, []byte("not an image"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadImageAsBase64(invalidImagePath); err == nil {
		t.Fatal("managed image reads should reject non-image bytes")
	}
}

func assertManagedPathRejected(t *testing.T, err error) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), "托管目录之外") {
		t.Fatalf("expected managed-path rejection, got %v", err)
	}
}

func writeImportSourceTestPNG(t *testing.T, path string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 12))
	for y := 0; y < 12; y++ {
		for x := 0; x < 16; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 8), G: uint8(y * 12), B: 180, A: 255})
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), secureDirMode); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, secureFileMode)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}
