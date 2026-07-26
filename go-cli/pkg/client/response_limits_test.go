package client

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type closeTrackingBody struct {
	io.Reader
	closed bool
}

func (b *closeTrackingBody) Close() error {
	b.closed = true
	return nil
}

func TestReadHTTPResponseBodyLimited(t *testing.T) {
	t.Run("exact limit", func(t *testing.T) {
		response := &http.Response{
			ContentLength: -1,
			Body:          io.NopCloser(strings.NewReader("1234")),
		}
		got, err := readHTTPResponseBodyLimited(response, 4)
		if err != nil {
			t.Fatalf("read exact limit: %v", err)
		}
		if string(got) != "1234" {
			t.Fatalf("body = %q, want 1234", got)
		}
	})

	t.Run("stream exceeds limit", func(t *testing.T) {
		response := &http.Response{
			ContentLength: -1,
			Body:          io.NopCloser(strings.NewReader("12345")),
		}
		got, err := readHTTPResponseBodyLimited(response, 4)
		if !errors.Is(err, ErrHTTPResponseTooLarge) {
			t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
		}
		if string(got) != "1234" {
			t.Fatalf("body = %q, want capped prefix", got)
		}
	})

	t.Run("declared length exceeds limit", func(t *testing.T) {
		response := &http.Response{
			ContentLength: 5,
			Body:          io.NopCloser(strings.NewReader("x")),
		}
		_, err := readHTTPResponseBodyLimited(response, 4)
		if !errors.Is(err, ErrHTTPResponseTooLarge) {
			t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
		}
	})
}

func TestHTTPResponseLimitPreservesClose(t *testing.T) {
	body := &closeTrackingBody{Reader: strings.NewReader("ok")}
	response := &http.Response{ContentLength: -1, Body: body}
	if err := enforceHTTPResponseLimitBytes(response, 4); err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if !body.closed {
		t.Fatal("limited response body did not close the underlying body")
	}
}

func TestReadHTTPResponseBase64Limited(t *testing.T) {
	response := &http.Response{
		ContentLength: -1,
		Body:          io.NopCloser(strings.NewReader("abc")),
	}
	got, err := readHTTPResponseBase64Limited(response, 3)
	if err != nil {
		t.Fatalf("encode exact-limit response: %v", err)
	}
	if got != "YWJj" {
		t.Fatalf("encoded body = %q, want YWJj", got)
	}

	response = &http.Response{
		ContentLength: -1,
		Body:          io.NopCloser(strings.NewReader("abcd")),
	}
	if _, err := readHTTPResponseBase64Limited(response, 3); !errors.Is(err, ErrHTTPResponseTooLarge) {
		t.Fatalf("over-limit base64 err = %v", err)
	}
}

func TestReadDiagnosticResponseFileWindowKeepsHeadAndTail(t *testing.T) {
	path := filepath.Join(t.TempDir(), "response.txt")
	if err := os.WriteFile(path, []byte("0123456789ABCDEFGHIJ"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := readDiagnosticResponseFileWindow(path, 10)
	if !strings.HasPrefix(got, "01234") || !strings.HasSuffix(got, "FGHIJ") {
		t.Fatalf("diagnostic window = %q, want head and tail", got)
	}
	if !strings.Contains(got, "truncated") {
		t.Fatalf("diagnostic window missing truncation marker: %q", got)
	}
}

func TestReadDiagnosticResponseFileWindowKeepsSmallFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "response.txt")
	if err := os.WriteFile(path, []byte("small"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readDiagnosticResponseFileWindow(path, 10); got != "small" {
		t.Fatalf("diagnostic window = %q, want small", got)
	}
}
