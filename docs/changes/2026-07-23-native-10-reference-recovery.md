# Native 10-Reference FHL Edit Recovery

## Failure Evidence

- The current 10-reference WebP toy request has no successful output file.
- Six visible task records failed on `FHL-1 Images`.
- FHL first returned a temporary-unavailable response, then no-compatible-
  account / no-active-token responses across retries.
- The retained success visible as `1/7` belongs to an earlier architecture
  edit and is not evidence that the current toy request succeeded.

## Desktop And Plugin Comparison

- Both send the first source with multipart field `image` and the remaining
  sources with `image[]`.
- The plugin sends `quality=auto`, `response_format=b64_json`, and no streaming
  fields.
- The plugin can move a retryable task to another healthy worker. The desktop
  previously retried the same task on the same FHL slot.

## Changes

- FHL `gpt-image-2` multi-reference edits now use the plugin-compatible
  non-streaming request contract while preserving the exact requested size.
- FHL `gpt-image-2` multi-reference edits are excluded from the legacy
  contact-sheet fallback. References remain independent uploads.
- The initial single-output task remains pinned to the first enabled API.
- A transient multi-reference failure uses the existing one-time automatic
  retry on the next enabled FHL slot with effective capacity.
- Runtime CLI rebuilt as product version `V2.0.2.1`.

## Verification

- Focused Go tests passed, including request routing, multipart fields, and
  no-contact-sheet behavior.
- Full Go CLI tests and `go vet ./...` passed.
- Focused scheduler/store tests passed: 14/14.
- TypeScript typecheck passed.
- Focused ESLint passed with no errors and only existing warnings.
- No real upstream request was launched after the fix.

## Full Verification

- Frontend Node tests: 514 passed.
- Frontend UI tests: 10 passed across 4 files.
- TypeScript typecheck passed.
- ESLint passed with 0 errors and 62 existing warnings.
- Windows frontend build passed with 1944 transformed modules.
- Both Go modules passed full tests and vet.
- Full diff whitespace check passed.
- Local browser remained healthy after HMR with no console warnings/errors.

## Plugin Live Attempt

- The installed `fhl-image-gen` v0.2.1 plugin loaded all ten supplied WebP
  references in the requested order as one native multi-reference edit.
- The request asked for one `9:16` `2K` result at concurrency `1`; no batch edit
  or contact-sheet path was used.
- Attempt 1 on `fhl-1` returned HTTP 503 temporary unavailable. The plugin's
  retry router moved the task through `fhl-2`, `fhl-3`, and `fhl-4`, which all
  returned HTTP 503 `No available compatible accounts`.
- The run ended with zero successful images and no saved output. Source loading
  and worker failover behaved as designed; upstream compatible-account capacity
  was unavailable.
- No manual second request was made after the built-in retry budget was spent.

## Success Boundary Follow-Up

- A bounded sequential ladder tested 2, 5, 8, and 9 references with the same
  amusement-park composition request at `9:16`, `2K`, and concurrency 1.
- All four input counts returned valid raw `1152x2048` PNG outputs.
- Two, five, and nine references succeeded on `fhl-1` without retry. Eight
  references received one temporary HTTP 503 on `fhl-1` and then succeeded on
  `fhl-2` through the plugin's built-in worker failover.
- Visual inspection confirmed independently recognizable subjects matching the
  requested input count. None of the outputs was a contact sheet.
- Nine is the highest confirmed successful count from this test. The earlier
  ten-reference compatible-account-pool failure is still an upstream capacity
  result, not proof of a ten-reference model limit.
