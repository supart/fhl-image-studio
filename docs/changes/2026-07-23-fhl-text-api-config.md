# Independent FHL Text API Configuration

Date: 2026-07-23

## Goal

- Add one dedicated FHL Responses credential for prompt optimization and image
  reverse prompting.
- Keep it separate from the ten FHL Images pool credentials, ordinary upstream
  profiles, image scheduling, and Android configuration.
- Test a newly saved text credential with a real `gpt-5.5` text response.

## Implementation

- Added the dedicated `fhl-text-assistant` Keyring credential and fixed it to
  the official FHL Responses endpoint and `gpt-5.5`.
- Added a desktop `FHL 文本 API` configuration section above the ten Images
  slots. It has an empty password field, redacted saved-key hint, delete action,
  fixed model display, and independent save/test states.
- Renamed the Images action to `保存并测试 Images 池`; text and image tests do
  not trigger each other.
- The store keeps only configured state, the redacted hint, and test status.
  Plaintext credentials are read from or written to Keyring only while needed.
- Prompt routing now prioritizes the dedicated text credential for Images,
  APIMart, Responses, and RunningHub desktop states. Without it, the existing
  Responses/APIMart fallback remains in place. Images pool keys are never used
  as text credentials.
- `AI 优化` and image reverse prompting share the same resolver and identify
  the source as `FHL 文本 API：gpt-5.5`. FHL channel errors no longer present an
  internal image-group name as the requested text model.
- Android keeps its existing configuration and fallback behavior.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and the existing 62 warnings.
- `npm run test:node`: 480 passed.
- `npm run test:ui`: 3 files / 7 tests passed.
- `npm run build:windows`: passed; Vite transformed 1935 modules. The build
  retained the repository's existing mixed dynamic/static import and chunk-size
  advisories, with no build error.
- `git diff --check`: passed; Git reported only existing CRLF-to-LF notices.
- A long `sk-...` credential-pattern scan across frontend source, tests, and
  project docs returned zero matches.
- Added direct priority coverage for APIMart, Images, and RunningHub, plus UI
  coverage for an empty password input, redacted saved state, retained failure
  state, and independent save/test controls.
- The first UI run exposed this repository's retained Testing Library renders;
  explicit `cleanup()` isolated each test. The first full Node run exposed an
  obsolete dynamic quick-modal title assertion; it was updated to the fixed
  `FHL API 配置` title. Both suites then passed in full.
- Browser layout QA confirmed the text section above all ten Images slots, the
  fixed model, empty credential input, independent buttons, and no overlap.
- A user-authorized credential was entered only through the local application.
  Save-time testing returned non-empty `gpt-5.5` text and the UI showed
  `配置成功`; no plaintext credential was read back or written to source,
  tests, docs, `.env`, or logs.
- A temporary clean workspace ran `AI 优化` on a short prompt. FHL returned a
  non-empty expanded Chinese prompt, the control identified its source as
  `FHL 文本 API：gpt-5.5`, and the temporary workspace was closed afterward.

## Final State

The implementation, automated checks, Windows production build, save-time live
response test, and end-to-end `AI 优化` acceptance check are complete. No image
generation pressure test or Images pool credential retest was performed in this
batch. The modified dev server remains available at `http://localhost:5173/`.
