package backend

import (
	"encoding/base64"
	"errors"
	"fmt"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var supportedBatchInputExtensions = map[string]struct{}{
	".png":  {},
	".jpg":  {},
	".jpeg": {},
	".webp": {},
}

func (s *Service) BeginNativeFileDrag(path string) error {
	allowed, err := s.ensureManagedReadablePath(path, managedImageFile)
	if err != nil {
		return err
	}
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "native-file-drag", allowed)
	}
	return beginNativeFileDrag(allowed)
}

// OpenImageDialog shows a file picker filtered to supported image types and
// returns the selected absolute path, size, and a managed AVIF preview URL when
// thumbnail generation succeeds.
const maxDialogReadBytes int64 = 50 * 1024 * 1024

func (s *Service) OpenImageDialog() (SelectFileResponse, error) {
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择源图片",
		Filters: []runtime.FileFilter{
			{DisplayName: "支持的图片 (*.png;*.jpg;*.jpeg;*.webp)", Pattern: "*.png;*.jpg;*.jpeg;*.webp"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return SelectFileResponse{}, err
	}
	if path == "" {
		return SelectFileResponse{}, nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return SelectFileResponse{}, err
	}
	sourceName := filepath.Base(path)
	imported, err := s.importImageFile(path)
	if err != nil {
		return SelectFileResponse{}, err
	}
	resp := SelectFileResponse{
		Path:   imported.Path,
		Name:   sourceName,
		Size:   info.Size(),
		Width:  imported.Width,
		Height: imported.Height,
	}
	if info.Size() > 0 && info.Size() <= maxDialogReadBytes {
		if preview, previewErr := s.registerImportedPreview(imported.Path); previewErr == nil {
			resp.ImageID = preview.ID
			resp.PreviewURL = preview.PreviewURL
			resp.PreviewWidth = preview.PreviewWidth
			resp.PreviewHeight = preview.PreviewHeight
		}
	}
	return resp, nil
}

func (s *Service) OpenImagesDialog() (SelectFilesResponse, error) {
	paths, err := runtime.OpenMultipleFilesDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择批处理源图片",
		Filters: []runtime.FileFilter{
			{DisplayName: "支持的图片 (*.png;*.jpg;*.jpeg;*.webp)", Pattern: "*.png;*.jpg;*.jpeg;*.webp"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return SelectFilesResponse{}, err
	}
	if len(paths) == 0 {
		return SelectFilesResponse{}, nil
	}
	files := make([]BatchInputImage, 0, len(paths))
	failures := make([]string, 0)
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		info, statErr := os.Stat(path)
		if statErr != nil || info.IsDir() {
			if statErr != nil {
				failures = append(failures, fmt.Sprintf("%s: %v", filepath.Base(path), statErr))
			}
			continue
		}
		imported, importErr := s.importImageFile(path)
		if importErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", filepath.Base(path), importErr))
			continue
		}
		item := BatchInputImage{
			Path:   imported.Path,
			Name:   filepath.Base(path),
			Size:   info.Size(),
			Width:  imported.Width,
			Height: imported.Height,
		}
		if info.Size() > 0 && info.Size() <= maxDialogReadBytes {
			if preview, previewErr := s.registerImportedPreview(imported.Path); previewErr == nil {
				item.PreviewURL = preview.PreviewURL
				item.PreviewWidth = preview.PreviewWidth
				item.PreviewHeight = preview.PreviewHeight
			}
		}
		files = append(files, item)
	}
	if len(files) == 0 && len(failures) > 0 {
		detail := strings.Join(failures, "; ")
		if len(failures) > 3 {
			detail = strings.Join(failures[:3], "; ") + fmt.Sprintf("; 等 %d 张失败", len(failures))
		}
		return SelectFilesResponse{}, fmt.Errorf("批处理图片导入失败: %s", detail)
	}
	return SelectFilesResponse{Files: files}, nil
}

func (s *Service) ChooseBatchInputDir() (BatchInputDirectory, error) {
	if s.ctx == nil {
		return BatchInputDirectory{}, errors.New("服务未启动")
	}
	chosen, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择批处理输入目录",
	})
	if err != nil {
		return BatchInputDirectory{}, err
	}
	if chosen == "" {
		return BatchInputDirectory{}, nil
	}
	return s.ListBatchInputImages(chosen)
}

