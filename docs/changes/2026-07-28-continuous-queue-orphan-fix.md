# V2.0.3 Continuous Queue Orphan Fix

Date: 2026-07-28

## Reproduced Failure

The 2026-07-27 candidate was the binary the user tested. Its formal EXE hash
remains `FC65F956A3BCC3FBABBFB4CFFB26761DF681DF22BA5464AB5F0DFC5A1DA3825F`.
The package produced hundreds of real upstream attempts after only a few UI
clicks. Output logs and files proved this was repeated transport submission,
not duplicate cards or one provider request returning many images.

## Root Cause

The global continuous pool scanned every record in `batchTasksById`.
`closeWorkspace()` removed the workspace but left its task records behind.
Those invisible orphan records could remain queued. Native launch then bound a
new job by `workspaceId + slotIndex`; when the workspace or task reference no
longer existed, the state update failed but the Wails transport request still
ran. The unchanged orphan was selected again and created an unbounded paid
request loop.

## Implementation

- Queue and in-flight pool scans now iterate only tasks explicitly referenced
  by a live workspace, with matching workspace ownership.
- Pool profile assignment and browser submit-many recheck membership before
  any submission, including after asynchronous credential reads.
- Native launch snapshots an exact `taskId` and must atomically claim that task
  before registering it as running or calling Wails Generate/Edit.
- A missing workspace, unlisted task, already active task, cancelled task or
  mismatched owner fails the claim and performs no transport request.
- Native result, upstream error, save error and submission-failure paths update
  the exact claimed task ID instead of guessing by slot.
- All four native launch call sites now provide the originating task ID.

## Verification

- Focused task/pool/UI contracts: `57/57` after the one-claim regression was
  added.
- Frontend Node tests: `576/576`.
- Frontend UI tests: `22/22`.
- TypeScript: passed.
- ESLint: `0` errors and the accepted existing `63` warnings.
- Desktop Go test and vet: passed.
- CLI Go test and vet: passed.
- Worker tests: `5/5`.
- Release safety: `0` issues.
- Portable compliance: `0` issues.

Executable tests prove that closed-workspace or unlisted records are excluded,
orphan running records consume no live pool capacity, same-slot records are
updated by exact ID, an orphan cannot be claimed, and one active task ID cannot
be claimed a second time.

## New Isolated Artifacts

Output root:

`发布验证/fhl-continuous-queue-orphan-fix-20260728`

- EXE size: `20,762,112` bytes.
- EXE SHA-256:
  `6C714E026143A4CA591E710C34ABA6B7075C06D092A2BEAB75101C6C3B6BAD48`.
- ZIP size: `12,125,443` bytes.
- ZIP SHA-256:
  `A288A6A2CA5C2D8D7AC7D593FB55D04D83246E6347907C2014C675E90C855C5D`.
- ZIP entries: `22`.
- ZIP embedded EXE hash matches the directory EXE exactly.
- The required marker and formal EXE are present. The only other EXE is the
  expected packaged CLI.

The unsafe candidate and old read-only V2.0.3 source comparison were not
modified or launched during this batch.

## Remaining Native Acceptance

The newly built normal Portable has not yet been given a fake key through its
UI. A normal copy shares the production Windows credential namespace, so doing
that would risk replacing the user's real configured API. The next acceptance
must use the packaged `--e2e-only` isolation boundary and verify the embedded
orphan guard without exposing or copying credentials. No real or paid provider
request was made in this batch.
