package backend

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const cliEnvFileName = "cli.env.local"

var (
	cliPixelSizePattern = regexp.MustCompile(`^\d{2,5}x\d{2,5}$`)
	cliRatioSizePattern = regexp.MustCompile(`^\d+:\d+(?:@(1k|2k|4k))?$`)
)

type CLIConfigSyncInput struct {
	APIKey             string `json:"apiKey"`
	ClearAPIKey        bool   `json:"clearAPIKey"`
	BaseURL            string `json:"baseURL"`
	APIMode            string `json:"apiMode"`
	RequestPolicy      string `json:"requestPolicy"`
	ImagesNewAPICompat bool   `json:"imagesNewAPICompat"`
	TextModelID        string `json:"textModelID"`
	ImageModelID       string `json:"imageModelID"`
	OutputFormat       string `json:"outputFormat"`
	Quality            string `json:"quality"`
	Size               string `json:"size"`
	PartialImages      int    `json:"partialImages"`
}

type CLIConfigSyncResult struct {
	Path          string `json:"path"`
	APIKeyPresent bool   `json:"apiKeyPresent"`
}

type cliDataDirectories struct {
	Input  string
	Output string
	Raw    string
}

func cliConfigFilePath() (string, error) {
	if root, ok := portablePackageRoot(); ok {
		return filepath.Join(root, "config", cliEnvFileName), nil
	}
	root, err := configDataRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, cliEnvFileName), nil
}

func defaultCLIDataDirectories() (cliDataDirectories, error) {
	if root, ok := portablePackageRoot(); ok {
		return cliDataDirectories{
			Input:  portableInputDir(root),
			Output: portableOutputDir(root),
			Raw:    filepath.Join(portableOutputDir(root), "log"),
		}, nil
	}
	outputRoot, err := defaultOutputDir()
	if err != nil {
		return cliDataDirectories{}, err
	}
	return cliDataDirectories{
		Input:  filepath.Join(outputRoot, "input"),
		Output: filepath.Join(outputRoot, "cli"),
		Raw:    filepath.Join(logSubdir(outputRoot), "cli"),
	}, nil
}

