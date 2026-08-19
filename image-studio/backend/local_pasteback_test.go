package backend

import (
	"image"
	"image/color"
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