func (s *Service) ListBatchInputImages(directory string) (BatchInputDirectory, error) {
	clean := strings.TrimSpace(directory)
	if clean == "" {
		return BatchInputDirectory{}, errors.New("目标目录不能为空")
	}
	root, err := filepath.Abs(clean)
	if err != nil {
		return BatchInputDirectory{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return BatchInputDirectory{}, fmt.Errorf("读取目录失败: %w", err)
	}
	if !info.IsDir() {
		return BatchInputDirectory{}, fmt.Errorf("不是目录: %s", root)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return BatchInputDirectory{}, fmt.Errorf("解析目录失败: %w", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return BatchInputDirectory{}, fmt.Errorf("读取目录失败: %w", err)
	}
	images := make([]BatchInputImage, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if _, ok := supportedBatchInputExtensions[ext]; !ok {
			continue
		}
		path, pathErr := canonicalBatchInputPath(root, filepath.Join(root, entry.Name()))
		if pathErr != nil {
			continue
		}
		info, infoErr := os.Stat(path)
		if infoErr != nil {
			continue
		}
		if info.IsDir() {
			continue
		}
		item, itemErr := s.materializeBatchInputImage(path, entry.Name(), info)
		if itemErr != nil {
			continue
		}
		images = append(images, item)
	}
	resultDirectory := root
	if common := commonDirectoryFromBatchImages(images); common != "" {
		resultDirectory = common
	}
	return BatchInputDirectory{
		Directory: resultDirectory,
		Images:    images,
	}, nil
}

func canonicalBatchInputPath(root, path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	if !isWithinRoot(resolved, root) {
		return "", fmt.Errorf("拒绝访问批量目录之外的文件: %s", filepath.Base(path))
	}
	return resolved, nil
}

func (s *Service) materializeBatchInputImage(path, displayName string, info os.FileInfo) (BatchInputImage, error) {
	managedPath := path
	if _, err := s.ensureManagedReadablePath(path, managedImageFile); err != nil {
		imported, importErr := s.importImageFile(path)
		if importErr != nil {
			return BatchInputImage{}, importErr
		}
		managedPath = imported.Path
	}
	item := BatchInputImage{
		Path: managedPath,
		Name: displayName,
		Size: info.Size(),
	}
	if cfg, cfgErr := imageConfig(managedPath); cfgErr == nil {
		item.Width = cfg.Width
		item.Height = cfg.Height
	}
	if info.Size() > 0 && info.Size() <= maxDialogReadBytes {
		if preview, previewErr := s.registerImportedPreview(managedPath); previewErr == nil {
			item.PreviewURL = preview.PreviewURL
			item.PreviewWidth = preview.PreviewWidth
			item.PreviewHeight = preview.PreviewHeight
		}
	}
	return item, nil
}

func commonDirectoryFromBatchImages(images []BatchInputImage) string {
	common := ""
	for _, image := range images {
		dir := filepath.Dir(strings.TrimSpace(image.Path))
		if dir == "." || dir == "" {
			continue
		}
		if common == "" {
			common = dir
			continue
		}
		if common != dir {
			return ""
		}
	}
	return common
}

// SaveImageAs prompts the user for a destination and writes the base64 PNG to disk.
func (s *Service) SaveImageAs(imageB64, suggestedName string) (string, error) {
	validated, err := decodeBase64Image(imageB64)
	if err != nil {
		return "", err
	}
	if suggestedName == "" {
		suggestedName = fmt.Sprintf("image-%d%s", time.Now().Unix(), validated.Extension)
	} else {
		suggestedName = filepath.Base(forceImageExtension(suggestedName, validated.Extension))
	}
	dst, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "保存图片",
		DefaultFilename: suggestedName,
		Filters: []runtime.FileFilter{
			{DisplayName: "图片文件 (*.png;*.jpg;*.jpeg;*.webp;*.avif)", Pattern: "*.png;*.jpg;*.jpeg;*.webp;*.avif"},
		},
	})
	if err != nil || dst == "" {
		return "", err
	}
	if !imageExtensionMatches(dst, validated.Extension) {
		return "", fmt.Errorf("保存扩展名必须与图片格式匹配:%s", validated.Extension)
	}
	return writeImageBytes(validated.Bytes, dst)
}

