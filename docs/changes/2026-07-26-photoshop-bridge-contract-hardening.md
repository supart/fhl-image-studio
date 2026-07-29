# Photoshop Bridge Standard-Canvas Contract Hardening

Date: 2026-07-26

## Problem

The Bridge validated declared aspect and resolution enums, but it did not prove
that `canvasWidth` and `canvasHeight` matched the selected standard output
matrix. A caller could therefore submit an arbitrary sub-100MP canvas as a
`preparedBase` and bypass the desktop's generic second resize.

## Implementation

- `image-studio/backend/ps_bridge.go` now validates FHL aspect/resolution pairs
  against the desktop pixel matrix. Extended `21:9` and `9:21` canvases use the
  same 8-pixel-rounded long-edge rule as the Photoshop client.
- Mask payloads must decode as PNG and must still match the declared canvas
  exactly.
- Public capability synchronization is restricted to the selected provider's
  supported aspects. APIMart cannot advertise unsupported `7:4` or `4:7`.
- Providers without quality control expose `qualityControl=false`, and their
  submitted quality value is normalized to `auto`.
- Public Profile data remains non-sensitive. No Base URL, credential user, API
  key, proxy or session value was added.

## Verification

- Full `go test ./...` in `image-studio`: passed.
- Frontend typecheck: passed.
- Frontend Node tests: `563/563` passed.
- Frontend UI tests: `12/12` passed.
- Focused Photoshop Bridge/size tests: `26/26` passed.
- Boundary tests prove exactly 10 images are accepted, 50MiB is accepted while
  50MiB plus one byte is rejected, and exactly 100MP passes the pixel ceiling
  while a larger declared canvas is rejected.
- Full `go test ./backend -count=1` after adding these tests: passed.
- Responses/Images table tests preserve `auto / low / medium / high` while
  APIMart/RunningHub normalize unsupported quality to `auto`.
- Go CLI request tests prove both Responses and Images API payload construction
  carries all four quality values. Full `go test ./...` passes in both the
  desktop backend and CLI modules.

## Isolated Candidate

- Candidate root:
  `发布验证/ps-selection-frame-v2-contract-20260726`.
- Release safety: `Issues: 0`, `OK`.
- EXE: 20,761,600 bytes, SHA-256
  `CA8D406B4DA6EDC48E5D90B378E6ABF179ACA41057B928F91AEE693216A50D0C`.
- Portable ZIP: 12,129,726 bytes, 24 entries / 16 files, SHA-256
  `8E41314043195629147CF87815108D33002ED4850CFB39390750F2868347B3A6`.
- ZIP and Portable tree contain no Debug, Setup, installer, NSIS or `.nsi`
  entry. The formal EXE inside the ZIP matches the disk EXE by SHA-256.

## Runtime Breakpoint

- The new candidate was not launched or promoted. PID 24028 continues to run
  the previous isolated `ps-selection-frame-v2-20260726` candidate on
  `127.0.0.1:47631`.
- Do not replace that runtime during the user's manual Photoshop test. Launch
  the hardened candidate only after the disposable Photoshop document and host
  are closed with Don't Save.
- The formal V2.0.3 release attachment and V2.0.2.1 archive remain unchanged.
