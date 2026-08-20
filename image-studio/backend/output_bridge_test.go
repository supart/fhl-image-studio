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
