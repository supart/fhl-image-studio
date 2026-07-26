# Desktop V2.0.2.1 Release Notes

## Summary

V2.0.2.1 is a desktop maintenance update after the V2.0.2 feature set. This build focuses on the aspect-ratio selection fix for FHL Responses / `gpt-image-2` and keeps the V2.0.2 desktop workflow, 360 tools, CLI, Skill, APIMart, and RunningHub bridge capabilities.

## Fixed

- Fixed unstable aspect-ratio matching when using FHL Responses with `gpt-image-2` and explicit size selection.
- Verified real generation results for `1:1`, `16:9`, `9:16`, `2:1`, and `1:2` in the Codex browser workflow.
- Fixed packaged Go/Wails test-mode API configuration drift: `http://127.0.0.1:9230/` now exposes the same local FHL/CLI config endpoints used by the Vite source server, so copied desktop API settings can be read during packaged validation.
- Fixed versioned keyring profile identifiers such as `profile:fhl-image-studio-v2.0.2.1-release:fhl-responses-default`; dots, underscores, and namespace separators are now accepted by the backend credential validator.
- Fixed stale packaged batch state after reload by filtering volatile `memory://` source paths from persisted workspaces and clearing stale batch jobs/results when such sources are dropped.
- Fixed packaged browser batch import fallback so E2E-only browser-selected images must be saved to real package-local input files instead of silently persisting volatile `memory://image` paths.

## Added

- Added desktop E2E test mode for packaged EXE builds. `--e2e` opens the normal desktop window and a localhost browser mirror; `--e2e-only` starts only the browser mirror at `http://127.0.0.1:9230/`.
- Added safe frontend E2E hooks and DOM readiness markers so Codex browser automation can verify packaged UI loading, fill prompts, open settings, and regression-test common desktop flows.
- Added an E2E-only `Load batch dir` browser control for packaged regression testing. Codex can save test images into `input\batch-inputs\...`, paste that directory into the control, click it, and verify the UI shows `10/10` without `memory://`.
- Documented the E2E startup command in `README.md` and `docs/desktop-e2e-test-mode.md`.
- Added global Codex Skill package-root discovery. `安装CodexSkill.cmd` now writes `PACKAGE_ROOT.txt` next to the installed `fhl-image-studio-v2-0-2-1` skill, so new Codex projects can locate the portable package and run `image-cli.cmd` without guessing paths.
- Documented the UI-first workflow: configure and test API in the desktop app first, install the Skill second, then let Codex read CLI status and generate images without receiving API keys in chat.
- Added packaged-regression checks for the `9230` flow: API status must show configured after importing local config, batch file persistence must list real package-local paths, and release zip safety must confirm no `cli.env.local` is included.

## Packaged Regression Checklist

After changing source code and before uploading a Windows portable build, run:

```powershell
cd <source-root>
cd image-studio; go test ./...
cd ..\go-cli; go test ./...
cd ..\image-studio\frontend; node --test test/runtimeHost.test.mjs test/batchSourceSlots.test.mjs test/e2eHarness.test.mjs
cd ..\..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows-portable-v2.0.2.ps1
```

Then start the packaged mirror:

```powershell
$portable = "<release-assets>\FHL-Image-Studio-Desktop-V2.0.2.1-Windows-Portable"
Start-Process -FilePath "$portable\FHL Studio 方汤圆版 V2.0.2.1.exe" -ArgumentList "--e2e-only","--e2e-port","9230" -WorkingDirectory $portable
```

Verify in `http://127.0.0.1:9230/`:

- Header/footer version is `V2.0.2.1`.
- API panel shows configured after local config is present; no API key is printed in logs or CLI status output.
- Batch import persistence uses real paths under `input\batch-inputs\...`, never `memory://image`.
- In E2E mode, use the bottom-left `Load batch dir` control to load a package-local test folder and confirm the page shows `已选 10/10` and `生成（批量生图 10 张）`.
- Reloading the page does not resurrect stale batch tasks, stale `Failed to fetch` results, or volatile batch input directories.
- The portable zip does not contain `config/cli.env.local`, `config/webview`, generated images, logs, or API keys.

## Version Metadata

- Desktop display version: `V2.0.2.1`
- Wails product version: `2.0.2.1`
- Go CLI package version: `V2.0.2.1`
- Go CLI client version / User-Agent: `2.0.2.1`
- Codex Skill name: `fhl-image-studio-v2-0-2-1`
- Windows portable package name: `FHL-Image-Studio-Desktop-V2.0.2.1-Windows-Portable`

## Notes

- No API keys or private local settings should be included in release packages.
- RunningHub remains configured through the local `8117` bridge. RH keys are not written into the desktop package.
