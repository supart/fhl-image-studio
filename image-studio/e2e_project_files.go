package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	e2eProjectFileMaxBodyBytes = 128 << 20
	e2eProjectImageMaxBytes    = 96 << 20
	e2eProjectTextMaxBytes     = 4 << 20
)

type e2eSaveImageRequest struct {
	Kind          string `json:"kind"`
	ImageB64      string `json:"imageB64"`
	SuggestedName string `json:"suggestedName"`
	MimeType      string `json:"mimeType"`
	Subdir        string `json:"subdir"`
	PreserveName  bool   `json:"preserveName"`
	Directory     string `json:"directory"`
}

func registerE2EProjectFileRoutes(mux *http.ServeMux, runtime *e2eRuntime) {
	handler := newE2EProjectFilesHandler(runtime)
	mux.HandleFunc(e2eProjectFilesPrefix, handler)
	mux.HandleFunc(e2eProjectFilesPrefix+"/", handler)
}

func newE2EProjectFilesHandler(runtime *e2eRuntime) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeE2EJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		route := strings.TrimPrefix(r.URL.Path, e2eProjectFilesPrefix)
		if route == "" {
			route = "/"
		}
		switch route {
		case "/save-image":
			handleE2ESaveProjectImage(w, r, runtime.root)
		case "/read-image":
			handleE2EReadProjectFile(w, r, runtime.root, "imageB64", true)
		case "/read-text":
			handleE2EReadProjectFile(w, r, runtime.root, "text", false)
		case "/list-batch-input-images":
			handleE2EListBatchInputImages(w, r, runtime.root)
		case "/build-batch-output-path":
			handleE2EBuildBatchOutputPath(w, r, runtime.root)
		case "/choose-directory":
			handleE2EChooseDirectory(w, r)
		default:
			writeE2EJSON(w, http.StatusNotFound, map[string]string{"error": "sandbox file route not found"})
		}
	}
}

func handleE2ESaveProjectImage(w http.ResponseWriter, r *http.Request, root string) {
	var body e2eSaveImageRequest
	if err := readE2EProjectJSON(w, r, &body); err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	kind := strings.TrimSpace(body.Kind)
	if kind != "input" && kind != "output" {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": "kind must be input or output"})
		return
	}
	data, err := decodeE2EProjectImageB64(body.ImageB64)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	dir, err := e2eProjectSaveDir(root, kind, body)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	ext := e2eImageExtFrom(data, body.MimeType, body.SuggestedName)
	name := e2eProjectImageName(body.SuggestedName, ext, body.PreserveName)
	target, err := e2eWriteUniqueFile(dir, name, data)
	if err != nil {
		writeE2EJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeE2EJSON(w, http.StatusOK, map[string]any{
		"path": target,
		"name": filepath.Base(target),
		"size": len(data),
	})
}

func handleE2EReadProjectFile(w http.ResponseWriter, r *http.Request, root, responseKey string, image bool) {
	var body struct {
		Path string `json:"path"`
	}
	if err := readE2EProjectJSON(w, r, &body); err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	path, err := e2eAssertSandboxFile(root, body.Path)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	limit := int64(e2eProjectTextMaxBytes)
	if image {
		limit = e2eProjectImageMaxBytes
	}
	data, err := readE2ELimitedFile(path, limit)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if image {
		writeE2EJSON(w, http.StatusOK, map[string]string{responseKey: base64.StdEncoding.EncodeToString(data)})
		return
	}
	writeE2EJSON(w, http.StatusOK, map[string]string{responseKey: string(data)})
}

func handleE2EListBatchInputImages(w http.ResponseWriter, r *http.Request, root string) {
	var body struct {
		Directory string `json:"directory"`
	}
	if err := readE2EProjectJSON(w, r, &body); err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	dir, err := e2eAssertSandboxDir(root, body.Directory)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	images := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if !e2eSupportedImageExt(entry.Name()) {
			continue
		}
		path, pathErr := e2eAssertSandboxFile(root, filepath.Join(dir, entry.Name()))
		if pathErr != nil {
			continue
		}
		info, infoErr := os.Stat(path)
		if infoErr != nil || !info.Mode().IsRegular() {
			continue
		}
		images = append(images, map[string]any{
			"path": path,
			"name": entry.Name(),
			"size": info.Size(),
		})
	}
	writeE2EJSON(w, http.StatusOK, map[string]any{
		"directory": dir,
		"images":    images,
	})
}

