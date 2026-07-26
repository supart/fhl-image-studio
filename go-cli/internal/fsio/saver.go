// Package fsio centralizes filesystem helpers used by the CLI and Wails app.
package fsio

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	privateDirMode  = 0o700
	privateFileMode = 0o600
)

var (
	invalidFileNameChars = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1F]+`)
	promptPunctuation    = regexp.MustCompile(`[，,。.!！?？；;：:'"“”‘’` + "`" + `~()\[\]{}]+`)
	promptSeparators     = regexp.MustCompile(`[\s._-]+`)
)

// EnsureDir creates dir (and parents) if it doesn't exist.
func EnsureDir(dir string) error {
	if dir == "" {
		return fmt.Errorf("output directory is empty")
	}
	return os.MkdirAll(dir, privateDirMode)
}

// SaveImage writes base64 PNG bytes to outputPath and returns the absolute path.
func SaveImage(imageB64, outputPath string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(imageB64)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}
	resolvedPath, file, err := createUniqueOutputFile(outputPath)
	if err != nil {
		return "", fmt.Errorf("create image: %w", err)
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		_ = os.Remove(resolvedPath)
		return "", fmt.Errorf("write image: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(resolvedPath)
		return "", fmt.Errorf("close image: %w", err)
	}
	abs, err := filepath.Abs(resolvedPath)
	if err != nil {
		return resolvedPath, nil //nolint:nilerr
	}
	return abs, nil
}

func createUniqueOutputFile(outputPath string) (string, *os.File, error) {
	ext := filepath.Ext(outputPath)
	stem := strings.TrimSuffix(outputPath, ext)
	for suffix := 0; ; suffix++ {
		candidate := outputPath
		if suffix > 0 {
			candidate = fmt.Sprintf("%s-%d%s", stem, suffix+1, ext)
		}
		file, err := os.OpenFile(candidate, os.O_WRONLY|os.O_CREATE|os.O_EXCL, privateFileMode)
		if err == nil {
			return candidate, file, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", nil, err
		}
	}
}

// DefaultOutputDir returns the default place to write images.
// CLI uses CWD/images; this is overridable by the caller.
func DefaultOutputDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "images"
	}
	return filepath.Join(cwd, "images")
}

// BuildImageName composes the final image filename matching the Python script.
// outputFormat 来自 Options.OutputFormat("png" / "jpeg" / "webp"),空时回退到
// client.OutputFormat 默认。文件扩展名走 client.FileExtForFormat 标准化(jpeg→jpg)。
func BuildImageName(mode client.Mode, prompt, timestamp, outputFormat string) string {
	_ = mode
	ext := client.FileExtForFormat(outputFormat)
	return fmt.Sprintf("%s-%s.%s", timestamp, promptSnippetForFileName(prompt), ext)
}

func promptSnippetForFileName(prompt string) string {
	clean := strings.TrimSpace(prompt)
	clean = invalidFileNameChars.ReplaceAllString(clean, "")
	clean = promptPunctuation.ReplaceAllString(clean, "")
	clean = promptSeparators.ReplaceAllString(clean, "-")
	clean = strings.Trim(clean, "-")
	if clean == "" {
		return "未命名"
	}
	runes := []rune(clean)
	if len(runes) > 10 {
		runes = runes[:10]
	}
	return string(runes)
}
