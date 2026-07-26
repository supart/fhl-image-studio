# FHL Pool Save Auto-Test

Time: 2026-07-21 09:06:55 +08:00

## Request

After manually configuring 10 FHL Images API slots, saving the pool should
automatically test connectivity. Successful slots should show "配置成功" in the
API configuration table.

## Implementation

- Changed the FHL Images pool primary save action to "保存并测试".
- After a successful save, the dialog now auto-tests all saved official FHL
  Images pool slots in slot order using the existing `testProfileConnection`
  store action.
- Added transient, non-secret per-slot connection result state:
  - "测试中" while a slot is being checked.
  - "配置成功" when the slot test succeeds.
  - "连接失败" when the slot test fails.
- Editing an API key or slot toggle clears that slot's prior transient test
  result.
- Manual per-slot testing now saves the edited slot without triggering the full
  pool auto-test, then marks only the selected slot.
- Added source-contract assertions for the save auto-test helpers and UI labels.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 62 warnings.
- `npm run test:node`: passed, 474 tests.
- `npm run test:ui`: passed, 2 files / 5 tests.
- `git diff --check`: passed; Git reported only existing CRLF-to-LF warnings
  for touched frontend files.
- Browser verification at `http://127.0.0.1:5173/`:
  - Reloaded the modified dev page.
  - Opened the FHL upstream config dialog.
  - Confirmed 10/10 saved FHL Images pool slots and the "保存并测试" button.
  - Clicked "保存并测试"; the dialog completed the live connectivity check with
    the non-secret summary "FHL Images API 配置测试完成：10/10 个成功。"
  - Confirmed 10 rows showed "配置成功" and 0 rows showed "连接失败".

## Secret Handling

- User-provided API keys were not written to this record, tests, `.env`, logs,
  or chat output.
- Full API key values were not read back or exposed.
- `config/cli.env.local` was not read.
