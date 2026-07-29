# Photoshop Image Capabilities And Prepared Base V2

Date: 2026-07-26

## Contract

- `PSBridgeProfileInput` receives provider-derived image capabilities from the
  existing desktop size rules.
- `PSBridgeProfilePublic` exposes only aspect presets, resolution presets,
  quality-control availability and `pixels` versus `ratio-resolution` size
  encoding.
- The Go Bridge validates every capability enum before publication.

## Task Validation

- New multipart fields: `aspect`, `resolution`, `canvasWidth`, `canvasHeight`,
  and `preparedBase`.
- New contracts require supported presets, matching size encoding, a canvas at
  or below 100MP, and exact declared dimensions for the base and PNG mask.
- The original 50MB per image, 100MP image decode, ten-source, loopback,
  session and method protections remain active.
- Old plugin requests without the new fields keep the compatibility path.

## Upload Behavior

- Direct FHL jobs preserve source 1 when it is already normalized by
  Photoshop, while every reference continues through the existing upload-copy
  compressor.
- APIMart and RunningHub carry a non-sensitive `preparedBase` flag to the
  frontend remote kernel. Only ordered source 1 bypasses recompression.
- CLI fallback retains `--no-resize` and advertises only its actual 2K/4K
  pixel presets with quality controlled by the CLI.

## Verification

- Backend full package tests: passed.
- Frontend TypeScript check: passed.
- Frontend Node tests: `563/563` passed.
- Frontend UI tests: `12/12` passed.
- Focused prepared-base tests cover direct and remote paths, reference
  compression, public redaction and base/mask dimension rejection.

## Resume Point

Build the new candidate only under
`发布验证/ps-selection-frame-v2-20260726`, then launch its formal executable
from its own Portable directory. The existing release and prior candidates are
not promotion targets for this batch.

## Candidate Evidence

- The isolated release-safety audit reports `Issues: 0`.
- Candidate EXE: 20,751,872 bytes, SHA-256
  `D3BBB0F09D38A09EACAA71F1310142B97D5BE568DC1DA692396A819AF94FBDDA`.
- Candidate ZIP: 12,126,985 bytes, SHA-256
  `559039ED81F09844DD2F8BA1E47B6F1D0D55E03CDDA70BB56CCC8FBA6F8C1FD1`.
- Candidate Bridge PID 24028 is listening on `127.0.0.1:47631`; public health
  reports `ok=true` and `profileReady=true`. Photoshop PID 5308 has loaded the
  plugin and established its TCP connection to the Bridge.
- Matching plugin evidence: `73/73` tests; unsigned CCX 106,583 bytes and 21
  entries with SHA-256
  `B9BD524CFB5043DD104DD88EE759F33000B4F9F31EB26A0BE6B255DFB2824A26`;
  source, direct package payload and External sideload match `21/21` files.

## Partial Photoshop Acceptance And Resume Point

- The FHL Studio panel is visible and reports connected. The main prompt field
  visibly holds four lines, while the scrollbar and fixed-footer Generate
  button are also visible. Computer Use's screenshot path fails with
  `SetIsBorderRequired ... 0x80004002`, so visual inspection used a local
  read-only screen capture.
- Only the whole-document selection setup is complete. No acceptance claim is
  made yet for the 100x100 center selection, edge selection, manual aspect,
  real paid generation, inverse result mapping or temporary Alpha Channel
  cleanup.
- Use disposable images for all remaining Photoshop tests. Close with Don't Save
  and never Save As PSD. Leave the previously accidental PSD untouched; deletion
  was not authorized.
