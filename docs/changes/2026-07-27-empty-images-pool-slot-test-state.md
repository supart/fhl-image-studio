# Empty Images Pool Slot Test-State Fix

Date: 2026-07-27

## Contract

- An empty Images pool slot is unconfigured, not failed.
- Batch save/test must not probe a slot without a persisted credential marker.
- Deleting a Profile must remove its local success/error result immediately.
- Rendering must not show a historical connection result for a row without a
  Profile or newly typed key.

## Implementation

- `autoTestSavedPoolSlots` now selects only Profiles with
  `fhlImagesPoolKeyHint`.
- `handleDelete` removes the deleted row from `slotConnectionResults`.
- Row rendering ignores stale results for empty, untouched slots.
- UI regression tests cover credential-less metadata and deleting a failed
  slot.

## Verification

- Focused Images pool UI tests: 8/8 passed.
- Focused source contracts: 2/2 passed.
- Frontend Node tests: 563/563 passed.
- Full frontend UI tests: 22/22 passed.
- TypeScript typecheck: passed.
- ESLint: zero errors and 63 accepted pre-existing warnings.
- Windows frontend build: passed.
- Desktop/Bridge Go tests: passed.
- Scoped diff check: passed.
- Browser refresh: one configured slot, nine empty slots, no failure/testing
  status, and all nine empty-slot test buttons disabled.

No Save/Test button, provider endpoint, generation request, or paid API was
invoked during browser QA or automated verification.
