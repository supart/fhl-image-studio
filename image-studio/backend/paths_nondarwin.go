//go:build !darwin

package backend

import "path/filepath"

func platformLogSubdir(outputRoot string) string {
	return filepath.Join(outputRoot, "log")
}
