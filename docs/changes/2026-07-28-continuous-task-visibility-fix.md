# Continuous Task Visibility Fix - 2026-07-28

## Manual Reproduction

The user tested the orphan-queue candidate at:

`发布验证/fhl-continuous-queue-orphan-fix-20260728/FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable`

Continuous generation was enabled, but the first Generate click displayed the
single-task loading placeholder instead of a task card. The status bar showed
running 0, queued 0, succeeded 0 and failed 0 while the page remained in a
requesting state.

The running candidate was confirmed as PID `34260`. Read-only process checks
showed only the local Photoshop Bridge listener/connection on `127.0.0.1:47631`
and no upstream network connection or CLI worker for the reported attempt.

## Root Cause

- The first continuous submission used `batchCount === 1` and had no previous
  batch session. `shouldOpenBatchView` therefore stayed false even though
  continuous mode requires the task grid for every click.
- Submission entered the top-level running state in one Zustand write, then
  registered the task record and workspace `batchTaskIds` in a second write.
  That allowed an inconsistent zero-task running state to be observed or
  retained if the second transition did not complete.
- A native pool start returning false or throwing outside its normal failure
  paths did not assign a visible terminal state to the exact queued task.

The preceding orphan fix remains valid and unchanged in purpose: it prevents
closed-workspace task records from being submitted. It did not cover the first
live task's view state or this zero-task transition.

## Implementation

- Continuous mode now participates directly in `shouldOpenBatchView`, so the
  first one-task click immediately opens the batch task grid.
- The run state, task record, workspace task ID, counters and grid state are
  committed in one functional Zustand transaction.
- Native pool false returns and unexpected start exceptions clear the exact
  task's temporary launch ownership and mark that still-referenced queued task
  failed with a visible error card and retry path.
- Existing exact task claiming, orphan filtering, one-task assertion,
  per-workspace single-flight and restart interruption behavior remain intact.

## Verification

- Focused task/pool/prompt tests: `61/61`.
- Frontend Node tests: `577/577`.
- Frontend UI tests: `23/23`.
- TypeScript: pass.
- Lint: `0` errors, existing `63` accepted warnings.
- Windows frontend build: pass.
- Desktop Go test/vet: pass.
- CLI Go test/vet: pass.
- Cloudflare Worker: `5/5`.
- Release safety: `0` issues.
- Portable compliance: `0` issues.
- Batch-scoped `git diff --check`: pass. The full dirty-worktree check still
  reports trailing whitespace in Wails-generated `frontend/wailsjs/go/models.ts`;
  that generated file contains a separate 285-line binding update and was not
  rewritten as part of this surgical fix.

The new UI suite includes an executable Store regression with a mocked Wails
host and offline test credential. One real `submit()` call creates one task,
adds exactly one workspace task ID, opens the result grid and calls the fake
native `Generate` exactly once. The first harness attempt failed before test
collection because the Vitest mock was not hoisted; the corrected harness
passes. No production endpoint was called.

Native restart state was also audited: restored direct queued/running tasks are
interrupted, workspace `runningJobIds` is cleared and the active top-level
`isRunning` value is derived from that cleared list.

## Final Portable

Output root:

`发布验证/fhl-continuous-queue-visible-task-fix-20260728`

- EXE size: `20,763,136` bytes.
- EXE SHA-256:
  `7E5FBBEE1C0538C89137E6BFE6AF57FF478BFF706351341D0ADA595B8DD21390`.
- ZIP size: `12,125,845` bytes.
- ZIP SHA-256:
  `3B5C8BDC0C00F69078605556342F0C7E9D6CF467570D30F04D8C1A8C673BE5ED`.
- ZIP entries: `22`.
- ZIP embedded EXE matches the directory EXE byte-for-byte.
- Package marker and exact V2.0.3 EXE are present. The only other executable is
  the expected `runtime/cli/gptcodex-image.exe`.

The failed orphan-fix candidate and all older rollback candidates were not
overwritten. The old V2.0.3 source comparison tree was read only.

## Acceptance Boundary

No real or paid generation request was sent. The final Portable was not
launched while the failed candidate remained open, avoiding a second desktop
instance and Bridge ambiguity. User manual confirmation of the visible first
task card is the remaining acceptance step.

## Real Codex Browser Acceptance

At the user's explicit request, the isolated `9231` process was stopped and
Codex Browser was moved to the real Windows Vite development surface at
`http://127.0.0.1:5173/`. The running Vite process points at this same source
tree and the page reports V2.0.3. The page restored an existing Images profile;
the API key was neither inspected nor copied.

A new workspace was used to avoid inheriting reference images or prior task
state. Continuous mode was enabled and one text-to-image request was submitted
with a square `1K`/low-quality configuration. One click produced exactly one
visible task card. The counters progressed from `submitting 1` to `running 1/4`
and then `success 1`, while queued and failed counts remained zero. The final
batch count was `1/1` and the browser console contained no warnings or errors.

The provider returned a real `1024x1024` result in about 25 seconds. It was
saved to:

`output/20260728-100300-251-一枚白色陶瓷咖啡杯放.png`

- Size: `1,215,163` bytes.
- SHA-256: `F8FC48563BF3F715938E38C0BB876FC0F114FC645A65CF05C37622087A14096B`.

Unlike the earlier automated verification, this acceptance made exactly one
real provider generation request, authorized by the user. It validates the
shared React/browser submit path; the native Wails window and Photoshop Bridge
remain separate runtime surfaces.

## Per-Image API Slot Badge

The continuous pool previously stored profile ID and name on tasks, but result
badges collapsed every official profile to `FHL`. Users therefore could not
visually audit whether tasks were distributed across all ten configured APIs.

The assigned profile's existing `fhlImagesPoolSlot` value is now frozen into
the task as non-secret metadata and propagated through browser job snapshots,
direct desktop result snapshots, task restore/reconciliation and history
persistence. Retry failover updates the task to the slot that actually handled
the new attempt. Successful and failed tiles both render the same bottom-left
`FHL1`-`FHL10` badge; full profile information remains in the tooltip, result
detail and failed-task log. Legacy records without a slot continue to render.

Verification completed without sending another provider request:

- Frontend Node tests: `578/578`.
- Frontend UI tests: `24/24`, including successful/failed badge rendering.
- TypeScript: pass.
- ESLint: `0` errors and the existing `63` warnings.
- Windows frontend build: pass.
- Codex Browser showed all labels from `FHL1` through `FHL10` on the real
  `5173` development UI. The inspected `FHL10` badge was positioned 13 px from
  the tile's left edge and 9 px from its bottom edge.
