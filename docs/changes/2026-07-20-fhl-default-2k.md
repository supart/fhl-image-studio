# 2026-07-20 FHL Default 2K

## Goal

Make the desktop FHL default generation size use the 2K tier.

## Implementation

- Added `DEFAULT_FHL_SIZE = "2048x2048"` in `src/lib/generationDefaults.ts`.
- Updated the main store, initial workspace, current-workspace reset, and new
  workspace defaults to use `DEFAULT_FHL_SIZE`.
- Updated desktop FHL aspect selection from Auto so choosing an aspect fills the
  2K tier by default.
- Preserved Android's existing 1K behavior by passing an explicit Android-only
  `defaultResolutionFromAuto: "1k"` override.
- Left APIMart and RunningHub Auto-resolution fallback behavior unchanged.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed at the accepted baseline of 0 errors and 63 warnings.
- `npm run test:node`: 472 passed.
- `npm run test:ui`: 2 test files / 5 tests passed.
- Codex in-app browser on `http://127.0.0.1:5173/`: after reload and creating a
  new workspace, the compose summary showed `1:1 · 2K · 标准`, and the `2K`
  resolution chip was active.

## Notes

The browser page may still show older generated image badges such as
`864x1536` for existing history entries. That is historical output metadata,
not the current default parameter state.
