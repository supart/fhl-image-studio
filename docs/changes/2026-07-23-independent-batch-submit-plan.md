# Independent Browser Batch Submission Plan

## Live evidence

- The second 397-source run started at 20:37:44 with slot indices appended
  from 397.
- During a 100-second observation window, real backend/CLI concurrency was
  `3, 3, 2, 2, 3, 3` while the newest submitted index advanced only from 445
  to 449.
- All ten FHL Images profiles were used in round-robin order, but only two or
  three were active at once. The observed submission gap averaged about 20
  seconds.
- Most observed failures were upstream content-safety rejections. Those
  failures do not justify an empty local API slot: a queued task should replace
  every terminal task immediately.

## Confirmed bottleneck

- All batch sources already receive independent `BatchTaskRecord` objects.
- `pumpContinuousPoolQueue()` nevertheless launches one task at a time and
  awaits the complete `startContinuousQueuedTask()` path before planning the
  next task.
- That path reads one credential, posts one local `/submit` request, and waits
  for the proxy to persist the registry before it returns. Any delay in those
  steps stalls every API even when other profiles have free capacity.
- The proxy persists each one-job group separately. Progress/terminal writes
  share the same persistence chain, so task registration can also wait behind
  unrelated registry writes.

## Intended correction

1. Plan every currently available pool slot from one state snapshot. Reserve
   all selected task/profile pairs atomically in strict API1..API10 rounds.
2. Read each profile credential once per launch wave and keep plaintext only in
   the wave's local scope.
3. Add one browser-only `submit-many` request. Each entry still creates its own
   group ID, job ID, source binding, API attribution, task status, result, and
   history record. The proxy registers the whole wave, persists once, and
   starts every child independently.
4. Add an optional persisted `clientTaskId` so submit responses, SSE events,
   reload recovery, and terminal results bind to the exact frontend task rather
   than relying only on slot position.
5. Use partial-success semantics. One credential/read/submit/spawn failure marks
   only that task failed and never blocks sibling tasks.
6. Coalesce terminal wakeups. After any success or failure, calculate all free
   slots and launch one refill wave immediately. If a wakeup arrives while a
   wave is starting, record a rerun flag so no refill signal is lost.
7. Keep transient profile degradation profile-local and at minimum one slot;
   content-policy failures must not lower concurrency.
8. Preserve single-image API-1 routing, Android/Wails behavior, existing
   `/submit` compatibility, and the current 1-5 per-API limits.

## Verification gate

- Pure planner: 10 APIs x 4 produces 40 independent assignments in four exact
  round-robin passes; 3 occupied slots with a nonempty queue produces 37 new
  reservations in one wave.
- Credential test: 40 assignments read at most ten credentials.
- Proxy test: 40 entries create 40 unique groups/jobs with one registry commit;
  an injected persistence delay must not multiply by 40.
- Refill test: arbitrary success/failure events restore target occupancy in one
  pump cycle and one failed launch does not cancel the wave.
- Recovery test: every SSE event and reload snapshot maps by `clientTaskId` and
  preserves source/API/result identity.
- Simulation: 397 tasks, 10 APIs, 4/API remains at 40 while at least 40 tasks
  remain, then drains 39..1 without duplicate or missing task records.
- Run typecheck, focused Node tests, full Node/UI tests, lint, Windows build,
  and `git diff --check` before any paid browser acceptance run.

## Active-run constraint

- Monitoring was paused at the user's request. The paid run was not cancelled.
- Do not edit scheduler/proxy source while that page must remain alive because
  Vite HMR/restart can invalidate the active test. Resume implementation only
  after the user chooses to let it finish or explicitly cancels it.
