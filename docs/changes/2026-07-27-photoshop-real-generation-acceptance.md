# 2026-07-27 Photoshop Real Generation Acceptance

## Scope

Record the real Photoshop generation acceptance against the isolated hardened
V2.0.3 candidate without changing desktop production code or retaining
sensitive request content.

## Runtime And Requests

- Hardened candidate PID 63580 owns the loopback listener on
  `127.0.0.1:47631`. Public `/fhl-ps/v1/health` reports
  `profileReady=true`.
- Two explicitly authorized provider requests were submitted serially. The
  first exposed a Photoshop selection-restoration defect after generation.
- The restoration path was fixed on the Photoshop plugin side before the
  second request. Task `ps-07279...` then completed successfully, and the
  Photoshop plugin wrote the returned result back into the document.
- The Bridge normalized the accepted request as `Auto / 2K / medium` and
  produced PNG output. The temporary task directory was removed after the task
  settled.

## Verification

- No desktop production code changed in this batch.
- Image Studio `go test ./...` passes.
- Go CLI `go test ./...` passes.
- Frontend typecheck passes.
- Frontend Node tests pass `563/563`.
- Frontend UI tests pass `12/12`.

## Privacy And Final State

- This record contains no complete prompt, response, API key or session data.
- Photoshop has been closed and no Photoshop document remains waiting to be
  saved.
