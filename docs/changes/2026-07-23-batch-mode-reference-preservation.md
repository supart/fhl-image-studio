# Batch Mode Reference Preservation

Date: 2026-07-23

## Result

An enabled batch image-to-image session now remains enabled when a fixed
reference image is added, imported, reused, removed, or cleared. Batch mode is
disabled only by an explicit mode or switch action, not by a reference-list
update.

No image-generation request was submitted during this fix or verification.

## Root Cause

Reference-image actions in `studioStore.images.ts` unconditionally assigned
`editSourceMode: "manual"`. Adding one fixed reference therefore collapsed an
already enabled batch image-to-image panel even though the user had not
changed the batch switch.

## Implementation

- Added one local mode-preservation helper for reference-only updates.
- Applied it to desktop/native selection, browser file import, history reuse,
  general image import, single-reference removal, and reference clearing.
- Kept image-to-image mode active when the final fixed reference is removed;
  the batch queue and enabled batch state remain available.
- Left complete history-parameter restoration unchanged because that action
  intentionally restores an entire editing configuration.

## Verification

- Browser file-picker regression: added one real local fixed reference while
  batch mode was enabled; the reference appeared, `aria-checked` remained
  `true`, and the existing 397/397 batch queue remained selected.
- Browser console: no warnings or errors after the interaction.
- Full Node suite: 527/527 passed.
- UI suite: 4 files, 10/10 passed.
- TypeScript: `npm run typecheck` passed.
- ESLint: 0 errors and the existing 62 warnings.
- Windows production frontend: `npm run build:windows` passed with 1944
  transformed modules and version `2.0.2.1` unchanged.
- `git diff --check` passed with line-ending advisories only.
