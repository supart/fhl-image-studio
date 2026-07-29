# Photoshop Free Images Mask Fallback

Date: 2026-07-28

## Diagnosis

The Photoshop plugin used during the accepted July 26 selection-edit run and
the current sideload contain the same task planning behavior. Historical saved
PS response logs prove that the older runtime received successful image data.
The old staged desktop source also advertised masks for Images profiles and
enabled the FHL Images compatibility transport, so this was not caused by a
separate plugin or a missing desktop code merge.

The current upstream account/runtime now returns an explicit SSE error:
`mask is not supported by free gpt-image edits`. The desktop Bridge still
advertised `supportsMask=true`, causing the otherwise-correct plugin to attach
the selection mask. The desktop SSE parser then discarded the structured error
and reported `no image base64 in response`; the broad retry marker submitted the
same non-retryable request three times.

## Changes

- The Bridge now advertises mask support for Responses profiles.
- Standard custom Images profiles retain mask support.
- Official `https://www.fhl.mom` Images profiles and Images new-API
  compatibility profiles advertise `supportsMask=false`.
- The Photoshop plugin already handles this public contract by sending the
  prepared selection crop without an upstream mask. Its frozen Photoshop
  selection and local result-layer mask remain unchanged.
- Images and common SSE collectors now preserve nested upstream error message,
  type and code instead of collapsing them to the no-image sentinel.
- `invalid_request_error` responses containing `mask is not supported` are
  classified as non-retryable.

## Verification

- Focused Bridge and client tests passed.
- Full `go test ./... -count=1` passed in both `image-studio` and `go-cli`.
- Photoshop plugin task-plan tests passed `8/8`, including the crop-without-mask
  fallback.
- The rebuilt Wails development Bridge is PID `32252` on `127.0.0.1:47631`.
  Its live public Profile is ready, uses Images / `gpt-image-2`, and reports
  `supportsMask=false`.
- Photoshop PID `31136` has an established loopback connection to the rebuilt
  Bridge.
- No provider generation request was submitted during this batch.

## Release State

The old AE7DA252...ACB17 candidate and every prior Portable remain untouched.
The current development runtime is ready for one manual Photoshop selection
edit acceptance. Do not rebuild or promote a Portable until that manual result
returns and pastes back correctly.
