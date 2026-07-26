# Independent FHL Batch Submission Implementation

Date: 2026-07-23

## Result

The browser-mode FHL pool no longer launches one queued task at a time. It now
plans every available API slot, reserves the complete wave atomically, reads
each required credential once, and sends the wave through one local
`submit-many` request. Every image remains an independent task, group, job,
result, cancellation target, and history item.

No paid or live upstream generation was started during this implementation
batch.

## Scheduler

- Added pure `planContinuousPoolWave()` planning.
- `10 API x 4/API` reserves 40 tasks in four API1-to-API10 rounds.
- A partially occupied pool reserves every remaining slot in one pass.
- `submitting` reservations count against capacity before asynchronous work
  begins, preventing duplicate occupancy.
- The pump coalesces wakeups and reruns after a wave, so terminal events cannot
  lose refill signals.
- Each unique profile credential is read once per wave. Plaintext credentials
  remain local to submission and are not stored in Zustand or the registry.
- Single-image continuous generation remains one task pinned to the first
  enabled API. Batch image-to-image uses the multi-API wave planner.

## Browser Proxy

- Added `POST /__image-studio-jobs/submit-many`, capped at 50 tasks.
- The request uses a profile-keyed credential table and stable
  `clientTaskId` values.
- Every accepted item receives its own `groupId`, `jobId`, and `batchCount=1`.
- A complete wave is registered with one registry persistence operation, then
  accepted jobs are spawned independently.
- Duplicate `clientTaskId` submissions return the existing group while it is
  retained, allowing a local transport retry to remain idempotent.
- Per-item validation and spawn failure do not roll back neighboring jobs.
- The original single-item `/submit` endpoint remains available.

## Correlation And Failure Handling

- Added optional `runId` and `clientTaskId` group metadata.
- Submission responses, SSE updates, restored groups, and terminal updates
  prefer `clientTaskId` over slot-position inference.
- A failed whole-wave local request retries once with the same task IDs. A
  second transport failure returns tasks to the queue instead of failing the
  entire batch.
- Cancelling a task during submission leaves it cancelled; a late accepted
  backend job is immediately cancelled by its returned job ID.
- Content-policy failures release the slot without reducing API capacity.
- Repeated transient upstream failures reduce only the affected API, with a
  minimum temporary capacity of one.
- Missing or permanently rejected credentials disable only the affected API
  and unassign its waiting tasks for redistribution.
- Final audit fixed an important zero-capacity edge: an unavailable FHL API
  now becomes non-schedulable instead of inheriting the generic scheduler's
  separate `0 = unlimited` convention.

## UI

- Task cards can show `submitting` independently from queued/running states.
- Pool summary shows running, submitting, queued, succeeded, and failed counts.
- Per-API occupancy is visible as `API n current/effective-capacity` without
  exposing credentials.
- Existing task source index, API attribution, output, retry, cancellation,
  and history behavior remains independent per image.

## Verification

- Focused scheduler/store audit: 19/19 passed after the zero-capacity fix.
- Full Node suite: 526/526 passed.
- UI suite: 4 files, 10/10 passed.
- TypeScript: `npm run typecheck` passed.
- ESLint: 0 errors and the existing 62 warnings.
- Windows production frontend: `npm run build:windows` passed with 1944
  transformed modules and version `2.0.2.1` unchanged.
- `git diff --check` passed; only existing line-ending advisories were shown.
- No-cost simulations confirm 40 initial reservations, 37-slot refill from
  three occupied slots, and a 397-task queue that stays at capacity until its
  final natural drain.
- Proxy tests confirm 40 unique groups/jobs, one registry write, idempotent
  replay, partial validation failure isolation, and single-job cancellation.
- Read-only browser review showed `0/40` running, zero submitting/queued, ten
  `0/4` API occupancy indicators, version `V2.0.2.1`, and no console errors.

## Next Acceptance Step

The code is ready for a user-authorized live generation test. Start with a
bounded paid batch, confirm the first wave reaches the expected real process
count and API distribution, then decide whether to run the full 397-image
pressure test. Do not submit another paid batch merely for automated QA.
