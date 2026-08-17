package backend

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func headerPromotionTestHandler() http.Handler {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	return NewService().MediaHandler(next)
}

func TestHeaderPromotionHandlerServesFixedPortableRootFile(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	want := "群公告=测试公告\n群号=123456\n"
	if err := os.WriteFile(filepath.Join(root, headerPromotionFileName), []byte(want), secureFileMode); err != nil {
		t.Fatal(err)
	}
	handler := headerPromotionTestHandler()

	for _, method := range []string{http.MethodGet, http.MethodHead} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(method, headerPromotionPath, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200", method, recorder.Code)
		}
		if got := recorder.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
			t.Fatalf("content-type = %q", got)
		}
		if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("cache-control = %q", got)
		}
		if method == http.MethodGet && recorder.Body.String() != want {
			t.Fatalf("GET body = %q, want %q", recorder.Body.String(), want)
		}
		if method == http.MethodHead && recorder.Body.Len() != 0 {
			t.Fatalf("HEAD body length = %d, want 0", recorder.Body.Len())
		}
	}
}

func TestHeaderPromotionHandlerMissingEmptyOversizedAndMethods(t *testing.T) {
	root := t.TempDir()
	t.Setenv(publicRootEnvName, root)
	handler := headerPromotionTestHandler()
	request := func(method string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(method, headerPromotionPath, nil))
		return recorder
	}

	if got := request(http.MethodGet).Code; got != http.StatusNoContent {
		t.Fatalf("missing status = %d, want 204", got)
	}
	file := filepath.Join(root, headerPromotionFileName)
	if err := os.WriteFile(file, nil, secureFileMode); err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodGet).Code; got != http.StatusOK {
		t.Fatalf("empty status = %d, want 200", got)
	}
	if err := os.WriteFile(file, []byte(strings.Repeat("x", headerPromotionMaxBytes+1)), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodGet).Code; got != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d, want 413", got)
	}
	if got := request(http.MethodPost).Code; got != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", got)
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, headerPromotionPath+"/other", nil))
	if recorder.Code != http.StatusTeapot {
		t.Fatalf("unrelated route status = %d, want next handler status", recorder.Code)
	}
}
