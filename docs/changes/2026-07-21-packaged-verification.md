# 2026-07-21 Packaged Verification

## Scope

- Verify the modified Windows desktop build after the FHL default-2K and FHL API pool capacity changes.
- No real upstream API calls.
- No API keys were read, written, pasted, or copied.
- `config/cli.env.local` was not read.

## Commands And Checks

- Checked port `9230`: no listener before packaged E2E.
- Checked running FHL/Wails processes: none before packaged E2E.
- `wails version`: `v2.12.0`.
- Built from `image-studio`:
  `wails build -platform windows/amd64 -clean -ldflags "-X github.com/yuanhua/image-gptcodex/pkg/client.Version=2.0.2.1"`
- Build output:
  `image-studio/build/bin/FHL Studio 方汤圆版 V2.0.2.1.exe`
- EXE size: `20481536` bytes.
- EXE last write time: `2026-07-21 08:05:18 +08:00`.
- Windows `VersionInfo` fields were blank for this build; the packaged app E2E marker reported `version` and `packageVersion` as `2.0.2.1`.

## Packaged E2E

- Started the built EXE with `--e2e --e2e-port 9230`.
- Process PID: `73264`.
- Browser URL: `http://127.0.0.1:9230/`.
- Page title: `FHL Image Studio 方汤圆版`.
- E2E marker reported:
  - `ready: true`
  - `serverUrl: http://127.0.0.1:9230/`
  - `version: 2.0.2.1`
  - `packageVersion: 2.0.2.1`
  - `commandBridge: postMessage`
- Header FHL config button was present and showed `needs-config` in the packaged no-key state.
- Upstream config dialog showed the FHL Images continuous pool with 10 slots.
- All 10 slot concurrency inputs had `value=5`, `min=5`, `max=5`, `readonly=true`, and `disabled=true`.

## Media Regression

- Created a temporary E2E sandbox input directory under the packaged E2E temp root:
  `input/e2e-smoke`.
- Copied local output images into 10 sandbox test files.
- Ran the packaged E2E `Smoke 10` control:
  - `status: ok`
  - `smokeBatchLoaded: true`
  - `smokeSelected: 10`
  - current image path present
- Ran the packaged E2E `Preview grid` control:
  - `status: ok`
  - `gridSelected: 10`
  - `gridTaskCount: 10`
  - batch result grid text present

## Cleanup

- Attempted browser tab finalization; the browser control call timed out and reset the automation kernel after results were captured.
- Stopped packaged E2E process PID `73264`.
- Rechecked port `9230`: no listener remained.

## Not Run

- Real upstream generation and the 500-image stress test were not run.
- Go race detector was not run.
- Full portable package zip creation was not run in this batch.
