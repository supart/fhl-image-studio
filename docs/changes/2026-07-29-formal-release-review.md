# V2.0.3 Formal Release Review Conversion

## Intent

Convert the cross-computer-tested V2.0.3 delivery into a formal GitHub review set while preserving the verified Portable runtime byte-for-byte. This batch prepares local artifacts only and does not publish them.

## Baseline And Rollback

- Baseline directory: `FHL-Image-Studio-V2.0.3-预发布跨电脑测试-20260729`.
- Rollback: the baseline directory and its outer ZIP remain untouched.
- The browser development configuration on port 5174 is outside the delivery and is neither copied nor deleted.
- The independent Photoshop plugin delivery is intentionally excluded.

## Planned Verification Batch

1. Align only release automation and release documentation; do not change React, Go, Bridge, or provider runtime behavior.
2. Run frontend Node/UI tests, TypeScript, ESLint, and the Windows frontend build.
3. Run desktop and CLI Go tests/vet plus Cloudflare Worker tests.
4. Run compliance, credential, private-path, plugin-exclusion, and archive-integrity scans.
5. Create the formal source ZIP, record final sizes and SHA-256 values, then update the acceptance report and review documents.

## Initial Artifact Integrity

- EXE: 20,770,304 bytes; SHA-256 `0FCFC0DE8078393EF38F13C1877F523975793D6C8BEACA0756C9DC6FC37FD8E6`.
- Portable ZIP: 12,131,016 bytes; SHA-256 `45B7BCB232F967531A8BE03FFD784A31754EE3E1EB6BA33120A3B29B68182FF1`.
- Copied review artifacts matched the tested baseline before verification began.

## Verification Checkpoint

- Local toolchain: Node.js 24.13.1, npm 11.8.0, Go 1.26.4, Wails v2.12.0. GitHub automation remains pinned to Go 1.26.3.
- `npm ci` installed 324 packages from the committed lockfile.
- A first parallel run reached desktop Go setup before the Windows frontend build and stopped because `frontend/dist` is intentionally absent from the clean source archive. The batch was reordered to build embedded frontend assets first; no product source change was made for this setup failure.

## Final Verification

- Node behavior tests: 581/581. UI tests: 24/24 in 8 files.
- TypeScript passed; ESLint passed at 0 errors and 63 accepted warnings.
- Windows frontend build passed with 1,956 transformed modules.
- Desktop and CLI Go test/vet passed; Worker tests passed 5/5.
- Compliance and release safety scans reported 0 issues. Private paths, runtime configuration files, plugin payloads, and installer payloads were absent.
- The formal EXE and Portable ZIP still match the accepted cross-computer artifacts byte-for-byte. No paid request was made.

## Handoff

- The review set is ready for a human publication decision. It is intentionally not a Git repository release yet: no commit, tag, push, or GitHub Release was created.
- Final source and review-archive hashes are maintained outside the source tree to avoid changing the archive after it is checked.
- A final same-device launch confirmed that a clean Portable archive does not contain credentials, but an extracted runtime creates `config/webview` and can recognize credentials already held by that Windows account's Credential Manager. This is compatible upgrade behavior, not credential packaging. Publish the verified ZIP, never a locally launched extracted folder.
