package backend

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestComposePlanarImageKeepsPixelsOutsideCrop(t *testing.T) {
	output := image.NewRGBA(image.Rect(0, 0, 8, 6))
	for y := 0; y < 6; y++ {
		for x := 0; x < 8; x++ {
			output.SetRGBA(x, y, color.RGBA{R: 12, G: 34, B: 56, A: 255})
		}
	}
	edited := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			edited.SetRGBA(x, y, color.RGBA{R: 240, G: 80, B: 40, A: 255})
		}
	}
	composePlanarImage(output, edited, nil, PlanarPastebackOptions{
		CropX: 2, CropY: 1, CropWidth: 4, CropHeight: 4, Scale: 1, Brightness: 1, Contrast: 1,
	})
	if got := output.RGBAAt(0, 0); got != (color.RGBA{R: 12, G: 34, B: 56, A: 255}) {
		t.Fatalf("outside crop pixel changed: %+v", got)
	}
	if got := output.RGBAAt(3, 3); got.R < 200 || got.G < 60 || got.B < 20 {
		t.Fatalf("crop pixel was not composited: %+v", got)
	}
}

func TestComposePlanarImageHonorsPhysicalCropWhenEditedIsLarger(t *testing.T) {
	output := image.NewRGBA(image.Rect(0, 0, 10, 10))
	for y := 0; y < 10; y++ {
		for x := 0; x < 10; x++ {
			output.SetRGBA(x, y, color.RGBA{B: 255, A: 255})
		}
	}
	edited := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			edited.SetRGBA(x, y, color.RGBA{R: 255, A: 255})
		}
	}
	composePlanarImage(output, edited, nil, PlanarPastebackOptions{
		CropX: 3, CropY: 3, CropWidth: 2, CropHeight: 2, Scale: 1, Brightness: 1, Contrast: 1,
	})
	if got := output.RGBAAt(2, 2); got != (color.RGBA{B: 255, A: 255}) {
		t.Fatalf("pixel outside physical crop changed: %+v", got)
	}
	if got := output.RGBAAt(3, 3); got.R < 200 || got.B > 40 {
		t.Fatalf("edited image was not resampled to the crop bounds: %+v", got)
	}
}

func TestPlanarCompositeImageKeepsFullSourceDimensionsWithoutOutputBuffer(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			source.SetRGBA(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 90, A: 255})
		}
	}
	edited := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			edited.SetRGBA(x, y, color.RGBA{R: 240, G: 20, B: 10, A: 255})
		}
	}
	composite := newPlanarCompositeImage(source, edited, nil, PlanarPastebackOptions{
		CropX: 3, CropY: 2, CropWidth: 4, CropHeight: 4, Scale: 1, Brightness: 1, Contrast: 1,
	})
	if got := composite.Bounds(); got != image.Rect(0, 0, 12, 8) {
		t.Fatalf("composite bounds = %v, want 12x8", got)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, composite); err != nil {
		t.Fatalf("encode composite: %v", err)
	}
	decoded, err := png.Decode(bytes.NewReader(encoded.Bytes()))
	if err != nil {
		t.Fatalf("decode composite: %v", err)
	}
	if got := decoded.Bounds(); got != image.Rect(0, 0, 12, 8) {
		t.Fatalf("decoded bounds = %v, want 12x8", got)
	}
	if got := color.RGBAModel.Convert(decoded.At(0, 0)).(color.RGBA); got != source.RGBAAt(0, 0) {
		t.Fatalf("pixel outside crop changed: %+v", got)
	}
	if got := color.RGBAModel.Convert(decoded.At(4, 3)).(color.RGBA); got.R < 200 {
		t.Fatalf("crop pixel was not composited: %+v", got)
	}
}

