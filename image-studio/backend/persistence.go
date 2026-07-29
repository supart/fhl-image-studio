package backend

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	publicRootEnvName   = "IMAGE_STUDIO_PUBLIC_ROOT"
	internalRootEnvName = "IMAGE_STUDIO_INTERNAL_ROOT"
	portableMarkerName  = ".fhl-studio-portable"
)

func portableFallbackDir() string {
	if root, ok := portablePackageRoot(); ok {
		return root
	}
	return filepath.Join(".", "fhl-studio-output")
}

func portablePackageRoot() (string, bool) {
	if root := cleanRootEnv(publicRootEnvName); root != "" {
		return root, true
	}
	if root, ok := executablePortableRoot(); ok {
		return root, true
	}
	return "", false
}

func cleanRootEnv(name string) string {
	root := strings.TrimSpace(os.Getenv(name))
	if root == "" {
		return ""
	}
	if abs, err := filepath.Abs(root); err == nil {
		return abs
	}
	return root
}

func executablePortableRoot() (string, bool) {
	exe, err := os.Executable()
	if err != nil {
		return "", false
	}
	dir, err := filepath.Abs(filepath.Dir(exe))
	if err != nil {
		return "", false
	}
	if fileExists(filepath.Join(dir, portableMarkerName)) {
		return dir, true
	}
	for _, name := range []string{"input", "output", "intermediate", "config"} {
		if dirExists(filepath.Join(dir, name)) {
			return dir, true
		}
	}
	return "", false
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func portableOutputDir(root string) string {
	return filepath.Join(root, "output")
}

func portableInputDir(root string) string {
	return filepath.Join(root, "input")
}

func portableIntermediateDir(root string) string {
	return filepath.Join(root, "intermediate")
}

func documentsDataRoot() (string, error) {
	docs, err := defaultDocumentsDir()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(docs, appDocumentDirName), nil
}

func configDataRoot() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(cfg, appConfigDirName), nil
}

// defaultOutputDir returns the output root, without the images/log subdirs.
//
// Windows stores generated artifacts under the user's Documents folder. The
// WebView2 profile is anchored to the same root, so renaming the executable
// does not move IndexedDB/localStorage-backed history.
func defaultOutputDir() (string, error) {
	if root, ok := portablePackageRoot(); ok {
		return portableOutputDir(root), nil
	}
	return platformDefaultOutputDir()
}

// importsDir holds dropped/pasted source files plus rotate/flip/crop
// derivatives. It intentionally shares the stable app data root with history.
func importsDir() (string, error) {
	if root, ok := portablePackageRoot(); ok {
		return portableInputDir(root), nil
	}
	root, err := platformStableDataRoot()
	if err != nil {
		return filepath.Join(portableFallbackDir(), "imports"), nil
	}
	return filepath.Join(root, "imports"), nil
}
