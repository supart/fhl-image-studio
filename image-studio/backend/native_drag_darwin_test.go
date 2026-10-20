//go:build darwin

package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateNativeDragFileRequiresExistingRegularFile(t *testing.T) {
	root := t.TempDir()
	regular := filepath.Join(root, "image.png")
	if err := os.WriteFile(regular, []byte("png"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if got, err := validateNativeDragFile(regular); err != nil || got == "" {
		t.Fatalf("regular file validation = %q, %v", got, err)
	}
	if _, err := validateNativeDragFile(filepath.Join(root, "missing.png")); err == nil {
		t.Fatal("expected missing drag file to be rejected")
	}
	if _, err := validateNativeDragFile(root); err == nil {
		t.Fatal("expected drag directory to be rejected")
	}
}

func TestValidateNativeDragFileResolvesFileSymlink(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.png")
	if err := os.WriteFile(target, []byte("png"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link.png")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	got, err := validateNativeDragFile(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("validateNativeDragFile() = %q, want %q", got, want)
	}
}
