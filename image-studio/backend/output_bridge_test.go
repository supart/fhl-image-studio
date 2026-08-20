package backend

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveImagePathToOutputCopiesManagedImageIntoImages(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)

	sourcePath := filepath.Join(portableInputDir(packageRoot), "crop-source.png")
	writeImportSourceTestPNG(t, sourcePath)
	original, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}

	service := NewService()
	api := NewDesktopAPI(service)
	saved, err := api.SaveImagePathToOutput(sourcePath, "lens-result.jpg")
	if err != nil {
		t.Fatalf("SaveImagePathToOutput: %v", err)
	}
	outputRoot := portableOutputDir(packageRoot)
	imagesRoot := imagesSubdir(outputRoot)
	if !isWithinRoot(saved, imagesRoot) {
		t.Fatalf("saved path = %q, want within %q", saved, imagesRoot)
	}
	if filepath.Ext(saved) != ".png" {
		t.Fatalf("saved extension = %q, want source image extension .png", filepath.Ext(saved))
	}
	copyBytes, err := os.ReadFile(saved)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(copyBytes, original) {
		t.Fatal("output copy bytes differ from the managed source")
	}
	if _, err := service.ensureManagedReadablePath(saved, managedImageFile); err != nil {
		t.Fatalf("output copy should remain a managed image: %v", err)
	}

	second, err := api.SaveImagePathToOutput(sourcePath, "lens-result.jpg")
	if err != nil {
		t.Fatalf("second SaveImagePathToOutput: %v", err)
	}
	if second == saved {
		t.Fatal("duplicate output copy overwrote the first file")
	}
	if !strings.HasSuffix(second, "-2.png") {
		t.Fatalf("duplicate output path = %q, want -2 suffix", second)
	}
}

func TestSaveImagePathToOutputUsesCustomOutputRoot(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)
	sourcePath := filepath.Join(portableInputDir(packageRoot), "crop-source.png")
	writeImportSourceTestPNG(t, sourcePath)

	customRoot := filepath.Join(t.TempDir(), "chosen-output")
	service := NewService()
	if err := service.SetOutputDir(customRoot); err != nil {
		t.Fatalf("SetOutputDir: %v", err)
	}
	saved, err := NewDesktopAPI(service).SaveImagePathToOutput(sourcePath, "crop.png")
	if err != nil {
		t.Fatalf("SaveImagePathToOutput: %v", err)
	}
	if !isWithinRoot(saved, imagesSubdir(customRoot)) {
		t.Fatalf("saved path = %q, want within custom output images %q", saved, imagesSubdir(customRoot))
	}
	if isWithinRoot(saved, imagesSubdir(portableOutputDir(packageRoot))) {
		t.Fatalf("saved path unexpectedly used default output root: %q", saved)
	}
}

func TestSaveImagePathToOutputRejectsUnmanagedSource(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)

	externalPath := filepath.Join(t.TempDir(), "outside.png")
	writeImportSourceTestPNG(t, externalPath)
	service := NewService()
	_, err := NewDesktopAPI(service).SaveImagePathToOutput(externalPath, "outside.png")
	assertManagedPathRejected(t, err)
	outputRoot := portableOutputDir(packageRoot)
	if _, statErr := os.Stat(imagesSubdir(outputRoot)); !os.IsNotExist(statErr) {
		t.Fatalf("unmanaged source should not create output images directory: %v", statErr)
	}
}

func TestRemoveManagedImageCleansTransformAndRegisteredPreview(t *testing.T) {
	packageRoot := t.TempDir()
	t.Setenv(publicRootEnvName, packageRoot)
	sourcePath := filepath.Join(portableInputDir(packageRoot), "crop-source.png")
	writeImportSourceTestPNG(t, sourcePath)

	service := NewService()
	api := NewDesktopAPI(service)
	cropped, err := api.CropImage(sourcePath, 2, 3, 7, 5)
	if err != nil {
		t.Fatalf("CropImage: %v", err)
	}
	if cropped.Width != 7 || cropped.Height != 5 {
		t.Fatalf("crop dimensions = %dx%d, want 7x5", cropped.Width, cropped.Height)
	}
	ref, err := api.RegisterImportedImageAsset(cropped.Path)
	if err != nil {
		t.Fatalf("RegisterImportedImageAsset: %v", err)
	}
	if ref.PreviewURL == "" {
		t.Fatal("expected a registered preview")
	}
	previewPath := filepath.Join(filepath.Dir(cropped.Path), "previews", "")
	entries, err := os.ReadDir(previewPath)
	if err != nil {
		t.Fatalf("read preview directory: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected a generated preview file")
	}
	if err := api.RemoveManagedImage(cropped.Path); err != nil {
		t.Fatalf("RemoveManagedImage: %v", err)
	}
	if _, err := os.Stat(cropped.Path); !os.IsNotExist(err) {
		t.Fatalf("cropped file still exists: %v", err)
	}
	for _, entry := range entries {
		if _, err := os.Stat(filepath.Join(previewPath, entry.Name())); !os.IsNotExist(err) {
			t.Fatalf("preview file still exists: %s (%v)", entry.Name(), err)
		}
	}

	outputPath, err := api.SaveImagePathToOutput(sourcePath, "cleanup.png")
	if err != nil {
		t.Fatalf("SaveImagePathToOutput: %v", err)
	}
	if err := api.RemoveManagedImage(outputPath); err != nil {
		t.Fatalf("RemoveManagedImage output: %v", err)
	}
	if _, err := os.Stat(outputPath); !os.IsNotExist(err) {
		t.Fatalf("output file still exists: %v", err)
	}
}
