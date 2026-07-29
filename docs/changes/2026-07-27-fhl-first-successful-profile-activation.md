# FHL First Successful Profile Activation

Date: 2026-07-27

## Reproduction

- The native desktop FHL configuration dialog saved one Images credential and
  reported `1/1` connection success.
- After closing the dialog, the outer upstream card still reported
  unconfigured and the generation setup gate remained blocked.
- Public Photoshop Bridge health returned `ok=true` and
  `profileReady=false`, proving that the service was healthy but had no ready
  active Profile.
- A Profile dropdown with an empty active ID visually displayed the first
  option even though that Profile was not selected.

## Root Cause

- New Images pool slots use `setActive:false` so saving multiple slots does not
  repeatedly switch the ordinary generation Profile.
- Connection tests intentionally probe a supplied Profile ID without changing
  the active Profile.
- The save flow did not reconcile those two contracts when no usable active
  Profile existed. The successful credential stayed in the keyring and pool
  metadata, while runtime `apiKey` remained empty.

## Source Fix

- Batch pool testing records successful Profile IDs in stable slot order.
- Batch and targeted tests conditionally activate the first successful slot
  only when the current Profile is missing or unusable.
- Activation is re-read from the store and must produce a matching active ID,
  Base URL and required credential before the overall success message is kept.
- Existing usable active Profiles are preserved.
- Windows and shared desktop Profile selectors now show `请选择当前 API` when
  their active ID does not match a real Profile.

## Automated Verification

- Focused component tests: `8/8`.
- Focused configuration, Profile and Bridge Node tests: `38/38`.
- Full frontend Node tests: `563/563`.
- Full frontend UI tests: `20/20`.
- TypeScript typecheck: pass.
- ESLint: zero errors and 63 pre-existing warnings.
- Windows frontend production build: pass.
- Desktop and CLI `go test ./...` and `go vet ./...`: pass.

## Build Checkpoint

- Isolated output root:
  `发布验证/fhl-profile-activation-fix-20260727`.
- Rebuild both the clean V2.0.3 source package and the Windows Portable folder
  plus ZIP from this same source state.
- Preserve all earlier candidate and formal release artifacts until the new
  package passes safety, hash, startup and Bridge readiness acceptance.
- No image generation, paid upstream request, complete API key, session token
  or protected Profile payload is part of this batch.

## Candidate Artifacts

- Portable EXE: 20,762,112 bytes, SHA-256
  `1F2E09E5109AA973A3324433B2537DE7E94A30299EF3702FF26A1B7BF861D40E`.
- Portable ZIP: 12,129,972 bytes, 24 entries, SHA-256
  `24E87E839C80B2BD66903671101263B7C5D11F6967EDE35A0D2141EDCB0F1D7E`.
- Preliminary source ZIP: 17,553,418 bytes, 628 entries, SHA-256
  `8EEF7F7A9F0D185312EDA3D356B1117198D133FCAE7A31BC3839BB32FD209960`.
- Source stage: 620 files; the five directly changed source/test files match
  the working source byte-for-byte.
- The Portable ZIP embedded EXE matches the unpacked formal EXE.
- Portable and source release-safety scans: `Issues: 0`.
- Portable and source compliance scans: `Issues: 0`.

## Native Acceptance Checkpoint

- The new EXE runs normally as PID 37828 and owns the loopback Bridge on port
  47631 without E2E arguments.
- Its fresh isolated data root correctly starts with `profileReady=false`.
- Final acceptance is waiting for user-only API key entry and the existing
  `/v1/models` Images connection test. Codex will inspect only the public
  Bridge health result afterwards.

## Native Acceptance Result

- The user confirmed that saving and testing the Images configuration now
  updates the outer UI correctly.
- Public Bridge health reported `ok=true` and `profileReady=true` afterwards.
- No generation or paid upstream request was made during this acceptance.

## API Key Context Menu Follow-Up

- A production-only usability gap remained: right-clicking an editable API Key
  field did not show Paste because Wails disables WebView2's default context
  menu unless explicitly enabled.
- The desktop application now sets `EnableDefaultContextMenu: true`. Wails
  keeps this menu scoped to editable inputs, text selections and editable
  content, so the existing application-specific canvas/history menus remain in
  place.
- Added a desktop source-contract test; full desktop `go test ./...` passes.
- Rebuild target is the independent
  `发布验证/fhl-profile-activation-context-menu-fix-20260727` directory. No
  complete API key, clipboard content, protected Profile payload or session
  token is read or recorded.
