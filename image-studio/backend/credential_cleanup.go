package backend

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ClearLocalCredentialFiles removes local files that may contain an API key.
// Missing files are already clean and therefore not an error.
func (s *Service) ClearLocalCredentialFiles() error {
	s.ClearPSBridgeProfile()
	var cleanupErrors []error
	cliPath, err := cliConfigFilePath()
	if err != nil {
		cleanupErrors = append(cleanupErrors, err)
	}
	targets := []string{cliPath}
	if root, ok := portablePackageRoot(); ok {
		targets = append(targets,
			filepath.Join(root, "image-studio", "frontend", ".local", "fhl-api.local.json"),
		)
	}
	for _, target := range targets {
		if strings.TrimSpace(target) == "" {
			continue
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	return errors.Join(cleanupErrors...)
}
