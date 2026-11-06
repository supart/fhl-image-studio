package client

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
)

type AlphaStatus string

const (
	AlphaStatusNative  AlphaStatus = "native"
	AlphaStatusNone    AlphaStatus = "none"
	AlphaStatusInvalid AlphaStatus = "invalid"
)

var pngSignature = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}

// ValidateTransparentPNGBase64 verifies actual pixel transparency. A PNG
// extension, HTTP success, or a checkerboard pattern is not sufficient.
func ValidateTransparentPNGBase64(encoded string) (AlphaStatus, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return AlphaStatusInvalid, fmt.Errorf("decode transparent PNG: %w", err)
	}
	if len(raw) < len(pngSignature) || !bytes.Equal(raw[:len(pngSignature)], pngSignature) {
		return AlphaStatusInvalid, errors.New("transparent result is not a PNG")
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return AlphaStatusInvalid, fmt.Errorf("decode transparent PNG pixels: %w", err)
	}
	bounds := img.Bounds()
	hasTransparent := false
	hasVisible := false
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := img.At(x, y).RGBA()
			if alpha < 0xffff {
				hasTransparent = true
			}
			if alpha > 0 {
				hasVisible = true
			}
			if hasTransparent && hasVisible {
				return AlphaStatusNative, nil
			}
		}
	}
	if !hasVisible {
		return AlphaStatusInvalid, errors.New("transparent PNG contains no visible subject pixels")
	}
	return AlphaStatusInvalid, errors.New("PNG contains no transparent pixels")
}
