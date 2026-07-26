package backend

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

// ImportImageFromB64 persists a base64-encoded image (PNG/JPEG/WebP) into the
// imports directory and returns its absolute path. The legacy imageB64 field is
// intentionally left empty on Wails so imported files do not stay duplicated in
// frontend state.
//
// Used by:
//   - drag-and-drop / paste flows (App.tsx) — the file becomes a real edit source
//   - rotate / flip / crop derivatives (imageops.go) — they share the same destination
//
// suggestedName is sanitised; if empty, a timestamped name is generated.
func (s *Service) ImportImageFromB64(imageB64, suggestedName string) (ImportedImage, error) {
	if strings.TrimSpace(imageB64) == "" {
		return ImportedImage{}, errors.New("imageB64 is empty")
	}
	data, err := base64.StdEncoding.DecodeString(imageB64)
	if err != nil {
		return ImportedImage{}, fmt.Errorf("decode base64: %w", err)
	}
	return s.importImageBytes(data, suggestedName)
}

func (s *Service) ImportImagePath(path string) (ImportedImage, error) {
	imported, err := s.importImageFile(path)
	if err != nil {
		return ImportedImage{}, err
	}
	if preview, previewErr := s.registerImportedPreview(imported.Path); previewErr == nil {
		imported.ImageID = preview.ID
		imported.PreviewURL = preview.PreviewURL
		imported.PreviewWidth = preview.PreviewWidth
		imported.PreviewHeight = preview.PreviewHeight
	}
	return imported, nil
}

func (s *Service) importImageFile(path string) (ImportedImage, error) {
	if strings.TrimSpace(path) == "" {
		return ImportedImage{}, errors.New("path is empty")
	}
	info, err := os.Stat(path)
	if err != nil {
		return ImportedImage{}, err
	}
	if info.IsDir() {
		return ImportedImage{}, fmt.Errorf("path is a directory: %s", path)
	}
	if info.Size() > client.MaxInputImageBytes {
		return ImportedImage{}, fmt.Errorf("图片超过 50MB,请换一张更小的图片")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ImportedImage{}, err
	}
	return s.importImageBytes(data, filepath.Base(path))
}

func (s *Service) importImageBytes(data []byte, suggestedName string) (ImportedImage, error) {
	validated, err := validateImageBytes(data)
	if err != nil {
		return ImportedImage{}, err
	}

	dir, err := importsDir()
	if err != nil {
		return ImportedImage{}, err
	}
	if err := os.MkdirAll(dir, secureDirMode); err != nil {
		return ImportedImage{}, err
	}

	ext := validated.Extension
	name := time.Now().Format("20060102-150405") + "-" + sanitiseName(suggestedName) + ext
	full := filepath.Join(dir, name)
	if err := os.WriteFile(full, validated.Bytes, secureFileMode); err != nil {
		return ImportedImage{}, fmt.Errorf("write import file: %w", err)
	}
	return ImportedImage{Path: full, Width: validated.Config.Width, Height: validated.Config.Height}, nil
}

// sanitiseName produces a filename-safe stem from a user-supplied filename.
// Keeps ASCII alnum, dash, underscore, and CJK; collapses everything else to "-".
// Truncates by rune count (not byte count) so CJK isn't split mid-character.
func sanitiseName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "import"
	}
	if dot := strings.LastIndex(s, "."); dot > 0 {
		s = s[:dot] // drop extension; guessExt will pick a real one
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z'), (r >= 'A' && r <= 'Z'), (r >= '0' && r <= '9'), r == '-', r == '_':
			b.WriteRune(r)
		case r >= 0x4e00 && r <= 0x9fff: // CJK Unified Ideographs
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := b.String()
	if len(out) > 40 {
		runes := []rune(out)
		if len(runes) > 40 {
			out = string(runes[:40])
		}
	}
	if out == "" {
		return "import"
	}
	return strings.Trim(out, "-")
}
