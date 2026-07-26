package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRequestImagesAPIWithPartialStreamsPreviews(t *testing.T) {
	partialB64 := base64.StdEncoding.EncodeToString([]byte("partial"))
	finalB64 := base64.StdEncoding.EncodeToString([]byte("final"))
	var requestBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"type\":\"image_generation.partial_image\",\"partial_image_index\":0,\"b64_json\":\"%s\"}\n", partialB64)
		fmt.Fprintf(w, "data: {\"type\":\"image_generation.completed\",\"b64_json\":\"%s\"}\n", finalB64)
	}))
	defer srv.Close()

	var partials []PartialImage
	res, err := RequestImagesAPIWithPartial(context.Background(), Options{
		APIKey:        "sk-test",
		Prompt:        "cat",
		BaseURL:       srv.URL,
		APIMode:       APIModeImages,
		PartialImages: 2,
	}, &bytes.Buffer{}, nil, func(partial PartialImage) {
		partials = append(partials, partial)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(requestBody), `"stream":true`) {
		t.Fatalf("request body missing stream=true: %s", requestBody)
	}
	if !strings.Contains(string(requestBody), `"partial_images":2`) {
		t.Fatalf("request body missing partial_images=2: %s", requestBody)
	}
	if res.ImageB64 != finalB64 || res.SourceEvent != "images_api" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if len(partials) != 1 || partials[0].ImageB64 != partialB64 || partials[0].PartialImageIndex != 0 {
		t.Fatalf("unexpected partials: %+v", partials)
	}
}

func TestImagesAPIWithRetriesRetriesFHLNoAvailableAccount(t *testing.T) {
	original := RetryBackoffSeconds
	RetryBackoffSeconds = 0
	t.Cleanup(func() { RetryBackoffSeconds = original })

	finalB64 := base64.StdEncoding.EncodeToString([]byte("final"))
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		if hits < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(w, `{"error":{"message":"闂佸搫鍟版慨纾嬨亹閺屻儲鍋ㄩ柕濞垮妼椤︹晠鏌涘▎蹇撴缂佽鲸绻勯幏鐘愁槹鎼存ɑ锛嗛梺鍛婅壘闁帮綁宕抽崫銉﹀珰?,"type":"upstream_error"}}`)
			return
		}
		fmt.Fprintf(w, `{"data":[{"b64_json":"%s","revised_prompt":"ok"}]}`, finalB64)
	}))
	defer srv.Close()

	res, _, err := RequestAndExtractWithRetries(
		context.Background(),
		&NativeTransport{},
		Options{
			APIKey:  "sk-test",
			Prompt:  "apple",
			BaseURL: srv.URL,
			APIMode: APIModeImages,
		},
		t.TempDir(),
		"20260602-200000",
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if hits != 3 {
		t.Fatalf("hits = %d, want 3", hits)
	}
	if res.ImageB64 != finalB64 || res.SourceEvent != "images_api" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRequestImagesAPINewAPICompatOmitsStreamingFields(t *testing.T) {
	finalB64 := base64.StdEncoding.EncodeToString([]byte("final"))
	var requestBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":"%s"}]}`, finalB64)
	}))
	defer srv.Close()

	res, err := RequestImagesAPIWithPartial(context.Background(), Options{
		APIKey:             "sk-test",
		Prompt:             "cat",
		BaseURL:            srv.URL,
		APIMode:            APIModeImages,
		ImageModelID:       "gpt-image-2",
		PartialImages:      2,
		ImagesNewAPICompat: true,
	}, &bytes.Buffer{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	body := string(requestBody)
	if !strings.Contains(body, `"response_format":"b64_json"`) {
		t.Fatalf("request body missing response_format=b64_json: %s", body)
	}
	if strings.Contains(body, `"stream"`) || strings.Contains(body, `"partial_images"`) {
		t.Fatalf("compat request should omit streaming fields: %s", body)
	}
	if res.ImageB64 != finalB64 || res.SourceEvent != "images_api" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRequestImagesAPIRejectsDeclaredOversizedResponse(t *testing.T) {
	for _, contentType := range []string{"application/json", "text/event-stream"} {
		t.Run(contentType, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", contentType)
				w.Header().Set("Content-Length", fmt.Sprintf("%d", maxHTTPResponseBytes+1))
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()

			_, err := RequestImagesAPIWithPartial(context.Background(), Options{
				APIKey:  "sk-test",
				Prompt:  "cat",
				BaseURL: srv.URL,
				APIMode: APIModeImages,
			}, io.Discard, nil, nil)
			if !errors.Is(err, ErrHTTPResponseTooLarge) {
				t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
			}
		})
	}
}

func TestBuildEditsMultipartSetsMaskMimeType(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.png")
	if err := os.WriteFile(src, fakePNG, 0o644); err != nil {
		t.Fatal(err)
	}

	buf, contentType, err := buildEditsMultipart(
		[]string{src},
		base64.StdEncoding.EncodeToString(fakePNG),
		"edit this",
		"gpt-image-2",
		"1024x1024",
		"auto",
		"png",
		"",
		0,
		RequestPolicyOpenAI,
		DefaultPartialImages,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}

	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(buf, params["boundary"])
	foundMask := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if part.FormName() == "mask" {
			foundMask = true
			if got := part.Header.Get("Content-Type"); got != "image/png" {
				t.Fatalf("mask content-type = %q, want image/png", got)
			}
		}
		_, _ = io.Copy(io.Discard, part)
	}
	if !foundMask {
		t.Fatal("expected mask part in multipart body")
	}
}

