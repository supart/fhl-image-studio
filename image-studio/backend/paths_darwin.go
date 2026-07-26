//go:build darwin

package backend

import (
	"os"
	"path/filepath"
)

func platformLogSubdir(outputRoot string) string {
	if packageRoot, ok := portablePackageRoot(); ok {
		if sameCleanPath(outputRoot, portableOutputDir(packageRoot)) {
			return filepath.Join(outputRoot, "log")
		}
	}
	defaultRoot, err := platformDefaultOutputDir()
	if err == nil && sameCleanPath(outputRoot, defaultRoot) {
		home, homeErr := os.UserHomeDir()
		if homeErr == nil {
			return filepath.Join(home, "Library", "Logs", appDocumentDirName)
		}
	}
	return filepath.Join(outputRoot, "log")
}

func sameCleanPath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil && rightErr == nil {
		return filepath.Clean(leftAbs) == filepath.Clean(rightAbs)
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
