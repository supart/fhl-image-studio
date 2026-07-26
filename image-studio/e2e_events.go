package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type e2eEventHub struct {
	mu          sync.Mutex
	subscribers map[string]map[chan any]struct{}
}

func newE2EEventHub() *e2eEventHub {
	return &e2eEventHub{
		subscribers: map[string]map[chan any]struct{}{},
	}
}

func (h *e2eEventHub) Emit(eventName string, payload any) {
	name := strings.TrimSpace(eventName)
	if name == "" {
		return
	}
	h.mu.Lock()
	targets := make([]chan any, 0, len(h.subscribers[name]))
	for ch := range h.subscribers[name] {
		targets = append(targets, ch)
	}
	h.mu.Unlock()
	for _, ch := range targets {
		select {
		case ch <- payload:
		default:
		}
	}
}

func (h *e2eEventHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeE2EJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	eventName := strings.TrimSpace(r.URL.Query().Get("eventName"))
	if !validE2EEventName(eventName) {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported E2E event name"})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeE2EJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}
	ch := make(chan any, 64)
	h.mu.Lock()
	bucket := h.subscribers[eventName]
	if bucket == nil {
		bucket = map[chan any]struct{}{}
		h.subscribers[eventName] = bucket
	}
	bucket[ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(bucket, ch)
		if len(bucket) == 0 {
			delete(h.subscribers, eventName)
		}
		h.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case payload := <-ch:
			data, err := json.Marshal(payload)
			if err != nil {
				data, _ = json.Marshal(map[string]string{"error": err.Error()})
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-ticker.C:
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func validE2EEventName(value string) bool {
	prefix, jobID, ok := strings.Cut(strings.TrimSpace(value), ":")
	if !ok || jobID == "" || len(jobID) > 128 {
		return false
	}
	switch prefix {
	case "progress", "log", "preview", "result", "error", "settled":
	default:
		return false
	}
	for _, char := range jobID {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			continue
		}
		return false
	}
	return true
}