func handleE2EBuildBatchOutputPath(w http.ResponseWriter, r *http.Request, root string) {
	var body struct {
		SourcePath string `json:"sourcePath"`
		OutputDir  string `json:"outputDir"`
		Prefix     string `json:"prefix"`
	}
	if err := readE2EProjectJSON(w, r, &body); err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	sourcePath, err := e2eAssertSandboxFile(root, body.SourcePath)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	targetRoot := strings.TrimSpace(body.OutputDir)
	if targetRoot == "" {
		targetRoot = filepath.Dir(sourcePath)
	} else if targetRoot, err = e2eEnsureSandboxDir(root, targetRoot); err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	prefix := strings.TrimSpace(body.Prefix)
	if prefix == "" {
		prefix = "processed-"
	}
	target, err := e2eUniqueTargetPath(targetRoot, e2eSafeFileName(prefix+filepath.Base(sourcePath), "processed-image.png"))
	if err != nil {
		writeE2EJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeE2EJSON(w, http.StatusOK, map[string]string{"path": target})
}

func handleE2EChooseDirectory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Probe bool `json:"probe"`
	}
	if err := readE2EProjectJSON(w, r, &body); err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Probe {
		writeE2EJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	writeE2EJSON(w, http.StatusOK, map[string]string{"path": ""})
}

func readE2EProjectJSON(w http.ResponseWriter, r *http.Request, out any) error {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, e2eProjectFileMaxBodyBytes))
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func decodeE2EProjectImageB64(raw string) ([]byte, error) {
	clean := strings.TrimSpace(raw)
	if comma := strings.Index(clean, ","); comma >= 0 && strings.Contains(clean[:comma], "base64") {
		clean = clean[comma+1:]
	}
	clean = strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "").Replace(clean)
	data, err := base64.StdEncoding.DecodeString(clean)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, errors.New("image is empty")
	}
	if len(data) > e2eProjectImageMaxBytes {
		return nil, fmt.Errorf("image exceeds %d bytes", e2eProjectImageMaxBytes)
	}
	return data, nil
}

func e2eProjectSaveDir(root, kind string, body e2eSaveImageRequest) (string, error) {
	if strings.TrimSpace(body.Directory) != "" {
		return e2eEnsureSandboxDir(root, body.Directory)
	}
	base := filepath.Join(root, kind)
	subdir := e2eSafeSubdir(body.Subdir)
	if subdir != "" {
		base = filepath.Join(base, subdir)
	}
	return e2eEnsureSandboxDir(root, base)
}

func e2eAssertSandboxFile(root, value string) (string, error) {
	path, err := e2eResolveSandboxPath(root, value, false)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("sandbox path is not a regular file")
	}
	return path, nil
}

func e2eAssertSandboxDir(root, value string) (string, error) {
	path, err := e2eResolveSandboxPath(root, value, false)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("sandbox path is not a directory")
	}
	return path, nil
}

func e2eEnsureSandboxDir(root, value string) (string, error) {
	path, err := e2eResolveSandboxPath(root, value, true)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(path, 0o700); err != nil {
		return "", err
	}
	return e2eAssertSandboxDir(root, path)
}

