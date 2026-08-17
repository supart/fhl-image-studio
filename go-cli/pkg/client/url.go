package client

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ValidateBaseURL normalizes and validates the relay base URL.
// HTTPS is required for non-loopback hosts because prompts, images, and API
// keys are all sent over this connection.
func ValidateBaseURL(raw string) (string, error) {
	cleaned := strings.TrimRight(strings.TrimSpace(raw), "/")
	if cleaned == "" {
		return "", fmt.Errorf("未配置上游 BASE_URL")
	}
	u, err := url.Parse(cleaned)
	if err != nil {
		return "", fmt.Errorf("BASE_URL 无效: %w", err)
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("BASE_URL 必须包含协议和主机,例如 https://example.com")
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return cleaned, nil
	case "http":
		if isLoopbackHost(u.Hostname()) {
			return cleaned, nil
		}
		return "", fmt.Errorf("拒绝使用非 TLS 上游: %s。只有 localhost / 127.0.0.1 / ::1 允许 http://", cleaned)
	default:
		return "", fmt.Errorf("BASE_URL 仅支持 http:// 或 https://")
	}
}

func normalizeOpenAIAPIBaseURL(raw string) string {
	cleaned := strings.TrimRight(strings.TrimSpace(raw), "/")
	for strings.HasSuffix(strings.ToLower(cleaned), "/v1") {
		cleaned = strings.TrimRight(cleaned[:len(cleaned)-3], "/")
	}
	return cleaned
}

func openAIAPIEndpoint(baseURL string, path string) string {
	root := normalizeOpenAIAPIBaseURL(baseURL)
	if strings.HasPrefix(path, "/") {
		return root + path
	}
	return root + "/" + path
}

func isLoopbackHost(host string) bool {
	if host == "" {
		return false
	}
	lower := strings.ToLower(host)
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
