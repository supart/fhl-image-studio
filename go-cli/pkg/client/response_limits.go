package client

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const (
	maxSSELineBytes               = 128 << 20
	maxHTTPResponseBytes    int64 = 256 << 20
	diagnosticResponseBytes int64 = 1 << 20
	maxBase64Preallocate          = 4 << 20
)

// ErrSSELineTooLarge identifies an SSE line that exceeds maxSSELineBytes.
var ErrSSELineTooLarge = errors.New("SSE line exceeds configured limit")

// ErrHTTPResponseTooLarge identifies a response body that exceeds maxHTTPResponseBytes.
var ErrHTTPResponseTooLarge = errors.New("HTTP response exceeds configured limit")

type limitedResponseBody struct {
	body      io.ReadCloser
	limit     int64
	remaining int64
	exceeded  bool
}

func (r *limitedResponseBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.exceeded {
		return 0, responseTooLargeError(r.limit)
	}
	if r.remaining == 0 {
		var probe [1]byte
		n, err := r.body.Read(probe[:])
		if n > 0 {
			r.exceeded = true
			return 0, responseTooLargeError(r.limit)
		}
		return 0, err
	}

	readSize := int64(len(p))
	if readSize > r.remaining+1 {
		readSize = r.remaining + 1
	}
	n, err := r.body.Read(p[:int(readSize)])
	if int64(n) > r.remaining {
		allowed := int(r.remaining)
		r.remaining = 0
		r.exceeded = true
		return allowed, responseTooLargeError(r.limit)
	}
	r.remaining -= int64(n)
	return n, err
}

func (r *limitedResponseBody) Close() error {
	return r.body.Close()
}

func enforceHTTPResponseLimit(response *http.Response) error {
	return enforceHTTPResponseLimitBytes(response, maxHTTPResponseBytes)
}

func enforceHTTPResponseLimitBytes(response *http.Response, limit int64) error {
	if response == nil || response.Body == nil {
		return nil
	}
	if response.ContentLength > limit {
		return responseTooLargeError(limit)
	}
	response.Body = &limitedResponseBody{
		body:      response.Body,
		limit:     limit,
		remaining: limit,
	}
	return nil
}

func readHTTPResponseBody(response *http.Response) ([]byte, error) {
	return readHTTPResponseBodyLimited(response, maxHTTPResponseBytes)
}

func readHTTPResponseBodyLimited(response *http.Response, limit int64) ([]byte, error) {
	if err := enforceHTTPResponseLimitBytes(response, limit); err != nil {
		return nil, err
	}
	return io.ReadAll(response.Body)
}

func readHTTPResponseBase64(response *http.Response) (string, error) {
	return readHTTPResponseBase64Limited(response, maxHTTPResponseBytes)
}

func readHTTPResponseBase64Limited(response *http.Response, limit int64) (string, error) {
	if err := enforceHTTPResponseLimitBytes(response, limit); err != nil {
		return "", err
	}
	var encoded strings.Builder
	if response.ContentLength > 0 {
		grow := base64.StdEncoding.EncodedLen(int(response.ContentLength))
		if grow > maxBase64Preallocate {
			grow = maxBase64Preallocate
		}
		encoded.Grow(grow)
	}
	encoder := base64.NewEncoder(base64.StdEncoding, &encoded)
	_, copyErr := io.Copy(encoder, response.Body)
	closeErr := encoder.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return encoded.String(), nil
}

func responseTooLargeError(limit int64) error {
	return fmt.Errorf("%w: limit is %d bytes", ErrHTTPResponseTooLarge, limit)
}

func sseLineTooLargeError(limit int) error {
	return fmt.Errorf("%w: limit is %d bytes", ErrSSELineTooLarge, limit)
}

func isResponseLimitError(err error) bool {
	return errors.Is(err, ErrHTTPResponseTooLarge) || errors.Is(err, ErrSSELineTooLarge)
}

func readDiagnosticResponseFile(path string) string {
	return readDiagnosticResponseFileWindow(path, diagnosticResponseBytes)
}

func readDiagnosticResponseFileWindow(path string, maxBytes int64) string {
	if maxBytes <= 0 {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.Size() <= maxBytes {
		data, _ := io.ReadAll(io.LimitReader(f, maxBytes))
		return string(data)
	}

	headBytes := maxBytes / 2
	tailBytes := maxBytes - headBytes
	head, _ := io.ReadAll(io.LimitReader(f, headBytes))
	if _, err := f.Seek(-tailBytes, io.SeekEnd); err != nil {
		return string(head)
	}
	tail, _ := io.ReadAll(io.LimitReader(f, tailBytes))
	return string(head) + "\n...[diagnostic response truncated]...\n" + string(tail)
}
