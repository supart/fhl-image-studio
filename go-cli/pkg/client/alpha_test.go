package client

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func encodePNGBase64(t *testing.T, img image.Image) string {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestValidateTransparentPNGBase64(t *testing.T) {
	t.Run("accepts native transparency with a visible subject", func(t *testing.T) {
		img := image.NewNRGBA(image.Rect(0, 0, 2, 1))
		img.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
		img.SetNRGBA(1, 0, color.NRGBA{A: 0})
		status, err := ValidateTransparentPNGBase64(encodePNGBase64(t, img))
		if err != nil || status != AlphaStatusNative {
			t.Fatalf("status=%q err=%v, want native", status, err)
		}
	})

	t.Run("rejects an opaque PNG", func(t *testing.T) {
		img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
		img.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
		status, err := ValidateTransparentPNGBase64(encodePNGBase64(t, img))
		if err == nil || status != AlphaStatusInvalid {
			t.Fatalf("status=%q err=%v, want invalid", status, err)
		}
	})

	t.Run("rejects a fully transparent PNG", func(t *testing.T) {
		img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
		status, err := ValidateTransparentPNGBase64(encodePNGBase64(t, img))
		if err == nil || status != AlphaStatusInvalid {
			t.Fatalf("status=%q err=%v, want invalid", status, err)
		}
	})

	t.Run("rejects non PNG and invalid base64", func(t *testing.T) {
		for _, encoded := range []string{
			base64.StdEncoding.EncodeToString([]byte("not-png")),
			"%%%",
		} {
			status, err := ValidateTransparentPNGBase64(encoded)
			if err == nil || status != AlphaStatusInvalid {
				t.Fatalf("status=%q err=%v, want invalid", status, err)
			}
		}
	})
}
