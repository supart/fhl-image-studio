package client

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"
)

// NativeTransport uses net/http to issue the request and streams the body
// line-by-line through a custom SSE scanner.
type NativeTransport struct {
	// Client is optional; if nil a sensible default is used.
	Client *http.Client
	Proxy  ProxyConfig
}

func (t *NativeTransport) Stream(ctx context.Context, req Request, rawSink io.Writer, progress chan<- string) error {
	httpReq, err := http.NewRequestWithContext(ctx, "POST", req.URL, bytes.NewReader(req.Payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	httpReq.Header.Set("User-Agent", UserAgent())

	cli := t.Client
	if cli == nil {
		transport, err := NewHTTPTransport(t.Proxy)
		if err != nil {
			return err
		}
		transport.DisableCompression = true
		transport.MaxIdleConnsPerHost = 2
		transport.ResponseHeaderTimeout = 60 * time.Second
		cli = &http.Client{
			// No global timeout: SSE streams legitimately take minutes.
			// Cancellation is via ctx.
			Transport: transport,
		}
	}

	resp, err := cli.Do(httpReq)
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()
	if err := enforceHTTPResponseLimit(resp); err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	const bodyIdleTimeout = 120 * time.Second
	var idleTimedOut atomic.Bool
	idleTimer := time.AfterFunc(bodyIdleTimeout, func() {
		idleTimedOut.Store(true)
		_ = resp.Body.Close()
	})
	defer idleTimer.Stop()

	scanner := NewSSEScanner(resp.Body)
	for scanner.Scan() {
		idleTimer.Reset(bodyIdleTimeout)
		line := scanner.Bytes()
		if sink, ok := rawSink.(interface{ writeSSELine([]byte) error }); ok {
			if err := sink.writeSSELine(line); err != nil {
				return fmt.Errorf("write raw: %w", err)
			}
		} else {
			if _, err := rawSink.Write(line); err != nil {
				return fmt.Errorf("write raw: %w", err)
			}
			if _, err := rawSink.Write([]byte("\n")); err != nil {
				return fmt.Errorf("write raw: %w", err)
			}
		}
		if progress != nil && len(line) <= fallbackResponseCap {
			if summary := SummarizeSSELine(string(line)); summary != "" {
				select {
				case progress <- summary:
				default:
					// Drop status updates if consumer is slow; never block streaming.
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		err = normalizeSSEScannerError(err)
		if idleTimedOut.Load() {
			return fmt.Errorf("read response idle timeout after %s", bodyIdleTimeout)
		}
		return fmt.Errorf("read response: %w", err)
	}
	if idleTimedOut.Load() {
		return fmt.Errorf("read response idle timeout after %s", bodyIdleTimeout)
	}
	// If the response code wasn't 2xx and body was empty/non-SSE, surface it.
	if resp.StatusCode >= 400 {
		// We've already streamed whatever body came through; signal upstream failure.
		return fmt.Errorf("upstream HTTP %d", resp.StatusCode)
	}
	return nil
}
