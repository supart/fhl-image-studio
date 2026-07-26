# FHL Per-API Concurrency Correction

## Decision

- The desktop concurrency value applies to every enabled FHL Images API key.
- `4/API` with 10 enabled keys provides a total capacity of 40.
- `5/API` is full load and provides a total capacity of 50 with 10 keys.
- A single key remains capped at 5 concurrent image jobs.
- This supersedes the earlier interpretation that `4` was a global pool cap.

## Implementation

- Renamed the persisted state and UI contract from shared concurrency to
  per-API concurrency.
- Added `gptcodex.fhlImagesPool.perApiConcurrencyLimit.v1`; the legacy shared
  value is read only when the new key is absent and is migrated as follows:
  `0` to `5/API`, `2` to `2/API`, `4` to `4/API`, and other values clamped to
  the supported `1..5` range.
- Each enabled slot now receives the selected per-API limit, capped by the
  fixed slot maximum of 5 and any temporary profile-specific downgrade.
- Total capacity is the sum of enabled slot capacities. A temporary 429/error
  downgrade affects only the failing API.
- Existing API1 through API10 round-robin assignment is retained, including
  subsequent rounds, while task/result API attribution remains unchanged.
- Continuous generation creates one task per currently available pool-capacity
  unit. Batch image-to-image creates one task per selected source and lets the
  same pool scheduler decide which tasks run or wait.
- Lowering the setting does not cancel active work; queue refill pauses until
  each API is below its new limit. Raising it immediately pumps the queue.
- Updated desktop controls, batch status, queue labels, Images slot labels,
  E2E simulation output, and source-contract tests to use per-API terminology.

## Verification So Far

- TypeScript typecheck passed before this record was written.
- Focused Node checks passed: 73 tests covering the pool simulation, settings
  migration, store integration, batch routing, cancellation, and UI contracts.
- Simulated cases cover 1x4=4, 3x4=12, 10x4=40, 10x5=50, 50 tasks at 10x4
  starting 40 and queuing 10, and 11 tasks at 10x4 all starting.
- The first 40 simulated assignments form four strict API1 through API10 rounds.

## Final Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and the existing 62 warnings.
- `npm run test:node`: 487 tests passed.
- `npm run test:ui`: 3 files and 7 tests passed.
- `npm run build:windows`: passed with 1935 transformed modules. Only the
  existing dynamic-import and chunk-size advisories were emitted.
- `git diff --check`: passed; Git reported line-ending notices only.
- A boundary-aware long credential-pattern scan across frontend source, tests,
  UI tests, docs, and this handoff found zero files containing plaintext keys.
- Browser UI at `http://localhost:5173/` showed the new `4/API` controls,
  `5/API 满载`, the calculated enabled-key summary, and `最大并发 5` on every
  Images row. The configuration dialog had no visible overlap and browser
  error logs were empty.
- The live 11-image acceptance run was not started. At acceptance time the
  current browser state contained 0/10 configured Images slots, batch mode was
  off, and only one ordinary reference image was present. There were no active,
  submitted, or queued tasks. Recreating keys or inventing a different batch
  would have violated the instruction to reuse only the existing 11 sources.
- No real upstream image request was made in this batch.

## Resume Point

Implementation and automated verification are complete. A future live check
can resume only after the user has 10 Images slots enabled and the intended 11
source images selected again. Confirm no older task is active, then submit that
single batch and verify API1 through API10, then API1. The rollback point
remains starting HEAD `5c7960c8d459adda5e2c97807368fdc951e47cd6`; do not use
destructive Git commands because the uncommitted changes are intended.
