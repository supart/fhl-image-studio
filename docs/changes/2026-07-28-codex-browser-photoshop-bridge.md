# Codex Browser Photoshop Bridge Development Mode

Date: 2026-07-28

## Goal

Keep the current React/Vite UI available in Codex Browser while providing a
real local Photoshop Bridge and preserving the existing project `output`
workflow. Do not rebuild the Photoshop plugin or submit a generation request.

## Root Cause

The page on port `5173` is a plain browser host. It can use the local browser
job proxy, but it does not own the Wails bindings used to synchronize the
active Profile into the Go Photoshop Bridge. The previous retry path also only
recognized `wails.localhost`, so a Wails development host could miss bindings
that arrived after the frontend entry point ran.

The Codex Browser configuration and the Wails WebView storage are separate.
The project already maintains a private current CLI configuration for local
development, but the Vite local-profile endpoint only read the optional
`.local/fhl-api.local.json` file.

## Changes

- Added a strict retry-host predicate covering `wails.localhost`, `localhost`,
  `127.0.0.1` and `::1`. The runtime still installs only when all required
  DesktopAPI methods are present.
- Added a pure CLI-env fallback mapper for local FHL Images/Responses profiles.
  Missing credentials and APIMart/RunningHub modes are rejected.
- Updated the Vite local FHL endpoint to use that fallback only when the
  dedicated local profile file is absent.
- Navigated Codex Browser to the Wails browser development proxy on port
  `34115`; the same source frontend remains served by Vite on port `5173`.

## Verification

- Focused Node tests: 14 passed, 0 failed.
- TypeScript: passed.
- Codex Browser page: V2.0.3 loaded, configured button state present, no page
  warnings or errors.
- Photoshop Bridge health: `ok=true`, `apiVersion=1`, `profileReady=true` on
  port `47631`.
- No Photoshop job, provider request or paid generation was submitted.

## Runtime Handoff

- Codex Browser: `http://127.0.0.1:34115/`.
- Source Vite server: `http://127.0.0.1:5173/`.
- Photoshop Bridge: `http://127.0.0.1:47631/fhl-ps/v1`.
- The Bridge belongs to the active `wails dev` process. Restart that process
  and reopen the `34115` page if the Bridge stops or loses its Profile.

## Operational Note

An unrelated OneDrive Sync Service process was briefly included in an initial
recursive process cleanup because Windows had reused a parent PID. It was
immediately restarted as PID `57784`. No files were changed or removed. Later
cleanup used only exact verified executable PIDs.
