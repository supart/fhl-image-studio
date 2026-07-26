package main

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"image-studio/backend"
)

const (
	e2eServicePrefix      = "/__e2e/service/"
	e2eEventsPath         = "/__e2e/events"
	e2eStatusPath         = "/__e2e/status"
	e2eProjectFilesPrefix = "/__image-studio-files"
	e2eTokenHeader        = "X-Image-Studio-E2E-Token"
	e2eTokenQuery         = "e2eToken"
)

// The E2E bridge is deliberately smaller than the Wails API. In particular,
// it never exposes credentials, provider/network calls, jobs, dialogs, shell
// opens, or arbitrary file access.
var e2eBridgeMethods = []string{
	"GetAutomationStatus",
	"GetOutputDir",
	"RegisterImportedImageAsset",
	"RegisterMediaAsset",
}

var e2eBridgeMethodSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(e2eBridgeMethods))
	for _, method := range e2eBridgeMethods {
		out[method] = struct{}{}
	}
	return out
}()

type e2eRuntime struct {
	token  string
	root   string
	status backend.AutomationStatus
	events *e2eEventHub

	mediaMu sync.RWMutex
	media   map[string]string
	close   sync.Once
}

func newE2ERuntime(status backend.AutomationStatus) (*e2eRuntime, error) {
	token, err := randomE2EToken(32)
	if err != nil {
		return nil, err
	}
	root, err := os.MkdirTemp("", fmt.Sprintf("fhl-studio-e2e-%d-", os.Getpid()))
	if err != nil {
		return nil, err
	}
	for _, name := range []string{"input", "output", "intermediate"} {
		if err := os.Mkdir(filepath.Join(root, name), 0o700); err != nil {
			_ = os.RemoveAll(root)
			return nil, err
		}
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		_ = os.RemoveAll(root)
		return nil, err
	}
	status.Enabled = true
	status.Executable = ""
	status.BridgeMethods = append([]string(nil), e2eBridgeMethods...)
	return &e2eRuntime{
		token:  token,
		root:   canonicalRoot,
		status: status,
		events: newE2EEventHub(),
		media:  map[string]string{},
	}, nil
}

func (rt *e2eRuntime) Close() {
	if rt == nil {
		return
	}
	rt.close.Do(func() {
		rt.mediaMu.Lock()
		rt.media = map[string]string{}
		rt.mediaMu.Unlock()
		_ = os.RemoveAll(rt.root)
	})
}

func randomE2EToken(bytesCount int) (string, error) {
	if bytesCount < 16 {
		return "", errors.New("E2E token size is too small")
	}
	data := make([]byte, bytesCount)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func startE2EServer(assets fs.FS, status backend.AutomationStatus) (*http.Server, string, int, error) {
	port := status.Port
	if port <= 0 {
		port = defaultE2EPort
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, "", 0, err
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	serverURL := fmt.Sprintf("http://127.0.0.1:%d/", actualPort)
	status.Port = actualPort
	status.ServerURL = serverURL
	runtime, err := newE2ERuntime(status)
	if err != nil {
		_ = listener.Close()
		return nil, "", 0, err
	}
	handler, err := newE2EHTTPHandler(assets, runtime)
	if err != nil {
		runtime.Close()
		_ = listener.Close()
		return nil, "", 0, err
	}
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		err := server.Serve(listener)
		runtime.Close()
		if !isServerClosed(err) {
			fmt.Printf("[FHL Studio E2E] server error: %v\n", err)
		}
	}()
	return server, serverURL, actualPort, nil
}

func newE2EHTTPHandler(assets fs.FS, runtime *e2eRuntime) (http.Handler, error) {
	if runtime == nil {
		return nil, errors.New("E2E runtime is required")
	}
	dist, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return nil, err
	}
	static := http.FileServer(http.FS(dist))
	mux := http.NewServeMux()
	registerE2EDisabledRoutes(mux)
	registerE2EProjectFileRoutes(mux, runtime)
	mux.Handle("/media/", runtime)
	mux.Handle(e2eEventsPath, runtime.events)
	mux.HandleFunc(e2eStatusPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeE2EJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writeE2EJSON(w, http.StatusOK, runtime.status)
	})
	mux.HandleFunc(e2eServicePrefix, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeE2EJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		method := strings.TrimPrefix(r.URL.Path, e2eServicePrefix)
		handleE2EServiceCall(w, r, runtime, method)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeE2EJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			serveE2EIndex(w, r, dist, runtime)
			return
		}
		static.ServeHTTP(w, r)
	})
	return runtime.securityMiddleware(mux), nil
}

