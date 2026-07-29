package backend

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"

	"github.com/gen2brain/avif"
	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	secureDirMode  = 0o700
	secureFileMode = 0o600

	appCompanyName     = "YuanHua"
	appProductName     = "FHL Studio"
	appConfigDirName   = "fhl-studio"
	appDocumentDirName = "FHL Studio"
	maxImagePixels     = 100_000_000
)

// imagesSubdir / logSubdir 把根目录拆为「生成的 PNG」和「原始响应/排错日志」两个子文件夹。
// 用户在 SettingsPanel 里可以「打开输出目录」=> 落到根,所以两类内容在同一个文件夹下并列。
func imagesSubdir(root string) string { return filepath.Join(root, "images") }
func logSubdir(root string) string    { return filepath.Join(root, "log") }

type validatedImageData struct {
	Bytes     []byte
	Config    image.Config
	Extension string
}

func validateImageBytes(data []byte) (validatedImageData, error) {
	if len(data) == 0 {
		return validatedImageData{}, fmt.Errorf("image data is empty")
	}
	if len(data) > client.MaxInputImageBytes {
		return validatedImageData{}, fmt.Errorf("图片超过 50MB,请换一张更小的图片")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	isAVIF := strings.EqualFold(format, "avif")
	if err != nil {
		if avifConfig, avifErr := avif.DecodeConfig(bytes.NewReader(data)); avifErr == nil {
			config = avifConfig
			format = "avif"
			err = nil
			isAVIF = true
		}
	}
	if err != nil {
		return validatedImageData{}, fmt.Errorf("图片格式无效或不受支持: %w", err)
	}
	extension := ""
	switch strings.ToLower(format) {
	case "png":
		extension = ".png"
	case "jpeg":
		extension = ".jpg"
	case "webp":
		extension = ".webp"
	case "avif":
		extension = ".avif"
	default:
		return validatedImageData{}, fmt.Errorf("不支持的图片格式:%s", format)
	}
	if config.Width <= 0 || config.Height <= 0 {
		return validatedImageData{}, fmt.Errorf("图片尺寸无效")
	}
	if config.Width > maxImagePixels/config.Height {
		return validatedImageData{}, fmt.Errorf("图片像素超过 100MP 上限: %dx%d", config.Width, config.Height)
	}
	if isAVIF {
		if _, err := avif.Decode(bytes.NewReader(data)); err != nil {
			return validatedImageData{}, fmt.Errorf("图片数据不完整或损坏: %w", err)
		}
	} else if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return validatedImageData{}, fmt.Errorf("图片数据不完整或损坏: %w", err)
	}
	return validatedImageData{Bytes: data, Config: config, Extension: extension}, nil
}

func decodeBase64Image(raw string) (validatedImageData, error) {
	clean := strings.TrimSpace(raw)
	if comma := strings.Index(clean, ","); comma >= 0 && strings.Contains(strings.ToLower(clean[:comma]), "base64") {
		clean = clean[comma+1:]
	}
	clean = strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "").Replace(clean)
	if base64.StdEncoding.DecodedLen(len(clean)) > client.MaxInputImageBytes {
		return validatedImageData{}, fmt.Errorf("图片超过 50MB,请换一张更小的图片")
	}
	data, err := base64.StdEncoding.DecodeString(clean)
	if err != nil {
		return validatedImageData{}, err
	}
	return validateImageBytes(data)
}

func readValidatedImageFile(path string) (validatedImageData, error) {
	info, err := os.Stat(path)
	if err != nil {
		return validatedImageData{}, err
	}
	if info.Size() > client.MaxInputImageBytes {
		return validatedImageData{}, fmt.Errorf("图片超过 50MB,请换一张更小的图片")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return validatedImageData{}, err
	}
	return validateImageBytes(data)
}

func forceImageExtension(path, extension string) string {
	base := filepath.Base(path)
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	if strings.TrimSpace(stem) == "" {
		stem = "image"
	}
	return filepath.Join(filepath.Dir(path), stem+extension)
}

func imageExtensionMatches(path, extension string) bool {
	actual := strings.ToLower(filepath.Ext(path))
	if extension == ".jpg" {
		return actual == ".jpg" || actual == ".jpeg"
	}
	return actual == extension
}

func writeImageBytes(data []byte, path string) (string, error) {
	if err := os.WriteFile(path, data, secureFileMode); err != nil {
		return "", err
	}
	abs, _ := filepath.Abs(path)
	return abs, nil
}

// writeBase64Image validates image bytes and forces the matching image
// extension before writing. It returns the actual absolute path.
func writeBase64Image(b64, path string) (string, error) {
	validated, err := decodeBase64Image(b64)
	if err != nil {
		return "", err
	}
	return writeImageBytes(validated.Bytes, forceImageExtension(path, validated.Extension))
}

// buildImageName composes the canonical filename for a generated image, e.g.
// `image-generate-cyberpunk-cat-20260518-210500.png`.
// outputFormat 来自 GenerateOptions.OutputFormat,空时回退到 client.OutputFormat。
// 扩展名走 client.FileExtForFormat 标准化(jpeg→jpg)。
func buildImageName(mode client.Mode, prompt, timestamp, outputFormat string) string {
	prefix := "generate"
	if mode == client.ModeEdit {
		prefix = "edit"
	}
	slug := client.Slugify(prompt, "image")
	ext := client.FileExtForFormat(outputFormat)
	return fmt.Sprintf("image-%s-%s-%s.%s", prefix, slug, timestamp, ext)
}
