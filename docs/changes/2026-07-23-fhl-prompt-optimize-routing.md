# FHL Prompt Optimization Routing And Yellow Action

Date: 2026-07-23

## User Report

- Desktop `AI 优化` appeared not to use FHL.
- The live error mentioned `banana_special`, which looked like the application
  had selected an image model for prompt optimization.
- The user requested a bright yellow `AI 优化` button.

## Reproduction And Root Cause

- The browser tooltip reported `FHL Responses / gpt-5.5`.
- A minimal live click reached FHL and returned HTTP 503. The upstream message
  said the key group did not have an available distributor for `gpt-5.5`.
- `banana_special` was the FHL-side key group name, not the model sent by the
  application. The request model was `gpt-5.5`.
- The configured Images pool keys can generate images but their current FHL
  group does not authorize the text model required by `/v1/responses`.

## Implementation

- Added `resolvePromptTextSelection` and made the capability UI and runtime use
  the same selection rule.
- Images mode no longer treats its current key as a prompt text API.
- When borrowing a text profile, official FHL Responses is preferred over an
  unrelated Responses profile.
- FHL no-channel failures now state that the request reached FHL and that the
  configured Responses key group lacks the requested text model. The raw
  `banana_special` wording is not presented as if it were the selected model.
- Styled the desktop `AI 优化` action as a stable 38 px bright-yellow button,
  including hover, disabled, loading, light, and dark states.

## Verification

- Focused prompt profile tests: 8 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and the accepted 62 warnings.
- `npm run test:node`: 477 passed.
- `npm run test:ui`: 5 passed.
- Browser computed style: background `rgb(250, 204, 21)`, border
  `rgb(234, 179, 8)`, text `rgb(66, 32, 6)`, minimum height `38px`.
- Browser tooltip: `借用 FHL Responses 文本配置：gpt-5.5`.
- Browser live retry displayed the new FHL text-permission explanation.

## Remaining External Requirement

The existing saved FHL Responses profile still uses a key assigned by FHL to a
group without `gpt-5.5`. The user then supplied a separate text key for an
in-memory, non-persisted test. A minimal `/v1/responses` request using
`gpt-5.5` returned HTTP 200 with `text/event-stream` and the exact output `OK`.
No key value was written to the application, project, logs, or this record.

The next implementation batch is to add a dedicated FHL Responses text-key
section to the configuration window, with a real save-time text response test.
The ten Images pool keys and image scheduling must remain independent.