func registerE2EDisabledRoutes(mux *http.ServeMux) {
	for _, prefix := range []string{
		e2eLocalConfigPrefix,
		"/__image-studio-fhl",
		"/__image-studio-apimart",
		"/__image-studio-apimart-legacy",
		"/__image-studio-apimart-image",
	} {
		handler := func(w http.ResponseWriter, _ *http.Request) {
			writeE2EJSON(w, http.StatusNotFound, map[string]string{"error": "capability is disabled in E2E mode"})
		}
		mux.HandleFunc(prefix, handler)
		mux.HandleFunc(prefix+"/", handler)
	}
}

func (rt *e2eRuntime) securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setE2ESecurityHeaders(w.Header())
		if !rt.validHost(r.Host) {
			writeE2EJSON(w, http.StatusMisdirectedRequest, map[string]string{"error": "invalid E2E host"})
			return
		}

		isSSE := r.URL.Path == e2eEventsPath
		isMutation := r.Method != http.MethodGet && r.Method != http.MethodHead
		isMedia := strings.HasPrefix(r.URL.Path, "/media/")
		if isMutation || isSSE {
			if !rt.validOrigin(r.Header.Get("Origin")) {
				writeE2EJSON(w, http.StatusForbidden, map[string]string{"error": "invalid E2E origin"})
				return
			}
		}
		if isMutation || isSSE || isMedia {
			provided := r.Header.Get(e2eTokenHeader)
			if isSSE || isMedia {
				provided = r.URL.Query().Get(e2eTokenQuery)
			}
			if !constantTimeE2EEqual(provided, rt.token) {
				writeE2EJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid E2E session token"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func setE2ESecurityHeaders(header http.Header) {
	header.Set("Cache-Control", "no-store")
	header.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; navigate-to 'self'")
	header.Set("Cross-Origin-Resource-Policy", "same-origin")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
}

func (rt *e2eRuntime) validHost(rawHost string) bool {
	host, port, err := net.SplitHostPort(strings.TrimSpace(rawHost))
	if err != nil || port != fmt.Sprint(rt.status.Port) {
		return false
	}
	host = strings.Trim(strings.ToLower(host), "[]")
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func (rt *e2eRuntime) validOrigin(rawOrigin string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawOrigin))
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	return rt.validHost(parsed.Host)
}

func constantTimeE2EEqual(left, right string) bool {
	if len(left) != len(right) || len(right) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func serveE2EIndex(w http.ResponseWriter, r *http.Request, dist fs.FS, runtime *e2eRuntime) {
	data, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusNotFound)
		return
	}
	injected := injectE2EBootstrap(data, runtime.status, runtime.token)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(injected)
}

func injectE2EBootstrap(indexHTML []byte, status backend.AutomationStatus, token string) []byte {
	script := []byte(e2eBootstrapScript(status, token))
	if idx := e2eBootstrapInsertIndex(indexHTML); idx >= 0 {
		out := make([]byte, 0, len(indexHTML)+len(script))
		out = append(out, indexHTML[:idx]...)
		out = append(out, script...)
		out = append(out, indexHTML[idx:]...)
		return out
	}
	out := make([]byte, 0, len(indexHTML)+len(script))
	out = append(out, script...)
	out = append(out, indexHTML...)
	return out
}

