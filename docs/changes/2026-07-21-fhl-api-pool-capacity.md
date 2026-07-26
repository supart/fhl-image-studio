# 2026-07-21 FHL API Pool Capacity

## Goal

- Make the official FHL Images API pool work with 1 to 10 configured slots.
- Each enabled slot has a fixed image concurrency capacity of 5.
- Unlimited shared concurrency uses the summed pool capacity: 1 slot = 5 images, 10 slots = 50 images.
- A finite shared concurrency value is a global image cap across the whole pool.
- Continuous generation and batch image-to-image route through the same pool assignment path when official FHL Images pool slots are enabled.
- Task and history records preserve non-secret API source metadata for each generated image.

## Implementation

- Added `FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT = 5` and normalized official FHL Images pool slots to that value when parsing, creating, updating, and saving profiles.
- The pool configuration UI now shows each slot concurrency input as fixed 5 with `min=5`, `max=5`, `readonly`, and `disabled`.
- Added persisted `fhlPoolSharedConcurrencyLimit` state so the shared cap is independent from per-slot capacity.
- Updated continuous pool scheduling to enforce both per-slot capacity and the optional global image cap.
- Updated continuous submission to create the effective pool-capacity batch when shared concurrency is unlimited.
- Routed batch image-to-image submissions through the FHL pool assignment path when the active transport is official FHL and at least one pool slot is enabled.
- Increased the continuous pressure helper and E2E task normalization cap to 500 tasks for the intended stress scenario.
- Updated the pressure prompt theme to fishing small animals.
- Updated focused node tests and E2E harness simulations for 10 slots x 5 capacity, shared cap 4, batch image-to-image pool routing, and legacy saved slot normalization.

## Verification

- `npm run typecheck`: passed.
- `npm run test:node`: 474 tests passed, 0 failed. RuntimeHost tests printed expected mocked fetch/disk failure logs while the command exited 0.
- `npm run test:ui`: 2 files / 5 tests passed.
- `npm run lint`: passed with 0 errors and 62 warnings, under the existing `--max-warnings 63` gate.
- `git diff --check`: passed; Git only reported CRLF-to-LF warnings for touched frontend files.
- Browser UI check at `http://127.0.0.1:5173/`: upstream config dialog showed 10 FHL Images pool slots, each with fixed value/min/max 5 and readonly/disabled concurrency input. Shared concurrency text was visible in the control panel.

## Not Run

- No real upstream API calls were made.
- The user-provided API keys were not written to disk, logs, tests, docs, `.env`, or chat output.
- The 500-image real stress test remains user-assisted: enter keys only through the app UI/keyring, start with a small live batch, then run the full 500 task test after confirming upstream health and cost.
