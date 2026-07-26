# Concurrent Output Collision And Preview Recovery

Date: 2026-07-24

## Result

Concurrent image saves can no longer silently overwrite an earlier result.
The selected result keeps its live in-memory image when opening the canvas,
including the full-preview path, instead of replacing it with a stale disk
file. Large workspace sessions now persist only referenced compact task
records.

No image-generation request was submitted during this repair or verification.

## Incident

- Batch result 402 completed with colorful nails at 80.1 seconds.
- Batch result 418 completed later with gray nails at 98.5 seconds.
- Both results reported the same second-resolution output filename, so result
  418 overwrote result 402 on disk.
- The result grid retained result 402's correct in-memory image, while opening
  the canvas asynchronously loaded the overwritten disk path. This caused the
  visible colorful-to-gray switch.
- The correct result 402 was recovered from its raw response as
  `output/20260723-232959-495-第402张-恢复.png`.

## Root Cause

- `timestampWithMillis()` supplied a millisecond timestamp, but
  `fsio.BuildImageName()` truncated it to whole seconds.
- `SaveImage()` used overwrite semantics, so equal concurrent names were not
  collision-safe.
- Canvas preview materialization treated `previewBlob` as missing and re-read
  `savedPath`. Full-preview selection also re-read the disk file even when a
  complete in-memory `imageB64` or `imageBlob` was already available.
- Workspace persistence serialized the accumulated task map with repeated
  source-image payloads, making large batches vulnerable to localStorage quota
  failures and stale restore state.

## Implementation

- Preserve millisecond suffixes in generated image filenames.
- Save through atomic exclusive file creation and append `-2`, `-3`, and later
  suffixes when a path already exists.
- Prefer live blob previews on the canvas and keep `previewBlob` as a valid
  in-memory display source.
- Do not materialize a preview that already owns a `previewBlob` or live blob
  URL.
- Promote complete inline image data directly to full view without re-reading
  `savedPath`.
- Persist only tasks referenced by current workspaces and omit repeated
  `sourceImages` payloads.
- Rebuilt the development runtime CLI with product version `V2.0.2.1`.

## Verification

- Browser regression: result 402 remained colorful after both single-select
  return and double-click full preview; the previous delayed gray replacement
  was reproduced before the final guards and no longer occurred after them.
- Go: `go test ./...` passed.
- Runtime CLI: `--status` reported package version `V2.0.2.1`.
- Node: 530/530 passed, including a 400-task compact JSON round trip.
- UI: 4 files, 10/10 passed.
- TypeScript: `npm run typecheck` passed.
- ESLint: 0 errors and the existing 62 warnings.
- Windows production frontend: `npm run build:windows` passed with 1945
  transformed modules and version `2.0.2.1` unchanged.

## Residual State

The already-crashed historical batch cannot have all 400 task cards rebuilt
from the currently retained backend registry because older groups have already
been pruned. The compact persistence change prevents the same quota failure in
future large batches; the affected colorful result was recovered separately.