func e2eBootstrapInsertIndex(indexHTML []byte) int {
	lower := bytes.ToLower(indexHTML)
	if typeIndex := bytes.Index(lower, []byte(`type="module"`)); typeIndex >= 0 {
		if scriptIndex := bytes.LastIndex(lower[:typeIndex], []byte("<script")); scriptIndex >= 0 {
			return scriptIndex
		}
	}
	if idx := bytes.Index(lower, []byte("</head>")); idx >= 0 {
		return idx
	}
	return -1
}

func e2eBootstrapScript(status backend.AutomationStatus, token string) string {
	status.Enabled = true
	status.Executable = ""
	status.BridgeMethods = append([]string(nil), e2eBridgeMethods...)
	statusJSON, _ := json.Marshal(status)
	methodsJSON, _ := json.Marshal(e2eBridgeMethods)
	tokenJSON, _ := json.Marshal(token)
	return fmt.Sprintf(`<script>
(() => {
  const status = %s;
  const methods = %s;
  const sessionToken = %s;
  const createMemoryStorage = () => {
    const values = new Map();
    return Object.freeze({
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
      key: (index) => Array.from(values.keys())[Number(index)] ?? null,
      removeItem: (key) => values.delete(String(key)),
      setItem: (key, value) => values.set(String(key), String(value))
    });
  };
  if (status.e2eOnly === true) {
    try {
      Object.defineProperty(window, "localStorage", {
        configurable: false,
        enumerable: true,
        value: createMemoryStorage()
      });
      document.documentElement.dataset.e2eStorage = "memory";
    } catch (error) {
      document.documentElement.dataset.e2eStorage = "blocked";
      window.stop();
      throw new Error("E2E in-memory storage isolation failed", { cause: error });
    }
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url, window.location.href);
    if (target.origin !== window.location.origin) {
      return Promise.reject(new Error("External network access is disabled in E2E mode"));
    }
    if (request.method === "GET" || request.method === "HEAD") return nativeFetch(request);
    const headers = new Headers(request.headers);
    headers.set(%s, sessionToken);
    return nativeFetch(new Request(request, { headers }));
  };
  const call = async (name, args) => {
    const response = await fetch(%s + encodeURIComponent(name), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args || [])
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new Error(payload.error || ("E2E service call failed: " + name));
    }
    return payload.result;
  };
  window.__IMAGE_STUDIO_E2E_BOOTSTRAP = status;
  window.go = window.go || {};
  window.go.backend = window.go.backend || {};
  window.go.backend.DesktopAPI = window.go.backend.DesktopAPI || {};
  for (const name of methods) {
    window.go.backend.DesktopAPI[name] = (...args) => call(name, args);
  }
  const eventSources = new Map();
  window.runtime = window.runtime || {};
  window.runtime.EventsOnMultiple = (eventName, callback) => {
    const query = new URLSearchParams({ eventName, %s: sessionToken });
    const source = new EventSource(%s + "?" + query.toString());
    const bucket = eventSources.get(eventName) || new Set();
    bucket.add(source);
    eventSources.set(eventName, bucket);
    source.onmessage = (event) => {
      try {
        callback(JSON.parse(event.data));
      } catch {
        callback(event.data);
      }
    };
    return () => {
      source.close();
      bucket.delete(source);
      if (bucket.size === 0) eventSources.delete(eventName);
    };
  };
  window.runtime.EventsOff = (...eventNames) => {
    for (const eventName of eventNames) {
      const bucket = eventSources.get(eventName);
      if (!bucket) continue;
      for (const source of bucket) source.close();
      eventSources.delete(eventName);
    }
  };
  try {
    localStorage.setItem("gptcodex.e2e", "1");
    localStorage.setItem("gptcodex.kernelRuntimeMode", "auto");
  } catch {}
})();
</script>`,
		safeScriptJSON(statusJSON),
		safeScriptJSON(methodsJSON),
		safeScriptJSON(tokenJSON),
		mustE2EJSONString(e2eTokenHeader),
		mustE2EJSONString(e2eServicePrefix),
		mustE2EJSONString(e2eTokenQuery),
		mustE2EJSONString(e2eEventsPath),
	)
}

