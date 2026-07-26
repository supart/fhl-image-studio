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
	"time"
)

func TestRequestAndExtractWithRetriesRunningHubSubmitPollProxy(t *testing.T) {
	pngB64 := base64.StdEncoding.EncodeToString(fakePNG)
	originalPoll := runningHubPollInterval
	runningHubPollInterval = time.Millisecond
	t.Cleanup(func() { runningHubPollInterval = originalPoll })

	requests := []string{}
	var submitBody map[string]any
	var imageProxyURL string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path+"?"+r.URL.RawQuery)
		switch {
		case r.URL.Path == "/api/generate":
			defer r.Body.Close()
			if err := json.NewDecoder(r.Body).Decode(&submitBody); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"task":{"id":"rh_task_1","status":"running","imageUrls":["`+srv.URL+`/cdn/source-should-not-be-used.png"]}}`)
		case r.URL.Path == "/api/task":
			if r.URL.Query().Get("id") != "rh_task_1" {
				t.Fatalf("task id = %q", r.URL.Query().Get("id"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"task":{"id":"rh_task_1","status":"succeeded","images":[{"url":"`+srv.URL+`/cdn/rh.png"}]}}`)
		case r.URL.Path == "/api/image":
			imageProxyURL = r.URL.Query().Get("url")
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(fakePNG)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	result, rawPath, err := RequestAndExtractWithRetries(
		context.Background(),
		&NativeTransport{},
		Options{
			Prompt:       "wide panorama",
			BaseURL:      srv.URL,
			APIMode:      APIModeRunningHub,
			ImageModelID: "image_g2",
			Size:         "2048x1024",
		},
		t.TempDir(),
		"20260627-120000",
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceEvent != "runninghub_async" {
		t.Fatalf("SourceEvent = %q, want runninghub_async", result.SourceEvent)
	}
	if result.ImageB64 != pngB64 {
		t.Fatalf("ImageB64 mismatch")
	}
	if submitBody["model"] != "image_g2" || submitBody["mode"] != "text-to-image" {
		t.Fatalf("submit model/mode = %#v", submitBody)
	}
	if submitBody["aspect_ratio"] != "2:1" || submitBody["resolution"] != "2k" {
		t.Fatalf("submit size fields = %#v", submitBody)
	}
	if imageProxyURL != srv.URL+"/cdn/rh.png" {
		t.Fatalf("image proxy url = %q", imageProxyURL)
	}
	if !strings.HasSuffix(rawPath, "-attempt1.json") {
		t.Fatalf("rawPath = %q, want attempt1 json", rawPath)
	}
	if !slicesContain(requests, "/api/generate?") ||
		!slicesContain(requests, "/api/task?id=rh_task_1") ||
		!strings.HasPrefix(requests[len(requests)-1], "/api/image?url=") {
		t.Fatalf("requests missing expected RH flow: %v", requests)
	}
}

func TestRunningHubResponseLimits(t *testing.T) {
	t.Run("JSON", func(t *testing.T) {
		response := &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: maxHTTPResponseBytes + 1,
			Body:          io.NopCloser(strings.NewReader(`{"ok":true}`)),
		}
		defer response.Body.Close()
		_, err := readRunningHubJSONResponse(response, io.Discard, "test")
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

		_, err := runningHubImageValueToBase64(
			context.Background(),
			srv.Client(),
			srv.URL,
			runningHubImageValue{URL: "https://example.test/image.png"},
			io.Discard,
		)
		if !errors.Is(err, ErrHTTPResponseTooLarge) {
			t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
		}
	})
}

func TestRequestAndExtractWithRetriesRunningHubEditUploadsSources(t *testing.T) {
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
		case r.URL.Path == "/api/upload":
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
			if part.FormName() != "image" {
				t.Fatalf("upload field = %q, want image", part.FormName())
			}
			_, _ = io.Copy(io.Discard, part)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"upload":{"imageUrl":"https://rh.example/source.png"}}`)
		case r.URL.Path == "/api/generate":
			defer r.Body.Close()
			if err := json.NewDecoder(r.Body).Decode(&submitBody); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"task":{"id":"rh_task_2","status":"succeeded","images":[{"dataUrl":"data:image/png;base64,`+base64.StdEncoding.EncodeToString(fakePNG)+`"}]}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	result, _, err := RequestAndExtractWithRetries(
		context.Background(),
		&NativeTransport{},
		Options{
			Prompt:     "edit this scene",
			BaseURL:    srv.URL,
			APIMode:    APIModeRunningHub,
			Mode:       ModeEdit,
			ImagePaths: []string{src},
			Size:       "1536x864",
		},
		t.TempDir(),
		"20260627-120001",
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if uploadHits != 1 {
		t.Fatalf("uploadHits = %d, want 1", uploadHits)
	}
	if submitBody["mode"] != "image-to-image" {
		t.Fatalf("mode = %v, want image-to-image", submitBody["mode"])
	}
	if got := submitBody["image_urls"].([]any); len(got) != 1 || got[0] != "https://rh.example/source.png" {
		t.Fatalf("image_urls = %#v", submitBody["image_urls"])
	}
	if submitBody["aspect_ratio"] != "16:9" || submitBody["resolution"] != "1k" {
		t.Fatalf("submit size fields = %#v", submitBody)
	}
	if result.SourceEvent != "runninghub_async" {
		t.Fatalf("SourceEvent = %q, want runninghub_async", result.SourceEvent)
	}
}

func TestRunningHubAspectAndResolution(t *testing.T) {
	tests := []struct {
		size       string
		mode       string
		wantAspect string
		wantRes    string
	}{
		{"1024x1024", "text-to-image", "1:1", "1k"},
		{"1536x864", "text-to-image", "16:9", "1k"},
		{"864x1536", "text-to-image", "9:16", "1k"},
		{"2048x1024", "text-to-image", "2:1", "2k"},
		{"1:2@4k", "text-to-image", "1:2", "4k"},
		{"21:9@1k", "image-to-image", "21:9", "1k"},
	}
	for _, tt := range tests {
		t.Run(tt.size+"/"+tt.mode, func(t *testing.T) {
			gotAspect, gotRes := runningHubAspectAndResolution(tt.size, tt.mode)
			if gotAspect != tt.wantAspect || gotRes != tt.wantRes {
				t.Fatalf("runningHubAspectAndResolution(%q,%q) = %s/%s, want %s/%s", tt.size, tt.mode, gotAspect, gotRes, tt.wantAspect, tt.wantRes)
			}
		})
	}
}
