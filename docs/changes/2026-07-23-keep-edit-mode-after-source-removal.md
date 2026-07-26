# Keep Edit Mode After Source Removal

Date: 2026-07-23

## Requirement

Removing the final explicit reference image from an image-to-image draft must
not switch the workspace back to text-to-image. The empty source strip should
remain ready for another reference image.

## Root Cause

`removeSource` selected `generate` whenever the resulting source list became
empty. `clearSources` also selected `generate` unconditionally.

## Change

- `removeSource` now retains `mode: "edit"` for every remaining source count.
- `clearSources` now retains `mode: "edit"`.
- Both actions still select manual edit-source mode and reset the shared
  auto-aspect lock when no explicit source remains.
- Existing submit validation still blocks image-to-image generation when
  neither an explicit source nor a usable current canvas image exists.

## Verification

- `node --test test/editModeSourceRemoval.test.mjs`: 2 passed.
- `npm run typecheck`: passed.
- `npm run test:node`: 512 passed.
- `npm run lint`: 0 errors, 62 existing warnings.
- Browser HMR check: image-to-image remained selected while the source strip
  showed 0 reference images.
- Browser console errors: 0.
