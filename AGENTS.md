# Codex Workspace Rules

## Development Track

- This workspace now builds the formal desktop `V2.0.3` release from the tested V2.0.2.1 Wails baseline plus the verified July changes.
- The user-facing desktop package, CLI, Skill, and EXE version are `V2.0.3`; Android remains on its existing version.
- Release artifacts use the stable `fhl-image-studio-desktop` namespace; Vite development uses `fhl-image-studio-desktop-dev`.
- Preserve the Wails stability contract: imported external images must be materialized into managed package paths, and packaged E2E verification must cover reference previews, batch images, and result previews.

You are working in the portable package root for FHL Studio V2.0.3.

## Preferred local tool

- Prefer the local `image-cli.cmd` in this package root for image generation work.
- Do not prefer built-in image generation when this local CLI workflow applies.
- The active upstream is controlled by `config\cli.env.local` when present.
- `config\cli.env.example` is only the fallback example; do not treat it as the current user choice if `cli.env.local` exists.

## Upstream and profile behavior

- This package can target `FHL Images API`, `APIMart`, and `RunningHub` bridge profiles.
- The desktop UI is the source of truth for the active profile.
- The UI syncs `baseURL`, `apiMode`, `requestPolicy`, `imagesNewAPICompat`, model IDs, size, quality, and output format into `config\cli.env.local`.
- RunningHub CLI profiles use the local bridge URL and do not require a local API key; the key stays in the bridge module.
- Shared concurrency is a UI/profile concept. The CLI should be used sequentially by default.
- For image-to-image or character-consistency sets, generate the first reference/anchor image first. After that, ask the user whether the remaining images should continue sequentially or run in parallel up to the current profile concurrency limit.

## Run flow

- Run commands through Windows `cmd /c`.
- Prefer the package-root launcher for UI-first setup:
  - `cmd /c "一键启动FHL Studio V2.0.3.cmd"`
- Use the local CLI from the package root:
  - `cmd /c "image-cli.cmd" --prompt "test prompt"`

## UI-first configuration

- Do not ask the user to paste API keys into chat.
- If the user already says the desktop UI connection test succeeded, use the local CLI directly from `config\cli.env.local`.
- If the CLI reports a missing key or wrong upstream, send the user to the desktop UI first.
- The correct fix is usually: open the UI, switch to the intended profile, paste the user's own API key there, and run a connection test or one generation so `cli.env.local` is refreshed.

## Paths and outputs

- Input images live under `input\` by default.
- Final generated images are written under `output\`.
- Raw upstream logs are written under `output\log\`.
- Intermediate preview images may appear under `intermediate\`.

## Result handling

- Read the final JSON result from CLI stdout.
- Important fields include `ok`, `imagePath`, `rawPath`, `sourceEvent`, and `elapsedSec`.
- Every time a Codex CLI image command succeeds, return the generated image in the Codex conversation using a Markdown image tag with an absolute local path.
- For multiple images, post each completed image back to the conversation; do not only list file paths at the end.