func mustE2EJSONString(value string) string {
	data, _ := json.Marshal(value)
	return safeScriptJSON(data)
}

func safeScriptJSON(data []byte) string {
	return strings.ReplaceAll(string(data), "</", "<\\/")
}

func handleE2EServiceCall(w http.ResponseWriter, r *http.Request, runtime *e2eRuntime, methodName string) {
	if _, ok := e2eBridgeMethodSet[methodName]; !ok {
		writeE2EJSON(w, http.StatusNotFound, map[string]string{"error": "method not exposed in E2E bridge"})
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	var rawArgs []json.RawMessage
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &rawArgs); err != nil {
			writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON args"})
			return
		}
	}
	result, err := dispatchE2EServiceCall(runtime, methodName, rawArgs)
	if err != nil {
		writeE2EJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeE2EJSON(w, http.StatusOK, map[string]any{"result": result})
}

func dispatchE2EServiceCall(runtime *e2eRuntime, methodName string, args []json.RawMessage) (any, error) {
	switch methodName {
	case "GetAutomationStatus":
		if err := requireE2EArgCount(args, 0); err != nil {
			return nil, err
		}
		return runtime.status, nil
	case "GetOutputDir":
		if err := requireE2EArgCount(args, 0); err != nil {
			return nil, err
		}
		return filepath.Join(runtime.root, "output"), nil
	case "RegisterImportedImageAsset":
		if err := requireE2EArgCount(args, 1); err != nil {
			return nil, err
		}
		var path string
		if err := json.Unmarshal(args[0], &path); err != nil {
			return nil, fmt.Errorf("argument 1: %w", err)
		}
		return runtime.registerMediaAsset(path, "")
	case "RegisterMediaAsset":
		if err := requireE2EArgCount(args, 2); err != nil {
			return nil, err
		}
		var savedPath, thumbPath string
		if err := json.Unmarshal(args[0], &savedPath); err != nil {
			return nil, fmt.Errorf("argument 1: %w", err)
		}
		if err := json.Unmarshal(args[1], &thumbPath); err != nil {
			return nil, fmt.Errorf("argument 2: %w", err)
		}
		return runtime.registerMediaAsset(savedPath, thumbPath)
	default:
		return nil, errors.New("method not exposed in E2E bridge")
	}
}

func requireE2EArgCount(args []json.RawMessage, count int) error {
	if len(args) != count {
		return fmt.Errorf("argument count mismatch: expected %d, got %d", count, len(args))
	}
	return nil
}

func (rt *e2eRuntime) registerMediaAsset(savedPath, thumbPath string) (backend.MediaAssetRef, error) {
	fullPath, err := e2eAssertSandboxFile(rt.root, savedPath)
	if err != nil {
		return backend.MediaAssetRef{}, err
	}
	previewPath := fullPath
	if strings.TrimSpace(thumbPath) != "" {
		if cleanThumb, thumbErr := e2eAssertSandboxFile(rt.root, thumbPath); thumbErr == nil {
			previewPath = cleanThumb
		}
	}
	id, err := randomE2EToken(16)
	if err != nil {
		return backend.MediaAssetRef{}, err
	}
	rt.mediaMu.Lock()
	rt.media["full/"+id] = fullPath
	rt.media["preview/"+id] = previewPath
	rt.mediaMu.Unlock()
	query := "?" + url.Values{e2eTokenQuery: []string{rt.token}}.Encode()
	return backend.MediaAssetRef{
		ImageID:    id,
		SavedPath:  fullPath,
		ThumbPath:  previewPath,
		PreviewURL: "/media/preview/" + id + query,
		FullURL:    "/media/full/" + id + query,
	}, nil
}

func (rt *e2eRuntime) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeE2EJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/media/")
	rt.mediaMu.RLock()
	path := rt.media[id]
	rt.mediaMu.RUnlock()
	if path == "" {
		http.NotFound(w, r)
		return
	}
	canonical, err := e2eAssertSandboxFile(rt.root, path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(canonical)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, filepath.Base(canonical), info.ModTime(), file)
}

func writeE2EJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
