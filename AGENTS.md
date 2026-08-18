# Codex Workspace Rules

## Development Track

- This is the Windows desktop `V2.0.4` development workspace based on tag `windows-v2.0.3-release` at commit `814da3e64566cc2e7838378639a3c5e7b6e8b948`.
- Make all new Windows desktop changes inside this workspace. Do not modify, clean, rebuild, or copy runtime data from sibling historical or release directories.
- The active UI, desktop package metadata, CLI, EXE, and release tooling use `V2.0.4`; this branch is still local development and must not be published without a separate release decision.
- Keep release storage on the stable `fhl-image-studio-desktop` namespace and Vite development on `fhl-image-studio-desktop-dev`.
- Keep the existing `migration.desktop-v2.0.3` marker unless a new data migration is intentionally designed and tested.
- Preserve the Wails stability contract: imported external images must be materialized into managed package paths, and packaged E2E verification must cover reference previews, batch images, and result previews.
- Record each meaningful batch in `docs/changes`, update `CHANGELOG.md` for user-visible changes, and keep `PROJECT_CONTEXT.md` as the concise current handoff.
- Do not run real or paid image-generation requests unless the user explicitly authorizes that separate verification.
- This V2.0.4 repository uses a local-first Git workflow. Keep `origin` as read-only reference, do not configure a branch upstream, and do not push without explicit authorization.
- Run `scripts\dev-setup.ps1` once after checkout or environment changes. Use `scripts\dev-check.ps1 -Level Fast|Batch|Milestone` for the layered gates.
- Use `codex/windows-v2.0.4-development` for ordinary work and `codex/windows-v2.0.4-feature/<short-topic>` for high-risk cross-module work. Do not rewrite history; use `git revert` for rollback.
- Milestone archives belong outside the repository in the sibling `V2.0.4-开发版\开发归档` directory and must be produced by `scripts\archive-v2.0.4.ps1` from a clean, verified tag.

You are working in the source root for the Windows V2.0.4 development track.

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
- Prefer the outer development launcher for Wails development:
  - `cmd /c "..\..\一键启动V2.0.4开发版.cmd"`
- The package-root `一键启动FHL Studio.cmd` is the version-independent packaged launcher template and is not the development entry.
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
