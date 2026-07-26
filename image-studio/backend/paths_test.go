package backend

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/gen2brain/avif"
)

func TestValidateImageBytesRejectsTruncatedImageBody(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.png")
	writeImportSourceTestPNG(t, path)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	truncated := data[:len(data)/2]
	if _, _, err := image.DecodeConfig(bytes.NewReader(truncated)); err != nil {
		t.Fatalf("test fixture must retain a readable header: %v", err)
	}
	if _, err := validateImageBytes(truncated); err == nil {
		t.Fatal("expected truncated image body to be rejected")
	}
}

func TestValidateImageBytesRejectsMoreThan100Megapixels(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	data := append([]byte(nil), source.Bytes()...)
	binary.BigEndian.PutUint32(data[16:20], 10_001)
	binary.BigEndian.PutUint32(data[20:24], 10_000)
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("oversized fixture header must remain valid: %v", err)
	}
	if config.Width != 10_001 || config.Height != 10_000 {
		t.Fatalf("fixture dimensions = %dx%d", config.Width, config.Height)
	}
	if _, err := validateImageBytes(data); err == nil {
		t.Fatal("expected image over 100MP to be rejected before full decode")
	}
}

func TestValidateImageBytesAcceptsAVIF(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2, 3))
	img.Set(0, 0, color.RGBA{R: 240, G: 80, B: 40, A: 255})
	var encoded bytes.Buffer
	if err := avif.Encode(&encoded, img, avif.Options{Quality: 80, Speed: 10}); err != nil {
		t.Fatal(err)
	}
	validated, err := validateImageBytes(encoded.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if validated.Extension != ".avif" {
		t.Fatalf("extension = %q, want .avif", validated.Extension)
	}
	if validated.Config.Width != 2 || validated.Config.Height != 3 {
		t.Fatalf("dimensions = %dx%d, want 2x3", validated.Config.Width, validated.Config.Height)
	}
}
