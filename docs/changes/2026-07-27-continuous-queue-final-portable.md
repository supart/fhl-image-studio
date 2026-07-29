# V2.0.3 Continuous Queue Final Portable

Date: 2026-07-27

## Outcome

The V2.0.3 desktop queue fix is implemented, verified, and packaged as the
final isolated Portable candidate. The application remains one lightweight
Wails/WebView2 window around the existing React frontend and Go backend. No
second UI, browser dependency, Node runtime dependency, installer, Bridge
protocol change, or provider request format change was introduced.

## Root Cause

- Native startup restored stale direct-runtime `queued` and `running` tasks as
  executable work. A later Generate click could wake queues from other
  workspaces and make one click appear to create many tasks.
- Ordinary continuous submission had previously been confused with total pool
  capacity, allowing a single click to create 20 or 40 tasks.
- Duplicate UI events could enter submission preparation more than once.
- Task terminal updates and backend `settled` events could arrive in either
  order, so relying on only one event left available capacity idle.
- A local save or post-processing failure could leave a task recorded as
  running even though no more work would complete.

## Implementation

- Native bootstrap converts restored `queued`, `running`, and submitting tasks
  into `interrupted`, clears stale job/launch/queue/retry state, recomputes every
  affected workspace, and never pumps those restored tasks.
- Browser Job Proxy reconciliation is unchanged and may still reattach to real
  background jobs that continue to exist.
- Ordinary continuous submission asserts exactly one newly created task before
  queue state is committed. Batch image-to-image retains source-count behavior.
- `createKeyedSingleFlight()` serializes overlapping `submit()` preparation per
  workspace while allowing independent workspaces to submit concurrently.
- Success, failure, local save failure, submission failure, and backend
  `settled` paths request another pool scheduling pass. Cancelled work retains
  capacity until the backend actually settles.
- Local save/post-processing failures now mark the task failed. The unused
  production pressure-task injection action and pressure prompt constants were
  removed; stress task creation remains test-only.

## Automated Verification

- Focused queue/task/restore/single-flight tests: `49/49`.
- Frontend Node tests: `571/571`.
- Frontend UI tests: `22/22`.
- TypeScript: passed.
- ESLint: `0` errors, `63` accepted existing warnings.
- Windows frontend/Wails production build: passed.
- Desktop Go test and vet: passed.
- CLI Go test and vet: passed.
- Cloudflare Worker tests: `5/5`.
- Release safety scan: `0` issues.
- Portable compliance scan: `0` issues.

The executable single-flight test starts 20 overlapping calls for one workspace
before the first Promise settles and verifies one operation execution. It also
verifies that a new call runs after settlement and that separate workspaces are
independent.

## Offline Native Acceptance

The local delayed Mock returned a fixed valid PNG and never contacted a provider.
Using the CLI shipped in the final Portable:

- exit code: `0`;
- Mock request count: `1`;
- peak active requests: `1`;
- saved PNG: one 68-byte file.

A clean temporary copy of the final Portable opened a visible `FHL Studio`
window. Its process owned only `127.0.0.1:47631`; it did not own `5173` or
`9230`. Bridge `health`, `session`, and authenticated `profile` all reported
API v1, one matching instance, and a ready Images Profile. No job submission was
sent through that Profile.

The production FHL continuous pool accepts only official FHL Profiles. The test
did not broaden that rule or add a hidden test override. Queue concurrency and
restart semantics are therefore proven by offline executable tests, while the
packaged native HTTP/image path is proven by the local Mock.

Photoshop was left open and the same Bridge handshake used by the plugin was
verified. A real Photoshop generation and paste-back was not submitted, so this
record does not claim that visual acceptance step.

## Final Artifacts

Output root:

`发布验证/fhl-continuous-queue-final-20260727`

- EXE size: `20,761,088` bytes.
- EXE SHA-256:
  `FC65F956A3BCC3FBABBFB4CFFB26761DF681DF22BA5464AB5F0DFC5A1DA3825F`.
- ZIP size: `12,125,074` bytes.
- ZIP SHA-256:
  `0F865FC9ECEA730850BC7122A17E70C02761FC7D525FB2B73A628F41A14DD2D0`.
- ZIP entries: `22`.
- ZIP embedded EXE hash matches the directory EXE exactly.

The package contains the required `.fhl-studio-portable` marker, the exact
formal desktop EXE, and the expected CLI EXE. It contains no WebView user data,
Node modules, Debug or installer binary, API Key, generated image, or deprecated
project Skill.

## Cleanup And Rollback

The final Portable acceptance process and local Mock process were stopped after
verification; their Bridge and Mock ports are no longer listening. The existing
Photoshop document was not saved or closed. The Photoshop plugin CCX, source
sharing package, and previous Portable candidates were not overwritten.

Rollback candidate:

`发布验证/fhl-ps-plugin-compatibility-final-20260727`

No real or paid generation request was made in this batch.