// SaveImagePathAs copies an existing managed image to a user-selected path.
// Generated results use this path-first route so the frontend does not have to
// read the full image into JS memory just to save a copy.
func (s *Service) SaveImagePathAs(path, suggestedName string) (string, error) {
	allowed, err := s.ensureManagedReadablePath(path, managedImageFile)
	if err != nil {
		return "", err
	}
	if suggestedName == "" {
		suggestedName = filepath.Base(allowed)
	}
	dst, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "保存图片",
		DefaultFilename: suggestedName,
		Filters: []runtime.FileFilter{
			{DisplayName: "图片文件 (*.png;*.jpg;*.jpeg;*.webp;*.avif)", Pattern: "*.png;*.jpg;*.jpeg;*.webp;*.avif"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || dst == "" {
		return "", err
	}
	validated, err := readValidatedImageFile(allowed)
	if err != nil {
		return "", err
	}
	if !imageExtensionMatches(dst, validated.Extension) {
		return "", fmt.Errorf("保存扩展名必须与图片格式匹配:%s", validated.Extension)
	}
	return writeImageBytes(validated.Bytes, dst)
}

// SaveImageToDir writes a base64 image into a specified directory without
// opening a save dialog. It is a low-level capability for future auto-save
// workflows; current UI flows still use SaveImageAs by default.
func (s *Service) SaveImageToDir(imageB64, directory, suggestedName string) (string, error) {
	validated, err := decodeBase64Image(imageB64)
	if err != nil {
		return "", err
	}
	root, err := s.ensureManagedWritableDirectory(directory)
	if err != nil {
		return "", err
	}
	name := ensureTargetFileName(suggestedName, fmt.Sprintf("image-%d%s", time.Now().Unix(), validated.Extension))
	name = filepath.Base(forceImageExtension(name, validated.Extension))
	dst, err := uniqueTargetPath(root, name)
	if err != nil {
		return "", err
	}
	return writeImageBytes(validated.Bytes, dst)
}

// SaveImagePathToDir copies an existing managed image into a specified
// directory without prompting the user.
func (s *Service) SaveImagePathToDir(path, directory, suggestedName string) (string, error) {
	allowed, err := s.ensureManagedReadablePath(path, managedImageFile)
	if err != nil {
		return "", err
	}
	root, err := s.ensureManagedWritableDirectory(directory)
	if err != nil {
		return "", err
	}
	validated, err := readValidatedImageFile(allowed)
	if err != nil {
		return "", err
	}
	name := ensureTargetFileName(suggestedName, filepath.Base(allowed))
	name = filepath.Base(forceImageExtension(name, validated.Extension))
	dst, err := uniqueTargetPath(root, name)
	if err != nil {
		return "", err
	}
	return writeImageBytes(validated.Bytes, dst)
}

// GetOutputDir returns the directory where generated images and raw response
// dumps are written —— 用户自定义优先,空时回退到默认。
func (s *Service) GetOutputDir() (string, error) {
	return s.resolvedOutputDir()
}

// SyncMaterialGroupToOutput mirrors material-library references into a visible
// output subfolder. It copies files only; it never moves original generated
// files or mutates history records.
func (s *Service) SyncMaterialGroupToOutput(groupKind, groupName string, items []MaterialOutputSyncItem) (MaterialOutputSyncResult, error) {
	root, err := s.resolvedOutputDir()
	if err != nil {
		return MaterialOutputSyncResult{}, err
	}
	kindDir := materialSyncKindDir(groupKind)
	targetDir := filepath.Join(root, "素材管理", kindDir, sanitizeMaterialSyncSegment(groupName, "未命名素材组"))
	if err := os.MkdirAll(targetDir, secureDirMode); err != nil {
		return MaterialOutputSyncResult{}, fmt.Errorf("create material sync directory: %w", err)
	}
	result := MaterialOutputSyncResult{
		TargetDir:    targetDir,
		Files:        []MaterialOutputSyncedFile{},
		MissingItems: []MaterialOutputSyncMissing{},
	}
	for _, item := range items {
		historyID := strings.TrimSpace(item.HistoryID)
		path := strings.TrimSpace(item.SavedPath)
		if path == "" {
			reason := strings.TrimSpace(item.MissingReason)
			if reason == "" {
				reason = "历史记录没有保存路径"
			}
			result.MissingItems = append(result.MissingItems, MaterialOutputSyncMissing{
				HistoryID: historyID,
				Reason:    reason,
			})
			continue
		}
		allowed, readErr := s.ensureManagedReadablePath(path, managedImageFile)
		if readErr != nil {
			result.MissingItems = append(result.MissingItems, MaterialOutputSyncMissing{
				HistoryID: historyID,
				Path:      path,
				Reason:    readErr.Error(),
			})
			continue
		}
		validated, readErr := readValidatedImageFile(allowed)
		if readErr != nil {
			result.MissingItems = append(result.MissingItems, MaterialOutputSyncMissing{
				HistoryID: historyID,
				Path:      path,
				Reason:    readErr.Error(),
			})
			continue
		}
		name := ensureTargetFileName(item.SuggestedName, filepath.Base(allowed))
		name = filepath.Base(forceImageExtension(name, validated.Extension))
		dst, pathErr := uniqueTargetPath(targetDir, name)
		if pathErr != nil {
			result.MissingItems = append(result.MissingItems, MaterialOutputSyncMissing{
				HistoryID: historyID,
				Path:      path,
				Reason:    pathErr.Error(),
			})
			continue
		}
		if writeErr := os.WriteFile(dst, validated.Bytes, secureFileMode); writeErr != nil {
			result.MissingItems = append(result.MissingItems, MaterialOutputSyncMissing{
				HistoryID: historyID,
				Path:      path,
				Reason:    writeErr.Error(),
			})
			continue
		}
		abs, _ := filepath.Abs(dst)
		result.Files = append(result.Files, MaterialOutputSyncedFile{
			HistoryID: historyID,
			Source:    allowed,
			Path:      abs,
		})
	}
	result.Synced = len(result.Files)
	result.Missing = len(result.MissingItems)
	return result, nil
}

func (s *Service) OpenMaterialSyncDir(path string) error {
	root, err := s.resolvedOutputDir()
	if err != nil {
		return err
	}
	clean := strings.TrimSpace(path)
	if clean == "" {
		clean = filepath.Join(root, "素材管理")
	}
	abs, err := filepath.Abs(clean)
	if err != nil {
		return fmt.Errorf("路径无效:%w", err)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(rootAbs, secureDirMode); err != nil {
		return err
	}
	resolvedRoot, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return err
	}
	resolvedCandidate, err := resolvePathWithExistingAncestor(abs)
	if err != nil {
		return err
	}
	if !isWithinRoot(resolvedCandidate, resolvedRoot) {
		return fmt.Errorf("拒绝打开 output 之外的素材目录:%s", filepath.Base(abs))
	}
	if err := os.MkdirAll(abs, secureDirMode); err != nil {
		return err
	}
	resolvedPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return err
	}
	if !isWithinRoot(resolvedPath, resolvedRoot) {
		return fmt.Errorf("拒绝打开 output 之外的素材目录:%s", filepath.Base(abs))
	}
	return openInExplorer(resolvedPath)
}

func ensureTargetFileName(suggestedName, fallback string) string {
	name := strings.TrimSpace(suggestedName)
	if name == "" {
		name = fallback
	}
	name = filepath.Base(name)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return fallback
	}
	return name
}

