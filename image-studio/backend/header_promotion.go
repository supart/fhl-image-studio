package backend

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
)

const (
	headerPromotionPath     = "/__image-studio-files/header-promotion"
	headerPromotionFileName = "顶部推广信息.txt"
	headerPromotionMaxBytes = 16 * 1024
)

func serveHeaderPromotion(w http.ResponseWriter, r *http.Request) {
	serveHeaderPromotionWithExecutable(w, r, os.Executable)
}

func serveHeaderPromotionWithExecutable(
	w http.ResponseWriter,
	r *http.Request,
	executablePath func() (string, error),
) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	filePath, info, ok, err := resolveHeaderPromotionFile(executablePath)
	if err != nil {
		http.Error(w, "promotion file unavailable", http.StatusInternalServerError)
		return
	}
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if info.Size() > headerPromotionMaxBytes {
		http.Error(w, "promotion file too large", http.StatusRequestEntityTooLarge)
		return
	}
	body, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "promotion file unavailable", http.StatusInternalServerError)
		return
	}
	if len(body) > headerPromotionMaxBytes {
		http.Error(w, "promotion file too large", http.StatusRequestEntityTooLarge)
		return
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(body)
	}
}

func resolveHeaderPromotionFile(
	executablePath func() (string, error),
) (string, os.FileInfo, bool, error) {
	for _, filePath := range headerPromotionFileCandidates(executablePath) {
		info, err := os.Stat(filePath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", nil, false, err
		}
		return filePath, info, true, nil
	}
	return "", nil, false, nil
}

func headerPromotionFileCandidates(executablePath func() (string, error)) []string {
	paths := make([]string, 0, 2)
	if root, ok := portablePackageRoot(); ok {
		paths = append(paths, filepath.Join(root, headerPromotionFileName))
	}
	if runtime.GOOS != "darwin" {
		return paths
	}
	executable, err := executablePath()
	if err != nil {
		return paths
	}
	if bundleFile, ok := macOSBundleHeaderPromotionFile(executable); ok {
		paths = append(paths, bundleFile)
	}
	return paths
}

func macOSBundleHeaderPromotionFile(executablePath string) (string, bool) {
	executablePath = filepath.Clean(executablePath)
	if !filepath.IsAbs(executablePath) {
		return "", false
	}
	macOSDirectory := filepath.Dir(executablePath)
	if filepath.Base(macOSDirectory) != "MacOS" {
		return "", false
	}
	contentsDirectory := filepath.Dir(macOSDirectory)
	if filepath.Base(contentsDirectory) != "Contents" {
		return "", false
	}
	bundleDirectory := filepath.Dir(contentsDirectory)
	if filepath.Ext(bundleDirectory) != ".app" {
		return "", false
	}
	return filepath.Join(contentsDirectory, "Resources", headerPromotionFileName), true
}
