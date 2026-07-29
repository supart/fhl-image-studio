# Continuous Single-Task Round-Robin Correction

Date: 2026-07-27

## Required Contract

- Ordinary text-to-image continuous mode creates exactly one image task per
  Generate click.
- Continuous mode allows more clicks while earlier work is active.
- Each new task starts without a Profile assignment. The existing scheduler
  selects enabled Images Profiles round-robin and enforces the total pool
  capacity.
- Batch image-to-image keeps its separate source-count submission behavior.

## Regression And Correction

The first attempted fix incorrectly used effective total pool capacity as the
ordinary continuous submission count. With ten enabled APIs and four jobs per
API, a single click created 40 queued tasks. Browser inspection showed zero
running, zero submitting, 40 queued, zero succeeded, and zero failed tasks.
The queue was observed without cancellation or retry actions.

The submit count is now fixed at one again, but unlike the original regressed
implementation the task is not pinned to the first enabled Profile. Tests
require this exact combination and reject both total-capacity submission and
first-Profile pinning. UI copy distinguishes one-task submission from the
40-task total concurrency ceiling.

## Verification

- Focused continuous-pool tests: 31/31 passed.
- Frontend Node tests: 563/563 passed.
- Frontend UI tests: 20/20 passed.
- TypeScript typecheck: passed.
- ESLint: zero errors and 63 accepted pre-existing warnings.
- Windows frontend build: passed.
- Desktop/Bridge Go tests: passed sequentially after the frontend build.
- Scoped `git diff --check`: passed with existing line-ending warnings only.
- Codex browser: copy states one task per click, 40 only as total capacity;
  the accidental queue remains 40 queued with zero running or submitting.

An initial Go test was mistakenly run concurrently with Vite, which replaces
hashed assets in `dist`; Go observed the directory between replacement steps
and reported missing old asset names. The unchanged suite passed immediately
when rerun after the build completed. This was a test orchestration race.

No Generate, cancel, or retry control was activated during the correction
verification. Existing Portable/source candidates, Photoshop plugin packages,
and Bridge contracts were not changed.
