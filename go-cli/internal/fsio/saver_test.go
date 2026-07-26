package fsio

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func TestBuildImageNamePreservesMillisecondTimestamp(t *testing.T) {
	name := BuildImageName(client.ModeGenerate, "color nails", "20260723-232959-495", "png")
	if !strings.HasPrefix(name, "20260723-232959-495-") {
		t.Fatalf("expected millisecond timestamp in %q", name)
	}
}

func TestSaveImageNeverOverwritesConcurrentName(t *testing.T) {
	dir := t.TempDir()
	requested := filepath.Join(dir, "same.png")
	firstData := []byte("first-image")
	secondData := []byte("second-image")

	firstPath, err := SaveImage(base64.StdEncoding.EncodeToString(firstData), requested)
	if err != nil {
		t.Fatal(err)
	}
	secondPath, err := SaveImage(base64.StdEncoding.EncodeToString(secondData), requested)
	if err != nil {
		t.Fatal(err)
	}
	if firstPath == secondPath {
		t.Fatalf("expected unique paths, got %q", firstPath)
	}
	firstSaved, err := os.ReadFile(firstPath)
	if err != nil {
		t.Fatal(err)
	}
	secondSaved, err := os.ReadFile(secondPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(firstSaved) != string(firstData) || string(secondSaved) != string(secondData) {
		t.Fatalf("saved data was overwritten: first=%q second=%q", firstSaved, secondSaved)
	}
}