func (s *Service) SyncCLIConfig(input CLIConfigSyncInput) (CLIConfigSyncResult, error) {
	path, err := cliConfigFilePath()
	if err != nil {
		return CLIConfigSyncResult{}, err
	}
	previous, err := readCLIEnvFile(path)
	if err != nil {
		return CLIConfigSyncResult{}, err
	}
	directories, err := defaultCLIDataDirectories()
	if err != nil {
		return CLIConfigSyncResult{}, err
	}

	apiMode := cliChoice(input.APIMode, []string{"responses", "images", "apimart", "runninghub"}, "images")
	apiKey := ""
	if apiMode != "runninghub" && !input.ClearAPIKey {
		apiKey = cleanCLIEnvValue(input.APIKey, "")
		if apiKey == "" {
			apiKey = previous["IMAGE_STUDIO_API_KEY"]
		}
	}
	baseURLDefault := "https://www.fhl.mom"
	if apiMode == "runninghub" {
		baseURLDefault = "http://127.0.0.1:8117"
	}
	partialImages := input.PartialImages
	if partialImages < 0 {
		partialImages = 0
	}
	if partialImages > 3 {
		partialImages = 3
	}

	rendered := renderCLIEnv(CLIConfigSyncInput{
		APIKey:             apiKey,
		BaseURL:            cleanCLIEnvValue(input.BaseURL, baseURLDefault),
		APIMode:            apiMode,
		RequestPolicy:      cliChoice(input.RequestPolicy, []string{"openai", "compat"}, "openai"),
		ImagesNewAPICompat: apiMode == "images" && input.ImagesNewAPICompat,
		TextModelID:        cleanCLIEnvValue(input.TextModelID, "gpt-5.5"),
		ImageModelID:       cleanCLIEnvValue(input.ImageModelID, "gpt-image-2"),
		OutputFormat:       cliChoice(input.OutputFormat, []string{"png", "jpeg", "webp"}, "png"),
		Quality:            cliChoice(input.Quality, []string{"auto", "high", "medium", "low"}, "medium"),
		Size:               cleanCLIImageSize(input.Size, "1024x1024"),
		PartialImages:      partialImages,
	}, directories)
	if err := os.MkdirAll(filepath.Dir(path), secureDirMode); err != nil {
		return CLIConfigSyncResult{}, err
	}
	if err := os.Chmod(filepath.Dir(path), secureDirMode); err != nil {
		return CLIConfigSyncResult{}, err
	}
	for _, directory := range []string{directories.Input, directories.Output, directories.Raw} {
		if err := os.MkdirAll(directory, secureDirMode); err != nil {
			return CLIConfigSyncResult{}, err
		}
	}
	if err := os.WriteFile(path, []byte(rendered), secureFileMode); err != nil {
		return CLIConfigSyncResult{}, err
	}
	if err := os.Chmod(path, secureFileMode); err != nil {
		return CLIConfigSyncResult{}, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	return CLIConfigSyncResult{Path: abs, APIKeyPresent: apiKey != ""}, nil
}

func readCLIEnvFile(path string) (map[string]string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, value, ok := strings.Cut(trimmed, "=")
		if !ok || strings.TrimSpace(key) == "" {
			continue
		}
		out[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return out, nil
}

func cleanCLIEnvValue(value, fallback string) string {
	clean := strings.TrimSpace(strings.NewReplacer("\r", "", "\n", "", "\x00", "").Replace(value))
	if clean == "" {
		return fallback
	}
	return clean
}

func cliChoice(value string, allowed []string, fallback string) string {
	clean := strings.ToLower(strings.TrimSpace(value))
	for _, candidate := range allowed {
		if clean == candidate {
			return clean
		}
	}
	return fallback
}

func cleanCLIImageSize(value, fallback string) string {
	clean := strings.ToLower(strings.TrimSpace(value))
	if clean == "auto" || cliPixelSizePattern.MatchString(clean) || cliRatioSizePattern.MatchString(clean) {
		return clean
	}
	return fallback
}

func renderCLIEnv(input CLIConfigSyncInput, directories cliDataDirectories) string {
	compat := "0"
	if input.ImagesNewAPICompat {
		compat = "1"
	}
	lines := []string{
		"# Auto-generated by FHL Studio UI.",
		"# This file is private. Do not commit or share it.",
		"",
		"IMAGE_STUDIO_API_KEY=" + input.APIKey,
		"IMAGE_STUDIO_UPSTREAM_BASE_URL=" + input.BaseURL,
		"IMAGE_STUDIO_API_MODE=" + input.APIMode,
		"IMAGE_STUDIO_REQUEST_POLICY=" + input.RequestPolicy,
		"IMAGE_STUDIO_IMAGES_NEWAPI_COMPAT=" + compat,
		"IMAGE_STUDIO_TEXT_MODEL=" + input.TextModelID,
		"IMAGE_STUDIO_IMAGE_MODEL=" + input.ImageModelID,
		"IMAGE_STUDIO_OUTPUT_FORMAT=" + input.OutputFormat,
		"IMAGE_STUDIO_QUALITY=" + input.Quality,
		"IMAGE_STUDIO_SIZE=" + input.Size,
		"IMAGE_STUDIO_PARTIAL_IMAGES=" + strconv.Itoa(input.PartialImages),
		"IMAGE_STUDIO_INPUT_DIR=" + cleanCLIEnvValue(filepath.Clean(directories.Input), "./input"),
		"IMAGE_STUDIO_OUTPUT_DIR=" + cleanCLIEnvValue(filepath.Clean(directories.Output), "./output"),
		"IMAGE_STUDIO_RAW_DIR=" + cleanCLIEnvValue(filepath.Clean(directories.Raw), "./output/log"),
		"",
	}
	return strings.Join(lines, "\n")
}
