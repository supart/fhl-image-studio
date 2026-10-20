//go:build darwin

package backend

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHeaderPromotionHandlerPrefersPortableThenFallsBackToBundle(t *testing.T) {
	portableRoot := t.TempDir()
	t.Setenv(publicRootEnvName, portableRoot)

	bundleRoot := filepath.Join(t.TempDir(), "FHL Studio.app")
	executable := filepath.Join(bundleRoot, "Contents", "MacOS", "FHL Studio")
	resources := filepath.Join(bundleRoot, "Contents", "Resources")
	if err := os.MkdirAll(filepath.Dir(executable), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(resources, secureDirMode); err != nil {
		t.Fatal(err)
	}

	portableBody := []byte("群公告=portable\n")
	bundleBody := []byte("群公告=bundle\n")
	portableFile := filepath.Join(portableRoot, headerPromotionFileName)
	bundleFile := filepath.Join(resources, headerPromotionFileName)
	if err := os.WriteFile(portableFile, portableBody, secureFileMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bundleFile, bundleBody, secureFileMode); err != nil {
		t.Fatal(err)
	}

	request := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		serveHeaderPromotionWithExecutable(
			recorder,
			httptest.NewRequest(http.MethodGet, headerPromotionPath, nil),
			func() (string, error) { return executable, nil },
		)
		return recorder
	}

	if recorder := request(); recorder.Code != http.StatusOK || recorder.Body.String() != string(portableBody) {
		t.Fatalf("portable response = (%d, %q), want (200, %q)", recorder.Code, recorder.Body.String(), portableBody)
	}
	if err := os.Remove(portableFile); err != nil {
		t.Fatal(err)
	}
	if recorder := request(); recorder.Code != http.StatusOK || recorder.Body.String() != string(bundleBody) {
		t.Fatalf("bundle response = (%d, %q), want (200, %q)", recorder.Code, recorder.Body.String(), bundleBody)
	}
	if err := os.Remove(bundleFile); err != nil {
		t.Fatal(err)
	}
	if recorder := request(); recorder.Code != http.StatusNoContent {
		t.Fatalf("missing response status = %d, want 204", recorder.Code)
	}
}

func TestMacOSBundleHeaderPromotionFileRequiresAppBundleLayout(t *testing.T) {
	bundle := filepath.Join(t.TempDir(), "FHL Studio.app")
	want := filepath.Join(bundle, "Contents", "Resources", headerPromotionFileName)
	got, ok := macOSBundleHeaderPromotionFile(filepath.Join(bundle, "Contents", "MacOS", "FHL Studio"))
	if !ok || got != want {
		t.Fatalf("bundle promotion file = (%q, %v), want (%q, true)", got, ok, want)
	}

	for _, executable := range []string{
		filepath.Join(t.TempDir(), "FHL Studio"),
		filepath.Join(t.TempDir(), "FHL Studio", "Contents", "bin", "FHL Studio"),
		filepath.Join(t.TempDir(), "FHL Studio", "Contents", "MacOS", "FHL Studio"),
	} {
		if got, ok := macOSBundleHeaderPromotionFile(executable); ok {
			t.Fatalf("unexpected bundle promotion file %q for %q", got, executable)
		}
	}
}
