# Codex Workspace Rules

## Development Track

- Desktop, CLI, Skill, source package, and finished packages are version `V2.0.3`.
- Windows uses Wails/WebView2 and a Portable ZIP. macOS uses Wails/WKWebView, Apple Silicon, macOS 13+, and a DMG.
- macOS keeps native host capabilities but intentionally renders the Windows-parity Fluent desktop UI.
- Imported external images must be materialized into managed paths. Packaged E2E checks must cover reference previews, batch images, and result previews.

## Local CLI

- On macOS use `./image-cli`; on Windows use `image-cli.cmd` through `cmd /c`.
- Prefer this local CLI when the FHL Studio image workflow applies.
- The desktop UI is the source of truth for the active FHL, APIMart, or RunningHub profile.
- The macOS GUI syncs the active profile to `~/Library/Application Support/fhl-studio/cli.env.local`; Windows Portable syncs to `config\cli.env.local`.
- Never ask the user to paste an API Key into chat, and never print a stored key.

macOS status:

```bash
./image-cli --status --json
```

Windows status:

```cmd
cmd /c "image-cli.cmd --status --json"
```

## Profile Behavior

- The GUI syncs base URL, API mode, request policy, compatibility mode, models, size, quality, and output format into the private CLI configuration.
- RunningHub uses the local bridge and keeps its API Key inside that bridge.
- CLI execution is sequential by default. For reference-dependent batches, generate the first anchor before asking whether later tasks should run sequentially or within the current profile limit.

## Data Locations

macOS:

- Images: `~/Pictures/FHL Studio`
- Private configuration: `~/Library/Application Support/fhl-studio`
- Logs: `~/Library/Logs/FHL Studio`

Windows Portable:

- Inputs: `input\`
- Outputs: `output\`
- Logs: `output\log\`
- Intermediate files: `intermediate\`

## Result Handling

- Read the final JSON stdout fields including `ok`, `imagePath`, `rawPath`, `sourceEvent`, and `elapsedSec`.
- Return each completed image to the Codex conversation using its absolute path.
- On failure, summarize the error and include `rawPath` when present.
