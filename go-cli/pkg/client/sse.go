package client

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"strings"
)

// Event is one decoded SSE JSON object (the part after `data: `).
type Event map[string]any

func decodeEvent(payload string, ev *Event) error {
	return decodeEventBytes([]byte(payload), ev)
}

func decodeEventBytes(payload []byte, ev *Event) error {
	return json.Unmarshal(payload, ev)
}

// IterEvents returns an iterator over decoded SSE events in raw.
// Lines that don't start with `data: `, or that hold `[DONE]`/empty, are skipped.
// Malformed JSON is silently ignored (parity with Python iter_sse_events).
func IterEvents(raw string) iter.Seq[Event] {
	return func(yield func(Event) bool) {
		for line := range strings.SplitSeq(raw, "\n") {
			line = strings.TrimRight(line, "\r")
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			payload := strings.TrimSpace(line[6:])
			if payload == "" || payload == "[DONE]" {
				continue
			}
			var ev Event
			if err := decodeEvent(payload, &ev); err != nil {
				continue
			}
			if !yield(ev) {
				return
			}
		}
	}
}

// ExtractImageResult parses raw SSE text and returns the image base64.
// Priority:
//  1. response.output_item.done with item.type == image_generation_call and item.result
//  2. last partial_image_b64 seen (fallback)
//  3. JSON walk of the entire body (non-SSE responses)
//
// Returns ErrNoImageInResponse if nothing matches.
func ExtractImageResult(raw string) (ImageResult, error) {
	var partialB64, partialPrompt string

	for ev := range IterEvents(raw) {
		evType, _ := ev["type"].(string)

		if evType == "response.image_generation_call.partial_image" {
			if v, ok := ev["partial_image_b64"].(string); ok && v != "" {
				partialB64 = v
			}
			if v, ok := ev["revised_prompt"].(string); ok && v != "" {
				partialPrompt = v
			}
			continue
		}

		if evType != "response.output_item.done" {
			if res, ok := imageResultFromEvent(ev, "final"); ok {
				return res, nil
			}
			continue
		}
		if res, ok := imageResultFromEvent(ev, "final"); ok {
			return res, nil
		}
	}

	if r, ok := findImageResultInJSON(raw); ok {
		return r, nil
	}

	if partialB64 != "" {
		return ImageResult{
			ImageB64:      partialB64,
			RevisedPrompt: partialPrompt,
			SourceEvent:   "partial",
		}, nil
	}

	return ImageResult{}, ErrNoImageInResponse
}

func findImageResultInJSON(raw string) (ImageResult, bool) {
	return findImageResultInJSONBytes([]byte(raw))
}

func findImageResultInJSONBytes(raw []byte) (ImageResult, bool) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return ImageResult{}, false
	}
	if found, ok := walkForImageCall(v); ok {
		return imageResultFromImageCall(found, "json")
	}
	return ImageResult{}, false
}

func imageResultFromEvent(ev Event, sourceEvent string) (ImageResult, bool) {
	if found, ok := walkForImageCall(ev); ok {
		return imageResultFromImageCall(found, sourceEvent)
	}
	return ImageResult{}, false
}

func imageResultFromImageCall(found map[string]any, sourceEvent string) (ImageResult, bool) {
	result, _ := found["result"].(string)
	revised, _ := found["revised_prompt"].(string)
	if result == "" {
		return ImageResult{}, false
	}
	return ImageResult{
		ImageB64:      result,
		RevisedPrompt: revised,
		SourceEvent:   sourceEvent,
	}, true
}

func walkForImageCall(v any) (map[string]any, bool) {
	switch x := v.(type) {
	case Event:
		return walkForImageCall(map[string]any(x))
	case map[string]any:
		if t, _ := x["type"].(string); t == "image_generation_call" {
			if r, _ := x["result"].(string); r != "" {
				return x, true
			}
		}
		for _, child := range x {
			if found, ok := walkForImageCall(child); ok {
				return found, true
			}
		}
	case []any:
		for _, child := range x {
			if found, ok := walkForImageCall(child); ok {
				return found, true
			}
		}
	}
	return nil, false
}

