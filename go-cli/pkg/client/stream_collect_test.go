package client

import (
	"encoding/base64"
	"errors"
	"testing"
)

func TestResponseCollectorExtractsFinalAndPartial(t *testing.T) {
	t.Parallel()

	pngB64 := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))

	t.Run("final", func(t *testing.T) {
		c := newResponseCollector(nil)
		_, err := c.Write([]byte("data: {\"type\":\"response.created\"}\n"))
		if err != nil {
			t.Fatal(err)
		}
		_, err = c.Write([]byte("data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"result\":\"" + pngB64 + "\"}}\n"))
		if err != nil {
			t.Fatal(err)
		}
		got, err := c.result()
		if err != nil {
			t.Fatalf("collector result: %v", err)
		}
		if got.ImageB64 != pngB64 || got.SourceEvent != "final" {
			t.Fatalf("unexpected final result: %+v", got)
		}
	})

	t.Run("completed event final", func(t *testing.T) {
		c := newResponseCollector(nil)
		_, err := c.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"image_generation_call\",\"result\":\"" + pngB64 + "\",\"revised_prompt\":\"completed rev\"}]}}\n"))
		if err != nil {
			t.Fatal(err)
		}
		got, err := c.result()
		if err != nil {
			t.Fatalf("collector result: %v", err)
		}
		if got.ImageB64 != pngB64 || got.SourceEvent != "final" || got.RevisedPrompt != "completed rev" {
			t.Fatalf("unexpected completed result: %+v", got)
		}
	})

	t.Run("partial fallback", func(t *testing.T) {
		c := newResponseCollector(nil)
		_, err := c.Write([]byte("data: {\"type\":\"response.image_generation_call.partial_image\",\"partial_image_b64\":\"" + pngB64 + "\"}\n"))
		if err != nil {
			t.Fatal(err)
		}
		got, err := c.result()
		if err != nil {
			t.Fatalf("collector result: %v", err)
		}
		if got.ImageB64 != pngB64 || got.SourceEvent != "partial" {
			t.Fatalf("unexpected partial result: %+v", got)
		}
	})

	t.Run("partial callback", func(t *testing.T) {
		var seen []PartialImage
		c := newResponseCollectorWithPartial(nil, func(partial PartialImage) {
			seen = append(seen, partial)
		})
		_, err := c.Write([]byte("data: {\"type\":\"response.image_generation_call.partial_image\",\"partial_image_index\":2,\"partial_image_b64\":\"" + pngB64 + "\",\"revised_prompt\":\"rev\"}\n"))
		if err != nil {
			t.Fatal(err)
		}
		if len(seen) != 1 {
			t.Fatalf("partial callbacks = %d, want 1", len(seen))
		}
		if seen[0].ImageB64 != pngB64 {
			t.Fatalf("partial ImageB64 = %q, want %q", seen[0].ImageB64, pngB64)
		}
		if seen[0].RevisedPrompt != "rev" {
			t.Fatalf("partial RevisedPrompt = %q, want rev", seen[0].RevisedPrompt)
		}
		if seen[0].PartialImageIndex != 2 {
			t.Fatalf("partial PartialImageIndex = %d, want 2", seen[0].PartialImageIndex)
		}
	})
}

func TestResponseCollectorEnforcesResponseAndLineLimits(t *testing.T) {
	t.Run("response total", func(t *testing.T) {
		c := newResponseCollector(nil)
		c.maxResponseBytes = 5
		c.maxLineBytes = 100
		if _, err := c.Write([]byte("a\n")); err != nil {
			t.Fatal(err)
		}
		if _, err := c.Write([]byte("1234")); !errors.Is(err, ErrHTTPResponseTooLarge) {
			t.Fatalf("err = %v, want ErrHTTPResponseTooLarge", err)
		}
		if got := c.bytesReceived(); got != 2 {
			t.Fatalf("bytesReceived = %d, want 2", got)
		}
	})

	t.Run("line across writes", func(t *testing.T) {
		c := newResponseCollector(nil)
		c.maxResponseBytes = 100
		c.maxLineBytes = 4
		if _, err := c.Write([]byte("1234")); err != nil {
			t.Fatal(err)
		}
		if _, err := c.Write([]byte("5")); !errors.Is(err, ErrSSELineTooLarge) {
			t.Fatalf("err = %v, want ErrSSELineTooLarge", err)
		}
	})

	t.Run("exact line with CRLF", func(t *testing.T) {
		c := newResponseCollector(nil)
		c.maxResponseBytes = 100
		c.maxLineBytes = 4
		if _, err := c.Write([]byte("1234\r")); err != nil {
			t.Fatal(err)
		}
		if _, err := c.Write([]byte("\n")); err != nil {
			t.Fatalf("collector rejected exact-limit CRLF line: %v", err)
		}
	})

	t.Run("native scanned line uses body limit without synthetic newline rejection", func(t *testing.T) {
		c := newResponseCollector(nil)
		c.maxResponseBytes = 4
		c.maxLineBytes = 4
		if err := c.writeSSELine([]byte("1234")); err != nil {
			t.Fatalf("writeSSELine rejected exact wire limit: %v", err)
		}
		if err := c.limitError(); err != nil {
			t.Fatalf("writeSSELine retained unexpected limit error: %v", err)
		}
	})
}