func uniqueTargetPath(dir, fileName string) (string, error) {
	ext := filepath.Ext(fileName)
	base := strings.TrimSuffix(fileName, ext)
	candidate := filepath.Join(dir, fileName)
	if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
		return candidate, nil
	} else if err != nil {
		return "", err
	}
	for i := 2; i < 10_000; i++ {
		next := filepath.Join(dir, fmt.Sprintf("%s-%d%s", base, i, ext))
		if _, err := os.Stat(next); errors.Is(err, os.ErrNotExist) {
			return next, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("too many files named like %s in target directory", fileName)
}

func uniquePrefixedTargetPath(dir, sourceName, prefix string) (string, error) {
	base := ensureTargetFileName(sourceName, "image.png")
	trimmedPrefix := strings.TrimSpace(prefix)
	if trimmedPrefix == "" {
		return uniqueTargetPath(dir, base)
	}
	return uniqueTargetPath(dir, trimmedPrefix+base)
}

func materialSyncKindDir(kind string) string {
	switch strings.TrimSpace(kind) {
	case "referenceSet":
		return "参考图组"
	default:
		return "文件夹"
	}
}

func sanitizeMaterialSyncSegment(value, fallback string) string {
	name := strings.TrimSpace(value)
	if name == "" {
		name = fallback
	}
	var b strings.Builder
	for _, r := range name {
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*':
			b.WriteRune('_')
		default:
			if r < 32 {
				b.WriteRune('_')
			} else {
				b.WriteRune(r)
			}
		}
	}
	clean := strings.Trim(strings.TrimSpace(b.String()), ".")
	if clean == "" {
		clean = fallback
	}
	runes := []rune(clean)
	if len(runes) > 80 {
		clean = strings.TrimSpace(string(runes[:80]))
		clean = strings.Trim(clean, ".")
	}
	if clean == "" {
		return fallback
	}
	return clean
}

