package backend

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
)

const (
	headerPromotionPath     = "/__image-studio-files/header-promotion"
	headerPromotionFileName = "顶部推广信息.txt"
	headerPromotionMaxBytes = 16 * 1024
)

func serveHeaderPromotion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	root, ok := portablePackageRoot()
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	filePath := filepath.Join(root, headerPromotionFileName)
	info, err := os.Stat(filePath)
	if errors.Is(err, os.ErrNotExist) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		http.Error(w, "promotion file unavailable", http.StatusInternalServerError)
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
