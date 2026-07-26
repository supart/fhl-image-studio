package backend

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type managedPathKind int

const (
	managedImageFile managedPathKind = iota
	managedRawLogFile
)

func (s *Service) addTrustedOutputRoot(path string) {
	if strings.TrimSpace(path) == "" {
		return
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return
	}
	if resolved, resolveErr := filepath.EvalSymlinks(abs); resolveErr == nil {
		abs = resolved
	}
	s.mu.Lock()
	if s.trustedOutputRoots == nil {
		s.trustedOutputRoots = map[string]struct{}{}
	}
	s.trustedOutputRoots[abs] = struct{}{}
	s.mu.Unlock()
}

func (s *Service) ensureManagedOpenPath(path string) (string, error) {
	if allowed, err := s.ensureManagedReadablePath(path, managedRawLogFile); err == nil {
		switch strings.ToLower(filepath.Ext(allowed)) {
		case ".txt", ".json", ".log":
			return allowed, nil
		}
	}
	if allowed, err := s.ensureManagedReadablePath(path, managedImageFile); err == nil {
		switch strings.ToLower(filepath.Ext(allowed)) {
		case ".png", ".jpg", ".jpeg", ".webp", ".avif":
			return allowed, nil
		}
	}
	return "", fmt.Errorf("拒绝打开应用托管目录之外的文件:%s", filepath.Base(path))
}

func (s *Service) ensureManagedWritableDirectory(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("目标目录不能为空")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("路径无效:%w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("路径不是目录:%s", abs)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	for _, root := range s.allowedWritableRoots() {
		if isWithinRoot(resolved, root) {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("拒绝写入未授权目录:%s", filepath.Base(resolved))
}

func (s *Service) allowedWritableRoots() []string {
	roots := make([]string, 0, 8)
	if root, err := defaultOutputDir(); err == nil {
		roots = append(roots, root)
	}
	if root, ok := portablePackageRoot(); ok {
		roots = append(roots, portableOutputDir(root))
	}
	roots = append(roots, platformLegacyOutputRoots()...)
	if root := s.currentOutputRootSnapshot(); root != "" {
		roots = append(roots, root)
	}
	roots = append(roots, s.trustedOutputRootsSnapshot()...)
	return normalizeRoots(roots)
}

func (s *Service) trustedOutputRootsSnapshot() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	roots := make([]string, 0, len(s.trustedOutputRoots))
	for root := range s.trustedOutputRoots {
		roots = append(roots, root)
	}
	return roots
}

func (s *Service) currentOutputRootSnapshot() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.outputDir
}

func (s *Service) ensureManagedReadablePath(path string, kind managedPathKind) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("路径不能为空")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("路径无效:%w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("路径不是文件:%s", abs)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	for _, root := range s.allowedRoots(kind) {
		if isWithinRoot(resolved, root) {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("拒绝访问应用托管目录之外的文件:%s", filepath.Base(resolved))
}

func (s *Service) ensureManagedReadableDirectory(path string, kind managedPathKind) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("路径不能为空")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("路径无效:%w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("路径不是目录:%s", abs)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	for _, root := range s.allowedRoots(kind) {
		if isWithinRoot(resolved, root) {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("拒绝访问应用托管目录之外的目录:%s", filepath.Base(resolved))
}

func (s *Service) allowedRoots(kind managedPathKind) []string {
	roots := make([]string, 0, 8)
	if kind == managedImageFile {
		if dir, err := importsDir(); err == nil {
			roots = append(roots, dir, previewsSubdir(dir))
		}
		if root, ok := portablePackageRoot(); ok {
			roots = append(roots, portableInputDir(root), portableOutputDir(root), portableIntermediateDir(root))
		}
		roots = append(roots, platformLegacyImportDirs()...)
	}
	if root, err := defaultOutputDir(); err == nil {
		roots = appendManagedOutputRoot(roots, root, kind)
	}
	for _, root := range platformLegacyOutputRoots() {
		roots = appendManagedOutputRoot(roots, root, kind)
	}
	if root := s.currentOutputRootSnapshot(); root != "" {
		roots = appendManagedOutputRoot(roots, root, kind)
	}
	for _, root := range s.trustedOutputRootsSnapshot() {
		if kind == managedImageFile {
			roots = append(roots, root)
		}
		roots = appendManagedOutputRoot(roots, root, kind)
	}
	return normalizeRoots(roots)
}

func appendManagedOutputRoot(roots []string, root string, kind managedPathKind) []string {
	switch kind {
	case managedImageFile:
		return append(roots, imagesSubdir(root), thumbsSubdir(root), previewsSubdir(root))
	case managedRawLogFile:
		return append(roots, logSubdir(root))
	default:
		return roots
	}
}

func normalizeRoots(roots []string) []string {
	seen := make(map[string]struct{}, len(roots))
	out := make([]string, 0, len(roots))
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		abs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		if resolved, err := filepath.EvalSymlinks(abs); err == nil {
			abs = resolved
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		out = append(out, abs)
	}
	return out
}

func resolvePathWithExistingAncestor(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, resolveErr := filepath.EvalSymlinks(abs); resolveErr == nil {
		return resolved, nil
	} else if !errors.Is(resolveErr, os.ErrNotExist) {
		return "", resolveErr
	}

	current := filepath.Clean(abs)
	missing := make([]string, 0, 4)
	for {
		if _, statErr := os.Lstat(current); statErr == nil {
			break
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return "", statErr
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("找不到可解析的父目录:%s", filepath.Base(abs))
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
	resolved, err := filepath.EvalSymlinks(current)
	if err != nil {
		return "", err
	}
	for index := len(missing) - 1; index >= 0; index-- {
		resolved = filepath.Join(resolved, missing[index])
	}
	return filepath.Abs(resolved)
}

func isWithinRoot(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}
