---
name: fhl-image-studio-v2-0-3
description: Use when Codex should generate or edit images through a local FHL Studio V2.0.3 package on macOS or Windows, inspect the active GUI-synced profile, or run the bundled image CLI across FHL Images API, APIMart, and RunningHub bridge profiles.
---

# FHL Studio V2.0.3 Local CLI

Use this package CLI instead of another image generator when the FHL Studio workflow applies.

## Resolve the package root

Use the first matching location:

1. The current directory when it contains `image-cli` or `image-cli.cmd`.
2. `PACKAGE_ROOT.txt` beside this installed `SKILL.md`, when its path contains a launcher.
3. `FHL_IMAGE_STUDIO_HOME`, when it contains a launcher.

Do not run a launcher from an unrelated project. The resolved package and the desktop GUI share the active profile, input, output, and log policy.

## Select the platform launcher

macOS:

```bash
cd "<packageRoot>"
./image-cli --status --json
```

Windows:

```cmd
cmd /c "cd /d ^"<packageRoot>^" && image-cli.cmd --status --json"
```

On macOS the launcher reads `~/Library/Application Support/fhl-studio/cli.env.local`, writes images under `~/Pictures/FHL Studio`, and writes logs under `~/Library/Logs/FHL Studio`. On Windows Portable it reads `config\cli.env.local` and uses the package-local input, output, and log directories.

## Configure in the GUI first

1. Open FHL Studio.
2. Select FHL, APIMart, or RunningHub.
3. Enter the user's API credential in the GUI and run its connection test.
4. Run the status command again before generating.

Never ask the user to paste an API Key into chat. Never print or infer a stored credential. The status response only reports whether a credential is configured.

## Read status

Treat `--status --json` as the source of truth for:

- `packageVersion`
- `apiMode`
- `baseURL`
- `requestPolicy`
- `textModel`
- `imageModel`
- `size`
- `quality`
- `inputDir`
- `outputDir`
- `rawDir`
- `apiKeyConfigured`
- `apiKeySource`

When `apiMode` is `runninghub`, the key remains in the local bridge and `apiKeySource` should be `bridge`.

## Run image commands

The examples below use macOS syntax. On Windows pass the same arguments after `image-cli.cmd`.

Text to image:

```bash
./image-cli --prompt "cinematic portrait" --size 1024x1024 --quality medium
```

Image edit:

```bash
./image-cli --mode edit --image "input/ref.png" --prompt "keep the subject identity and change the scene"
```

Multiple references:

```bash
./image-cli --mode edit --image "input/main.png" --image "input/ref2.png" --prompt "use the first image as the subject and the later images as references"
```

## Provider behavior

- APIMart submits an image task, polls `/v1/tasks/{task_id}?language=zh`, and downloads the completed result without resubmission.
- RunningHub uses the configured local bridge, normally `http://127.0.0.1:8117`, and does not require a local CLI API Key.
- FHL prompt optimization uses the separately configured text API; Images keys are not reused for text requests.

## Concurrency

- The default CLI execution stays sequential.
- Default to one CLI task at a time.
- For image-to-image, story, or character-consistency batches, generate the first accepted reference sequentially.
- After the anchor exists, ask whether to continue sequentially or in parallel.
- Parallel work must not exceed the current GUI/profile concurrency limit.

## Return results

Read the final JSON stdout. Important fields include `ok`, `imagePath`, `rawPath`, `sourceEvent`, and `elapsedSec`.

After every successful command, return the generated image to the conversation using its absolute local path. For multiple results, return each image as it completes. On failure, summarize the error and include `rawPath` when available.

Useful log locations:

- macOS: `~/Library/Logs/FHL Studio/cli`
- Windows Portable: `output\log`
