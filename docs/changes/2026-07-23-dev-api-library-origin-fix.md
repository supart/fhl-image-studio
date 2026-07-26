# Development API Library Origin Fix

## Problem

- Ten previously configured FHL Images API slots appeared as `0/10` when the
  development app was opened through `http://localhost:5173/`.
- The slots were not deleted. They remained present under
  `http://127.0.0.1:5173/`.
- Browser profile metadata and browser fallback credentials use origin-scoped
  storage, so the two loopback hostnames produced two independent inventories.

## Change

- Added a small pre-bootstrap redirect that normalizes loopback development
  URLs to the configured canonical host before the store reads any profiles.
- The canonical host is injected by Vite and defaults to `127.0.0.1`, matching
  the development launcher.
- Added the missing development secure-wipe endpoint for the two fixed local
  credential files. It verifies deletion before returning success.
- Added focused tests for URL preservation, non-loopback isolation, redirect
  behavior, and the Vite deletion contract.

## Live Acceptance

- Waited for the existing 397-source batch to reach zero queued and zero
  running tasks before editing live modules.
- The open browser tab automatically moved from `localhost` to `127.0.0.1`.
- The credential library displayed FHL Images `10/10`.
- The Images pool displayed `10/10` filled and ten enabled pool switches.
- No plaintext credential was read or rendered, and the real secure-wipe
  action was not executed.

## Verification

- Focused TypeScript typecheck passed.
- Nine focused origin and local credential-clear tests passed.
- Focused ESLint and `git diff --check` passed.
- Full verification passed: 509 Node tests, 10 UI tests, TypeScript typecheck,
  ESLint with 0 errors and the existing 62 warnings, Windows production build,
  both Go module tests/vet, backend repeated tests, and full diff validation.
- Final browser inspection showed `10/10` in both inventory surfaces, all ten
  slots enabled, and no browser console error.
