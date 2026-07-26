package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const probeUpstreamTimeout = 20 * time.Second
const probeUpstreamMaxBody = 1 << 20

type modelsListProbeResponse struct {
	Data []json.RawMessage `json:"data"`
}

func (s *Service) ProbeUpstream(opts ProbeUpstreamOptions) (ProbeUpstreamResult, error) {
	parent, finishOperation, err := s.beginOperation(true)
	if err != nil {
		return ProbeUpstreamResult{}, err
	}
	defer finishOperation()
	releaseNetwork, err := s.jobManager.acquireNetwork(parent)
	if err != nil {
		return ProbeUpstreamResult{}, err
	}
	defer releaseNetwork()
	return probeUpstream(parent, opts)
}

func probeUpstream(parent context.Context, opts ProbeUpstreamOptions) (ProbeUpstreamResult, error) {
	apiKey := strings.TrimSpace(opts.APIKey)
	if apiKey == "" {
		return ProbeUpstreamResult{}, fmt.Errorf("API Key 不能为空")
	}
	baseURL, err := client.ValidateBaseURL(opts.BaseURL)
	if err != nil {
		return ProbeUpstreamResult{}, err
	}
	ctx, cancel := context.WithTimeout(parent, probeUpstreamTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v1/models", nil)
	if err != nil {
		return ProbeUpstreamResult{}, fmt.Errorf("构造测活请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", client.UserAgent())

	transport, err := client.NewHTTPTransport(client.ProxyConfig{Mode: opts.ProxyMode, URL: opts.ProxyURL})
	if err != nil {
		return ProbeUpstreamResult{}, err
	}
	httpClient := &http.Client{Timeout: probeUpstreamTimeout, Transport: transport}
	resp, err := httpClient.Do(req)
	if err != nil {
		return ProbeUpstreamResult{}, fmt.Errorf("连接上游失败: %w", err)
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, probeUpstreamMaxBody))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		summary := summarizeProbeBody(body)
		if summary == "" && readErr != nil {
			summary = readErr.Error()
		}
		if summary != "" {
			return ProbeUpstreamResult{}, fmt.Errorf("上游 /v1/models 返回 %d: %s", resp.StatusCode, summary)
		}
		return ProbeUpstreamResult{}, fmt.Errorf("上游 /v1/models 返回 %d", resp.StatusCode)
	}
	if readErr != nil {
		return ProbeUpstreamResult{}, fmt.Errorf("读取上游响应失败: %w", readErr)
	}

	var parsed modelsListProbeResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ProbeUpstreamResult{}, fmt.Errorf("上游 /v1/models 返回的 JSON 无效: %w", err)
	}
	if parsed.Data == nil {
		return ProbeUpstreamResult{}, fmt.Errorf("上游 /v1/models 响应缺少 data 数组")
	}
	return ProbeUpstreamResult{ModelCount: len(parsed.Data)}, nil
}

func summarizeProbeBody(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}
	var parsed struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil {
		if msg := strings.TrimSpace(parsed.Error.Message); msg != "" {
			text = msg
		} else if msg := strings.TrimSpace(parsed.Message); msg != "" {
			text = msg
		}
	}
	if len(text) > 160 {
		return text[:160]
	}
	return text
}
