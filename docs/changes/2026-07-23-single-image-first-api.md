# Single-Image First-API Routing

## Confirmed Rule

- A normal continuous text-to-image or image-to-image click creates one task.
- That task is pinned to the first enabled FHL Images API. With all ten slots
  enabled this is API 1.
- Continuous mode only permits another one-image click while work is active;
  it does not fill the pool automatically.
- Batch image-to-image continues to distribute explicit batch sources across
  enabled APIs in slot order and uses summed per-API capacity.

## Root Cause

- The normal continuous submit count used total FHL pool capacity.
- With ten enabled APIs and `4/API`, one single-image edit click therefore
  created 40 tasks and sent them through pool round-robin.
- Live inspection confirmed one 40-card grid before the fix.

## Change

- Normal continuous submit count is now fixed at one.
- The first enabled pool profile is snapshotted on the task before queueing, so
  the global pump cannot round-robin that single task onto another API.
- The displayed concurrency summary distinguishes the first-API single-image
  route from the calculated batch total.
- Batch tasks remain unassigned until the scheduler selects their API, keeping
  existing round-robin, retry, and capacity behavior intact.

## Safety And Verification

- The existing accidental 40-task run was allowed to finish naturally before
  hot-reloading source. It ended with 40 results and no failed task.
- No new real image request was submitted for acceptance.
- TypeScript typecheck and 18 focused tests passed.
- Browser UI loaded the corrected rule with zero active tasks and no console
  errors.
- Full regression and build results are recorded in `PROJECT_CONTEXT.md`.
- Final regression passed: 510 Node tests, 10 UI tests, TypeScript typecheck,
  ESLint with no errors, Windows production build, both Go module tests/vet,
  repeated backend tests, and full diff validation.
