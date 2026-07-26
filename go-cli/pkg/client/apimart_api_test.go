package client

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestRequestAndExtractWithRetriesAPIMartSubmitPollDownload(t *testing.T) {
	pngB64 := base64.StdEncoding.EncodeToString(fakePNG)
	requests := []string{}
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path+"?"+r.URL.RawQuery)
		switch {
		case r.URL.Path == "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"code":200,"data":[{"status":"submitted","task_id":"task_apimart_1"}]}`)
		case r.URL.Path == "/v1/tasks/task_apimart_1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"status":"succeeded","data":{"output":{"url":["`+srv.URL+`/cdn/generated.png"]}}}`)
		case r.URL.Path == "/cdn/generated.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(fakePNG)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	originalBackoff := RetryBackoffSeconds
	RetryBackoffSeconds = 0
	t.Cleanup(func() { RetryBackoffSeconds = originalBackoff })

	result, rawPath, err := RequestAndExtractWithRetries(
		context.Background(),
		&NativeTransport{},
		Options{
			APIKey:  "sk-test",
			Prompt:  "vertical portrait",
			BaseURL: srv.URL,
			APIMode: APIModeApimart,
			Size:    "9:16@2k",
		},
		t.TempDir(),
		"20260618-120000",
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceEvent != "apimart_async" {
		t.Fatalf("SourceEvent = %q, want apimart_async", result.SourceEvent)
	}
	if result.ImageB64 != pngB64 {
		t.Fatalf("ImageB64 mismatch")
	}
	if !strings.HasSuffix(rawPath, "-attempt1.json") {
		t.Fatalf("rawPath = %q, want attempt1 json", rawPath)
	}
	if !slicesContain(requests, "/v1/images/generations?") {
		t.Fatalf("submit request missing: %v", requests)
	}
	if !slicesContain(requests, "/v1/tasks/task_apimart_1?language=zh") {
		t.Fatalf("poll request missing: %v", requests)
	}
	if !slicesContain(requests, "/cdn/generated.png?") {
		t.Fatalf("image download missing: %v", requests)
	}
}

func TestAPIMartResponseLimits(t *testing.T) {
	t.Run("JSON", func(t *testing.T) {
		response := &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: maxHTTPResponseBytes + 1,
			Body:          io.NopCloser(strings.NewReader(`{"ok":true}`)),
		}
		defer response.Body.Close()
		_, err := readAPIMartJSONResponse(response, io.Discard, "test")
		if !errors.Is(err, ErrHTTPResponseTooLarge) {
			t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
		}
	})

	t.Run("download", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Content-Length", strconv.FormatInt(maxHTTPResponseBytes+1, 10))
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		_, err := apimartImageValueToBase64(context.Background(), srv.Client(), srv.URL+"/image.png")
		if !errors.Is(err, ErrHTTPResponseTooLarge) {
			t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
		}
	})
}

func TestRequestAndExtractWithRetriesAPIMartEditUploadsSources(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.png")
	if err := os.WriteFile(src, fakePNG, 0o644); err != nil {
		t.Fatal(err)
	}

	uploadHits := 0
	var submitBody map[string]any
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/uploads/images":
			uploadHits++
			mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil {
				t.Fatalf("parse media type: %v", err)
			}
			if mediaType != "multipart/form-data" {
				t.Fatalf("upload content-type = %q", mediaType)
			}
			reader := multipart.NewReader(r.Body, params["boundary"])
			part, err := reader.NextPart()
			if err != nil {
				t.Fatalf("read upload part: %v", err)
			}
			if part.FormName() != "file" {
				t.Fatalf("upload field = %q, want file", part.FormName())
			}
			_, _ = io.Copy(io.Discard, part)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"url":"https://upload.apimart.example/source.png"}`)
		case r.URL.Path == "/v1/images/generations":
			defer r.Body.Close()
			if err := json.NewDecoder(r.Body).Decode(&submitBody); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"data":[{"status":"submitted","task_id":"task_apimart_1"}]}`)
		case r.URL.Path == "/v1/tasks/task_apimart_1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"status":"succeeded","data":{"output":{"url":["data:image/png;base64,`+base64.StdEncoding.EncodeToString(fakePNG)+`"]}}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	result, _, err := RequestAndExtractWithRetries(
		context.Background(),
		&NativeTransport{},
		Options{
			APIKey:     "sk-test",
			Prompt:     "edit this scene",
			BaseURL:    srv.URL,
			APIMode:    APIModeApimart,
			Mode:       ModeEdit,
			ImagePaths: []string{src},
			Size:       "1536x1024",
		},
		t.TempDir(),
		"20260618-120001",
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if uploadHits != 1 {
		t.Fatalf("uploadHits = %d, want 1", uploadHits)
	}
	if got := submitBody["image_urls"].([]any); len(got) != 1 || got[0] != "https://upload.apimart.example/source.png" {
		t.Fatalf("image_urls = %#v", submitBody["image_urls"])
	}
	if submitBody["size"] != "3:2" {
		t.Fatalf("size = %v, want 3:2", submitBody["size"])
	}
	if submitBody["resolution"] != "1k" {
		t.Fatalf("resolution = %v, want 1k", submitBody["resolution"])
	}
	if result.SourceEvent != "apimart_async" {
		t.Fatalf("SourceEvent = %q, want apimart_async", result.SourceEvent)
	}
}

func TestRequestAndExtractWithRetriesAPIMartRetriesTransientSubmitFailure(t *testing.T) {
	originalBackoff := RetryBackoffSeconds
	RetryBackoffSeconds = 0
	t.Cleanup(func() { RetryBackoffSeconds = originalBackoff })

	hits := 0
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		hits++
		w.Header().Set("Content-Type", "application/json")
		if hits == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":{"message":"service temporarily unavailable","type":"upstream_error"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":{"url":["data:image/png;base64,`+base64.StdEncoding.EncodeToString(fakePNG)+`"]}}`)
	}))
	defer srv.Close()

	result, _, err := RequestAndExtractWithRetries(
		context.Background(),
		&NativeTransport{},
		Options{
			APIKey:  "sk-test",
			Prompt:  "retry once",
			BaseURL: srv.URL,
			APIMode: APIModeApimart,
		},
		t.TempDir(),
		"20260618-120002",
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if hits != 2 {
		t.Fatalf("hits = %d, want 2", hits)
	}
	if result.SourceEvent != "apimart_async" {
		t.Fatalf("SourceEvent = %q, want apimart_async", result.SourceEvent)
	}
}

func TestAspectAndResolutionForAPIMartSize(t *testing.T) {
	if got := aspectForAPIMartSize("9:16@4k"); got != "9:16" {
		t.Fatalf("aspectForAPIMartSize compact = %q", got)
	}
	if got := resolutionForAPIMartSize("9:16@4k"); got != "4k" {
		t.Fatalf("resolutionForAPIMartSize compact = %q", got)
	}
	if got := aspectForAPIMartSize("2048x1360"); got != "3:2" {
		t.Fatalf("aspectForAPIMartSize exact = %q", got)
	}
	if got := resolutionForAPIMartSize("2048x1360"); got != "2k" {
		t.Fatalf("resolutionForAPIMartSize exact = %q", got)
	}
}

func slicesContain(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
