# API Credential Library And Secure Wipe

## Batch Start

- User goal: provide one fixed place in desktop configuration for managing all
  configured APIs, plus one action that actually removes the machine's API
  credentials before leaving a temporary computer.
- The current 397-source live batch must not be interrupted. Latest isolated
  count before implementation: 134 results, 4 running, 259 queued, 0 failed,
  and 0 final-image-missing.
- Do not edit live frontend modules or restart Vite until that batch has
  finished. Documentation, source inspection, and test design may continue.

## Intended Behavior

- Add a fixed, non-secret credential inventory to desktop API configuration.
- Include dedicated FHL text, FHL Images pool slots, ordinary/APIMart profiles,
  legacy entries, browser fallback storage, local CLI credential files, and a
  reachable RunningHub bridge in the secure-wipe flow.
- Block secure wipe while any image task is queued, submitted, or running.
- Require an explicit confirmation and never display plaintext credentials.
- Delete and verify credentials before removing profile metadata. A partial
  failure must be reported as a failure, with metadata retained for retry.
- Do not delete history, generated images, presets, workspaces, or ordinary
  application settings.

## Resume Point

- Recheck the isolated 397-task count in the `localhost` tab.
- Once no current task is queued or running, implement the smallest store,
  helper, UI, and test changes without touching unrelated provider behavior.
- Never click the real secure-wipe action during QA because the user's ten
  saved keys are live credentials. Test deletion with mocks and source/UI
  contracts only.

## Implemented

- Added a fixed `本机 API 凭据库` section above FHL text and Images settings.
  It shows non-secret counts and profile names for FHL text, FHL Images,
  ordinary/APIMart profiles, and RunningHub bridge profiles.
- Added `一键清空全部 API` with an explicit irreversible confirmation. The
  action is disabled while generation, queued tasks, API tests, optimization,
  or reverse prompting use credentials.
- Added a verified deletion transaction. It removes and reads back every known
  Keyring/browser credential target before deleting profile metadata. Partial
  Keyring, RunningHub, or local-file failure keeps metadata for retry and does
  not report success.
- Added current-origin browser fallback cleanup, including orphaned browser-key
  namespaces and legacy API-key entries while preserving ordinary settings.
- Added RunningHub bridge clearing through `POST /api/config` with an empty key
  followed by a `GET` verification. A bridge that still reports a configured
  key fails the wipe.
- Added Wails `ClearLocalCredentialFiles`, which removes portable
  `config/cli.env.local` and the source/dev FHL override when present. The
  operation is idempotent and does not remove ordinary config files.
- Changed the desktop settings shortcut from the misleading current-profile
  `清除 API Key` action to `管理 API 凭据`. Android retains its existing flow.

## Verification So Far

- TypeScript typecheck passed.
- ESLint passed with 0 errors and the existing 62 warnings.
- Pure credential inventory/deletion tests: 4 passed.
- Secure-wipe transaction tests: 4 passed.
- Browser fallback/local-file cleanup tests: 5 passed.
- RunningHub clear-and-verify tests: 3 passed.
- Credential library source contract: passed.
- Credential library UI tests: 3 passed.
- Focused Go credential cleanup and DesktopAPI binding tests passed.
- Browser UI inspection passed: the fixed inventory is visible, no plaintext
  key is rendered, and the destructive button is disabled during the live run.
- The real wipe was not clicked.

## Live Batch And Next Breakpoint

- Latest isolated state: 397 total, 120 currently hydrated result tiles,
  158 `succeeded_no_image` display placeholders, 4 running, 115 queued, and
  0 explicit failed tiles. Output files continued increasing (265 images for
  the day at the last disk check).
- The display placeholders appeared after a development-page reload because
  bootstrap hydrates at most 120 history items. They do not prove output-file
  deletion; this pre-existing history hydration limit is outside this change.
- Do not edit `vite.config.ts` or restart the server while those 115 tasks are
  queued. The remaining development-browser work is the
  `DELETE /__image-studio-local-config/api-library` handler that removes the
  same two local files. Packaged Wails already uses the verified native method.
- After the live queue is empty: add the Vite handler, run full Node/UI/Go
  checks plus build and diff check, inspect the enabled confirmation UI with
  mocked credentials only, and never execute the real wipe against user keys.

## Origin Fix Completion

- The live batch reached zero queued and zero running tasks before source
  changes resumed.
- Added the missing Vite development DELETE handler. It removes both fixed
  credential files and verifies neither still exists before returning success.
- Added pre-bootstrap canonical loopback navigation. Development pages opened
  through `localhost` or IPv6 loopback move to the configured canonical host,
  which defaults to `127.0.0.1`.
- Browser acceptance confirmed automatic navigation and restored the preserved
  FHL Images inventory: credential library `10/10`, pool `10/10`, ten enabled
  slots. The real secure-wipe action was not invoked.
- Focused typecheck, tests, lint, and diff validation passed. Full verification
  is tracked in `PROJECT_CONTEXT.md`.