// SummarizeSSELine turns one raw SSE line into a Chinese status string, or "" if not noteworthy.
// Mirrors Python summarize_sse_line.
func SummarizeSSELine(line string) string {
	stripped := strings.TrimSpace(line)
	if stripped == "" {
		return ""
	}
	if strings.HasPrefix(stripped, ":") {
		return "收到接口保活信号"
	}
	if !strings.HasPrefix(stripped, "data: ") {
		return ""
	}
	payload := strings.TrimSpace(stripped[6:])
	var ev Event
	if err := decodeEvent(payload, &ev); err != nil {
		return ""
	}
	evType, _ := ev["type"].(string)
	switch evType {
	case "response.created":
		return "请求已创建"
	case "response.in_progress":
		return "模型处理中"
	case "response.image_generation_call.in_progress":
		return "图片工具已启动"
	case "response.image_generation_call.generating":
		return "图片正在生成"
	case "response.image_generation_call.partial_image":
		return "已收到图片数据片段"
	case "response.output_item.done":
		item, _ := ev["item"].(map[string]any)
		if t, _ := item["type"].(string); t == "image_generation_call" {
			if r, _ := item["result"].(string); r != "" {
				return "图片生成完成,正在保存"
			}
			status, _ := item["status"].(string)
			if status == "" {
				status = "未知"
			}
			return fmt.Sprintf("图片工具状态:%s", status)
		}
	case "response.completed":
		return "接口已完成"
	}
	if evType != "" {
		return fmt.Sprintf("接口事件:%s", evType)
	}
	return ""
}

// NewSSEScanner returns a bufio.Scanner configured for lines up to 128 MiB.
// Default token size is 64KB which truncates partial_image_b64 at 2048x1152 sizes.
func NewSSEScanner(r io.Reader) *bufio.Scanner {
	return newSSEScannerWithLimit(r, maxSSELineBytes)
}

func newSSEScannerWithLimit(r io.Reader, maxLineBytes int) *bufio.Scanner {
	scanner := bufio.NewScanner(r)
	initial := 2 << 20
	maxBufferBytes := maxLineBytes + 2 // Allow CRLF outside the line-size limit.
	if initial > maxBufferBytes {
		initial = maxBufferBytes
	}
	scanner.Buffer(make([]byte, 0, initial), maxBufferBytes)
	scanner.Split(scanSSELines(maxLineBytes))
	return scanner
}

func scanSSELines(maxLineBytes int) bufio.SplitFunc {
	return func(data []byte, atEOF bool) (advance int, token []byte, err error) {
		if atEOF && len(data) == 0 {
			return 0, nil, nil
		}
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			line := dropTrailingCR(data[:i])
			if len(line) > maxLineBytes {
				return 0, nil, sseLineTooLargeError(maxLineBytes)
			}
			return i + 1, line, nil
		}
		if atEOF {
			line := dropTrailingCR(data)
			if len(line) > maxLineBytes {
				return 0, nil, sseLineTooLargeError(maxLineBytes)
			}
			return len(data), line, nil
		}
		if len(data) > maxLineBytes && (len(data) != maxLineBytes+1 || data[len(data)-1] != '\r') {
			return 0, nil, sseLineTooLargeError(maxLineBytes)
		}
		return 0, nil, nil
	}
}

func dropTrailingCR(data []byte) []byte {
	if len(data) > 0 && data[len(data)-1] == '\r' {
		return data[:len(data)-1]
	}
	return data
}

func normalizeSSEScannerError(err error) error {
	if errors.Is(err, bufio.ErrTooLong) {
		return sseLineTooLargeError(maxSSELineBytes)
	}
	return err
}