func TestBuildEditsMultipartOmitsMaskWhenEmpty(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.png")
	if err := os.WriteFile(src, fakePNG, 0o644); err != nil {
		t.Fatal(err)
	}

	buf, _, err := buildEditsMultipart(
		[]string{src},
		"",
		"edit this",
		"gpt-image-2",
		"1024x1024",
		"auto",
		"png",
		"",
		0,
		RequestPolicyOpenAI,
		DefaultPartialImages,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), `name="mask"`) {
		t.Fatal("multipart body should omit mask part when mask is empty")
	}
}

func TestBuildEditsMultipartNewAPICompatUsesPluginContract(t *testing.T) {
	dir := t.TempDir()
	mainPath := filepath.Join(dir, "main.webp")
	refPath := filepath.Join(dir, "ref.webp")
	if err := os.WriteFile(mainPath, fakePNG, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(refPath, fakePNG, 0o600); err != nil {
		t.Fatal(err)
	}

	buf, contentType, err := buildEditsMultipart(
		[]string{mainPath, refPath},
		"",
		"edit this",
		"gpt-image-2",
		"2048x1152",
		"auto",
		"png",
		"",
		0,
		RequestPolicyOpenAI,
		2,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}

	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(buf, params["boundary"])
	fields := map[string][]string{}
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			t.Fatal(nextErr)
		}
		value, readErr := io.ReadAll(part)
		if readErr != nil {
			t.Fatal(readErr)
		}
		fields[part.FormName()] = append(fields[part.FormName()], string(value))
	}

	if len(fields["image"]) != 1 || len(fields["image[]"]) != 1 {
		t.Fatalf("image fields = %#v, want one image and one image[]", fields)
	}
	if got := fields["quality"]; len(got) != 1 || got[0] != "auto" {
		t.Fatalf("quality = %#v, want auto", got)
	}
	if got := fields["response_format"]; len(got) != 1 || got[0] != "b64_json" {
		t.Fatalf("response_format = %#v, want b64_json", got)
	}
	if len(fields["stream"]) != 0 || len(fields["partial_images"]) != 0 {
		t.Fatalf("compat fields include stream/partial_images: %#v", fields)
	}
}

func TestParseImagesAPIResponseBytesFormats429Error(t *testing.T) {
	_, err := parseImagesAPIResponseBytes([]byte(`{"error":{"message":"Upstream rate limit exceeded, please retry later","type":"rate_limit_error"}}`), 429)
	if err == nil {
		t.Fatal("expected error")
	}
	want := "\u4e0a\u6e38\u8fd4\u56de 429:Upstream rate limit exceeded, please retry later"
	if err.Error() != want {
		t.Fatalf("err = %q, want %q", err.Error(), want)
	}
}