func TestValidatePastebackConfigsRejectsLimitsBeforeDecode(t *testing.T) {
	options := PlanarPastebackOptions{CropX: 10, CropY: 20, CropWidth: 100, CropHeight: 100}
	if err := validatePastebackConfigs(image.Config{Width: 10_000, Height: 8_500}, image.Config{Width: 2048, Height: 2048}, options); err != nil {
		t.Fatalf("85MP source should pass the hard dimensions: %v", err)
	}
	if err := validatePastebackConfigs(image.Config{Width: 16_384, Height: 16_384}, image.Config{Width: 2048, Height: 2048}, options); err == nil {
		t.Fatal("source above 100MP should be rejected before decode")
	}
	if err := validatePastebackConfigs(image.Config{Width: 2000, Height: 2000}, image.Config{Width: 9000, Height: 8000}, options); err == nil {
		t.Fatal("edited image above 64MP should be rejected before decode")
	}
	if err := validatePastebackConfigs(image.Config{Width: 2000, Height: 2000}, image.Config{Width: 2048, Height: 2048}, PlanarPastebackOptions{CropX: 1950, CropY: 0, CropWidth: 100, CropHeight: 100}); err == nil {
		t.Fatal("crop outside source bounds should be rejected")
	}
}

func TestEstimatePastebackWorkingBytesLeavesHeadroomForHighResolutionCrop(t *testing.T) {
	estimated, ok := estimatePastebackWorkingBytes(
		image.Config{Width: 7876, Height: 10835},
		image.Config{Width: 2048, Height: 2048},
		image.Config{Width: 1024, Height: 1024},
	)
	if !ok || estimated >= maxPastebackWorkingBytes {
		t.Fatalf("85MP crop estimate = %d, ok=%v; want below %d", estimated, ok, maxPastebackWorkingBytes)
	}
	if _, ok := estimatePastebackWorkingBytes(image.Config{Width: int(^uint32(0)), Height: int(^uint32(0))}, image.Config{}, image.Config{}); ok {
		t.Fatal("overflowing dimensions should fail the estimate")
	}
}

func TestInspectPastebackMaskValidatesBeforeDecode(t *testing.T) {
	if data, cfg, err := inspectPastebackMask(""); err != nil || data != nil || cfg.Width != 0 {
		t.Fatalf("empty mask = data %v cfg %+v err %v", data, cfg, err)
	}
	if _, _, err := inspectPastebackMask("not-base64"); err == nil {
		t.Fatal("invalid mask should be rejected")
	}
}

func TestPasteLocalEditWritesFullSourceAndKeepsSourceFile(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	inputDir := portableInputDir(root)
	if err := os.MkdirAll(inputDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(inputDir, "source.png")
	editedPath := filepath.Join(inputDir, "edited.png")
	source := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			source.SetRGBA(x, y, color.RGBA{R: uint8(x * 7), G: uint8(y * 9), B: 120, A: 255})
		}
	}
	edited := image.NewRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			edited.SetRGBA(x, y, color.RGBA{R: 240, G: 30, B: 20, A: 255})
		}
	}
	writePNG := func(path string, img image.Image) {
		file, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(file, img); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	writePNG(sourcePath, source)
	writePNG(editedPath, edited)
	original, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}

	result, err := NewService().PasteLocalEdit(sourcePath, editedPath, PlanarPastebackOptions{
		CropX: 3, CropY: 2, CropWidth: 4, CropHeight: 2, Scale: 1, Brightness: 1, Contrast: 1,
		FeatherFraction: 0,
	})
	if err != nil {
		t.Fatalf("PasteLocalEdit: %v", err)
	}
	if result.Path == sourcePath {
		t.Fatal("pasteback must not overwrite the source")
	}
	outFile, err := os.Open(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	output, err := png.Decode(outFile)
	_ = outFile.Close()
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if output.Bounds() != image.Rect(0, 0, 12, 8) {
		t.Fatalf("output bounds = %v, want 12x8", output.Bounds())
	}
	if got := color.RGBAModel.Convert(output.At(0, 0)).(color.RGBA); got != source.RGBAAt(0, 0) {
		t.Fatalf("outside crop pixel changed: %+v", got)
	}
	if got := color.RGBAModel.Convert(output.At(4, 2)).(color.RGBA); got.R < 180 || got.G > 80 {
		t.Fatalf("crop pixel was not composited: %+v", got)
	}
	unchanged, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, unchanged) {
		t.Fatal("source file was modified")
	}
}
