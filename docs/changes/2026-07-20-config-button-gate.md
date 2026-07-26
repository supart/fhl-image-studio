# 2026-07-20 Configuration Button Gate

## Goal

Correct the Windows header configuration indicator without changing profile
storage, credential handling, public APIs, versions, or release artifacts.

## Root Cause

`AppHeaderBrand.tsx` currently treats the presence of an official FHL profile
or any Images pool slot as proof that credentials are usable. Default profiles
can exist without a key, and a legacy/partial pool row can have a slot without
a redacted key hint, so both checks produce false positive `is-configured`
states.

## Acceptance Cases

| State | Expected class |
| --- | --- |
| Blank state | `needs-config` |
| Default FHL profile only, no credential | `needs-config` |
| Current Responses or Images key in memory | `is-configured` |
| Current RunningHub mode with bridge URL | `is-configured` |
| Images pool slot without a key hint | `needs-config` |
| Valid Images pool slot with E2E-safe `last4:TEST` hint | `is-configured` |

## Intended Change

Add one pure predicate beside the existing profile normalization helpers, use
it from the Windows header, and cover all six states with node tests. The
predicate must inspect only the already-loaded in-memory store state and
redacted profile metadata.

## Verification Plan

- Frontend: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build:windows`.
- Repository: `git diff --check` and a sensitive-file/version guard.
- Packaged desktop: clean Wails build, then start only the new EXE with
  `--e2e-only --e2e-port 9230` and verify both configuration states and the
  required media scenarios.
- Do not perform real upstream calls or create local API configuration.

## Status

Implementation and short source gates are complete:

- the six focused configuration states pass;
- the full frontend suite passes (472 Node tests and 5 UI tests);
- typecheck and `git diff --check` pass;
- lint remains at its accepted baseline of 0 errors and 63 warnings;
- no API-key file, WebView cache, version bump, or release artifact was added.

The starting HEAD remains the rollback reference; the current working tree
must not be reset or overwritten.

The remaining source gates subsequently completed successfully:

- `npm run build:windows`, retaining `frontend@2.0.2.1`;
- both Go modules: `go test ./...` and `go vet ./...`;
- backend repetition: `go test ./backend -count=10`;
- Worker tests: 5 of 5;
- `wails doctor` with Wails v2.12.0.

The next exact action is now `wails build -platform windows/amd64 -clean`, then
packaged configuration and media E2E on port 9230.

## Takeover Audit

After the previous Codex window failed during stream reconnection/context
compaction, this window took over from disk state on 2026-07-20 21:13 +08:00.

Confirmed modified files:

- `image-studio/frontend/src/components/layout/AppHeaderBrand.tsx`;
- `image-studio/frontend/src/lib/profiles.ts`;
- `image-studio/frontend/test/fhlAPIConfig.test.mjs`;
- `image-studio/frontend/test/profiles.test.mjs`;
- `image-studio/frontend/test/retryUsesActiveApiProfile.test.mjs`.

Confirmed new handoff/history files:

- `PROJECT_CONTEXT.md`;
- `docs/changes/2026-07-20-config-button-gate.md`.

The implementation was re-read against the acceptance cases, and no missing
source fix was found. Re-run checks in this takeover window:

- `npm run test:node`: 472 passed;
- `npm run test:ui`: 2 test files / 5 tests passed;
- `npm run typecheck`: passed;
- `npm run lint`: passed at the accepted baseline of 0 errors and 63 warnings;
- `git diff --check`: passed, with only CRLF-to-LF warnings for three touched
  frontend files;
- no `config/cli.env.local`, `config/webview`, or `.git/index.lock`;
- no `V2.0.3`, `2.0.3`, or `2.0.2.2` version marker in the current source diff.
