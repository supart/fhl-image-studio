//go:build darwin

package backend

import (
	"os"
	"path/filepath"
)

func platformLogSubdir(outputRoot string) string {
	if packageRoot, ok := portablePackageRoot(); ok && sameCleanPath(outputRoot, portableOutputDir(packageRoot)) {
		return filepath.Join(outputRoot, "log")
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
	leftResolved, leftErr := resolvePathWithExistingAncestor(left)
	rightResolved, rightErr := resolvePathWithExistingAncestor(right)
	if leftErr == nil && rightErr == nil {
		return leftResolved == rightResolved
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
