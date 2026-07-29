package client

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsRetryableCloudflare524(t *testing.T) {
	html, err := os.ReadFile(filepath.Join("..", "..", "testdata", "cloudflare_524.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !IsRetryable(string(html)) {
		t.Errorf("Cloudflare 524 HTML should be retryable")
	}
	if !strings.Contains(DescribeProblem(string(html)), "Cloudflare 524") {
		t.Errorf("DescribeProblem missing Cloudflare 524 marker: %q", DescribeProblem(string(html)))
	}
}

func TestIsRetryableJSON504(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "testdata", "json_504.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !IsRetryable(string(body)) {
		t.Errorf("JSON 504 body should be retryable")
	}
	if !strings.Contains(DescribeProblem(string(body)), "504") {
		t.Errorf("DescribeProblem missing 504 marker: %q", DescribeProblem(string(body)))
	}
}

func TestIsRetryableNestedRateLimit(t *testing.T) {
	raw := `event: response.image_generation_call.generating
data: {"type":"response.image_generation_call.generating"}

{"error":{"code":null,"message":"{\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Rate limit reached for gpt-image-2-codex\"},\"type\":\"error\"}","type":"invalid_request_error"}}`
	if !IsRetryable(raw) {
		t.Errorf("nested rate limit body should be retryable")
	}
}

func TestIsRetryableFalseForUnsupportedMask(t *testing.T) {
	raw := `event: upstream_error
data: {"error":{"type":"invalid_request_error","message":"mask is not supported by free gpt-image edits","code":"ERR-TEST"}}`
	if IsRetryable(raw) {
		t.Fatal("unsupported mask is a non-retryable request capability error")
	}
}

func TestIsRetryableFalseForSuccess(t *testing.T) {
	if IsRetryable(`{"status":200,"output":[]}`) {
		t.Errorf("200 success should not be retryable")
	}
}

func TestDescribeProblemEmpty(t *testing.T) {
	if DescribeProblem("") != "接口返回为空。" {
		t.Errorf("empty body description wrong")
	}
}
