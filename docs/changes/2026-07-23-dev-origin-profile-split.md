# Dev Origin Profile Split Diagnosis

## Result

- The ten FHL Images pool entries were not deleted.
- The original configuration is still visible at `http://127.0.0.1:5173/`:
  `10/10` slots filled, 10 APIs enabled, and total capacity 40 at `4/API`.
- The active stress-test page is `http://localhost:5173/`. It shows zero pool
  entries because browser profile metadata and browser-fallback credentials are
  stored per origin. Browsers treat `localhost` and `127.0.0.1` as different
  sites even when both resolve to the same Vite process.
- No localStorage value, credential value, or API key was read during this
  diagnosis. The conclusion was verified only through visible UI state and
  source inspection.

## Live Batch State

- The existing `localhost` batch was left running and was not refreshed,
  cancelled, retried, or reconfigured.
- A ten-second browser sample advanced from 114 to 119 result tiles while the
  local queue decreased from 295 to 290. Four tasks remained running and zero
  failed tiles were visible.
- All four running tiles were attributed to `FHL-1 Responses | FHL`. Therefore
  this batch is a single-profile four-concurrency run, not the intended
  ten-key pool run.

## Resume Point

- Keep the current `localhost` tab untouched until its live batch finishes or
  the user explicitly cancels it.
- Use the already-open `127.0.0.1` tab for future Images pool work; do not save
  the empty `localhost` configuration over anything.
- Standardize future development launches and browser handoffs on
  `http://127.0.0.1:5173/` before starting another real batch.
- Do not attempt cross-origin credential copying. Reuse the configuration at
  its original origin, or let the user re-enter credentials through the UI if
  a deliberate origin change is ever required.

## Prevention

- `scripts/platform-vite.mjs` now passes `--host 127.0.0.1` for development by
  default, so Vite consistently advertises the origin that owns the existing
  browser-backed profiles. `IMAGE_STUDIO_DEV_HOST` remains an explicit local
  override when another bind host is intentionally needed.
- Added a source-contract test for the canonical development host.
- The already-running Vite process was not restarted, so the active real batch
  was not interrupted.

## Verification

- `node --check scripts/platform-vite.mjs`: passed.
- `node --test test/platform.test.mjs`: 8 passed, 0 failed.
- Focused `git diff --check`: passed with line-ending notices only.
- The active server remained PID 43360 after the edits.
- Latest isolated count for the current 397-source run: 123 result tiles,
  4 running, 270 queued, 0 failed, and 0 final-image-missing. All four running
  tiles remained attributed to `FHL-1 Responses | FHL`.
