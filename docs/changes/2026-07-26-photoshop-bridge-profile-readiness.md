# 2026-07-26 Photoshop Bridge Profile Readiness

## Scope

Diagnose the hardened isolated V2.0.3 candidate's public Bridge readiness using
only source and non-sensitive runtime metadata. Do not inspect credentials,
session data, protected Profile data, WebView databases or request bodies.

## Runtime Evidence

- PID 63580 is the hardened isolated candidate and owns the only listener on
  `127.0.0.1:47631`.
- Public `/fhl-ps/v1/health` returns `ok=true`, instance
  `c6579611384a1794f77076ef` and `profileReady=false`.
- Portable startup binds Wails WebView data to the package-local
  `config/webview` directory and disables legacy WebView migration. The active
  frontend storage namespace is the production namespace.

## Diagnosis

- Fresh bootstrap creates and activates an FHL Images profile. The Bridge marks
  that profile ready only when its stored credential can be read and is not
  empty.
- Entering an API key in an Images pool field only updates the component's
  local draft. Persistence and connection testing begin only after
  `保存并测试 Images 池` or the per-slot test action.
- A profile created from a previously empty pool slot uses `setActive:false`.
  After saving and testing it, the user must set that slot as the current API
  for public Bridge health to report readiness for it.
- If save/test and activation both complete but health remains false, the
  remaining source-level branch is an unavailable credential write/read. The
  current profile update path logs and suppresses credential-write errors, so
  the UI connection-test result is the supported non-sensitive signal.

## Safety And Resume Point

- Computer Use screenshot and click control failed with
  `SetIsBorderRequired ... 0x80004002`; no blind or fallback UI action was
  performed.
- No API key, Credential Manager entry, `/session`, protected `/profile`,
  WebView database content or complete request body was accessed.
- Resume in the candidate UI: complete `保存并测试 Images 池`, confirm the
  connection-test result, set the saved slot as current when needed, then check
  only public `/fhl-ps/v1/health` again.