func e2eResolveSandboxPath(root, value string, allowMissing bool) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", errors.New("path is required")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	canonicalRoot, err = filepath.Abs(canonicalRoot)
	if err != nil {
		return "", err
	}
	candidate := strings.TrimSpace(value)
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(canonicalRoot, candidate)
	}
	candidate, err = filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	resolved, err := resolveE2EPathSymlinks(candidate, allowMissing)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(canonicalRoot, resolved)
	if err != nil {
		return "", err
	}
	if rel == "." || (!filepath.IsAbs(rel) && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
		return resolved, nil
	}
	return "", fmt.Errorf("path outside E2E sandbox: %s", value)
}

func resolveE2EPathSymlinks(path string, allowMissing bool) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil {
		return filepath.Abs(resolved)
	}
	if !allowMissing || !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	current := filepath.Clean(path)
	missing := make([]string, 0, 4)
	for {
		if _, statErr := os.Lstat(current); statErr == nil {
			break
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return "", statErr
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
	resolved, err = filepath.EvalSymlinks(current)
	if err != nil {
		return "", err
	}
	for index := len(missing) - 1; index >= 0; index-- {
		resolved = filepath.Join(resolved, missing[index])
	}
	return filepath.Abs(resolved)
}

func readE2ELimitedFile(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("file exceeds %d bytes", maxBytes)
	}
	return data, nil
}

func e2eImageExtFrom(data []byte, mimeType, suggested string) string {
	ext := strings.ToLower(filepath.Ext(suggested))
	if e2eSupportedImageExt(ext) {
		return ext
	}
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/png":
		return ".png"
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return ".jpg"
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return ".webp"
	}
	return ".png"
}

func e2eProjectImageName(suggested, ext string, preserve bool) string {
	if preserve {
		return e2eSafeFileName(suggested, "image"+ext)
	}
	stamp := time.Now().Format("20060102-150405")
	stem := strings.TrimSuffix(e2eSafeFileName(suggested, "image"+ext), filepath.Ext(suggested))
	if strings.TrimSpace(stem) == "" {
		stem = "image"
	}
	return e2eSafeFileName(stamp+"-"+stem+ext, "image"+ext)
}

func e2eSafeFileName(value, fallback string) string {
	name := filepath.Base(strings.TrimSpace(value))
	name = strings.Map(func(r rune) rune {
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*':
			return '-'
		}
		if r < 32 {
			return '-'
		}
		return r
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" || name == "." || name == ".." {
		return fallback
	}
	return name
}

func e2eSafeSubdir(value string) string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '/' || r == '\\'
	})
	safe := make([]string, 0, len(parts))
	for _, part := range parts {
		clean := e2eSafeFileName(part, "")
		if clean != "" {
			safe = append(safe, clean)
		}
	}
	return filepath.Join(safe...)
}

func e2eSupportedImageExt(value string) bool {
	ext := strings.ToLower(value)
	if !strings.HasPrefix(ext, ".") {
		ext = strings.ToLower(filepath.Ext(value))
	}
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".avif":
		return true
	default:
		return false
	}
}

func e2eWriteUniqueFile(dir, fileName string, data []byte) (string, error) {
	name := e2eSafeFileName(fileName, "image.png")
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for index := 1; index < 10_000; index++ {
		candidateName := name
		if index > 1 {
			candidateName = fmt.Sprintf("%s-%d%s", base, index, ext)
		}
		candidate := filepath.Join(dir, candidateName)
		file, err := os.OpenFile(candidate, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(candidate)
			if writeErr != nil {
				return "", writeErr
			}
			return "", closeErr
		}
		return candidate, nil
	}
	return "", fmt.Errorf("too many files named like %s in target directory", name)
}

func e2eUniqueTargetPath(dir, fileName string) (string, error) {
	name := e2eSafeFileName(fileName, "image.png")
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for index := 1; index < 10_000; index++ {
		candidateName := name
		if index > 1 {
			candidateName = fmt.Sprintf("%s-%d%s", base, index, ext)
		}
		candidate := filepath.Join(dir, candidateName)
		if _, err := os.Lstat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("too many files named like %s in target directory", name)
}