// OpenOutputDir reveals the output directory in the OS file explorer.
// 兜底:用户在第一次生成前就点「打开输出目录」,默认路径还不存在 ——
// `open` / `xdg-open` / `explorer` 拿到不存在的路径都会失败(macOS / Linux
// 表现为完全打不开),所以这里把根目录 + images/log 子目录预建好。
func (s *Service) OpenOutputDir() error {
	dir, err := s.resolvedOutputDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(imagesSubdir(dir), secureDirMode); err != nil {
		return err
	}
	if err := os.MkdirAll(thumbsSubdir(dir), secureDirMode); err != nil {
		return err
	}
	if err := os.MkdirAll(previewsSubdir(dir), secureDirMode); err != nil {
		return err
	}
	if err := os.MkdirAll(logSubdir(dir), secureDirMode); err != nil {
		return err
	}
	return openInExplorer(dir)
}

// OpenExternalURL launches a URL in the default browser. Used for GitHub /
// License / Issues links in the About dialog and Footer.
func (s *Service) OpenExternalURL(rawURL string) error {
	if rawURL == "" {
		return errors.New("url is empty")
	}
	parsed, err := neturl.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("invalid external url")
	}
	switch parsed.Scheme {
	case "http", "https":
	default:
		return errors.New("unsupported external url scheme")
	}
	return openInExplorer(rawURL)
}

// OpenFile 在系统默认应用里打开一个本地文件 —— 前端「查看日志」按钮调用,
// 让用户拿系统记事本 / TextEdit / xdg-open 关联程序读 sse-response-*.txt
// 这类原始上游响应。文件不存在就返回错误。
func (s *Service) OpenFile(path string) error {
	allowed, err := s.ensureManagedOpenPath(path)
	if err != nil {
		return err
	}
	return openInExplorer(allowed)
}

// ReadImageAsBase64 loads an image file from disk and returns its bytes as
// standard base64. Used by the frontend to refresh the canvas after a
// rotate/flip/crop operation produced a new file in imports/.
func (s *Service) ReadImageAsBase64(path string) (string, error) {
	allowed, err := s.ensureManagedReadablePath(path, managedImageFile)
	if err != nil {
		return "", err
	}
	validated, err := readValidatedImageFile(allowed)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(validated.Bytes), nil
}

// ReadTextFile returns a file's contents as a string. Used to display the raw
// SSE response in the "查看 raw" modal.
func (s *Service) ReadTextFile(path string) (string, error) {
	allowed, err := s.ensureManagedReadablePath(path, managedRawLogFile)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(allowed)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ExportHistoryToFile writes a JSON dump (provided by the frontend) to a
// user-chosen path. Powers the "导出历史" action in settings.
func (s *Service) ExportHistoryToFile(jsonContent string) (string, error) {
	dst, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出历史记录",
		DefaultFilename: fmt.Sprintf("fhl-studio-history-%s.json", time.Now().Format("20060102-150405")),
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil || dst == "" {
		return "", err
	}
	if err := os.WriteFile(dst, []byte(jsonContent), secureFileMode); err != nil {
		return "", err
	}
	return dst, nil
}

// ImportHistoryFromFile opens a file picker and returns the JSON content as a
// string. The frontend then parses and merges the entries into IndexedDB.
func (s *Service) ImportHistoryFromFile() (string, error) {
	src, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择历史 JSON 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil || src == "" {
		return "", err
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
