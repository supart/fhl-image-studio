# FHL Studio Windows V2.0.3 发布交接记录

## Current State

- 发布基线：`FHL-Image-Studio-V2.0.3-正式发布审核版-20260729`。
- Source baseline: the cross-computer-tested V2.0.3 prerelease package dated 2026-07-29.
- Runtime artifact policy: preserve the tested Portable EXE and ZIP byte-for-byte; do not rebuild or replace them in this review batch.
- GitHub target: Windows-only branch `release/windows-v2.0.3` and tag `windows-v2.0.3`; this branch is prepared from the verified formal-review source, not from the working development tree.
- Photoshop policy: the independent paid plugin is not part of this repository, source archive, or Release asset. Only Bridge compatibility code and documentation remain.

## Active Batch

- Align GitHub CI and Release toolchains with the verified development toolchain.
- Refresh V2.0.3 release and acceptance documentation.
- Run frontend, Go, Worker, compliance, credential, private-path, and archive-integrity verification without a real or paid generation request.
- Produce the exact Windows source ZIP, Portable ZIP checksum file and Chinese release copy for GitHub publication.

## Verified Runtime Baseline

- Tested EXE SHA-256: `0FCFC0DE8078393EF38F13C1877F523975793D6C8BEACA0756C9DC6FC37FD8E6`.
- Tested Portable ZIP SHA-256: `45B7BCB232F967531A8BE03FFD784A31754EE3E1EB6BA33120A3B29B68182FF1`.
- The copied formal-review EXE and Portable ZIP matched those hashes before source edits.
- The prerelease delivery contained no `cli.env.local`, `fhl-api.local.json`, `browser-jobs.v1.json`, WebView profile, generated output, or user API configuration.

## Resume Point

If work is interrupted, resume by checking this file and `docs/changes/2026-07-29-formal-release-review.md`. Re-run the verification commands before updating final counts and hashes. The untouched prerelease directory and ZIP are the rollback source.

## Verification Checkpoint

- `npm ci` completed with 324 packages installed from the lockfile.
- The first parallel verification attempt exposed the expected clean-source ordering constraint: desktop `go test ./...` stopped at `main.go:25:12: pattern all:frontend/dist: no matching files found` because the release source intentionally excludes built frontend assets.
- This is a verification-order failure, not a runtime test failure. Resume by running `npm run build:windows` in `image-studio/frontend`, then rerun desktop and CLI Go tests/vet plus all frontend and Worker checks.

## Completed Verification

- Frontend: 581/581 Node tests, 24/24 UI tests, TypeScript, and Windows production build passed. ESLint passed with 0 errors and 63 accepted warnings.
- Desktop and CLI Go test/vet passed; Worker tests passed 5/5.
- Source compliance and Portable folder/ZIP safety scans passed with 0 issues.
- Private-path and Photoshop payload checks passed. Validation-only `node_modules` and `frontend/dist` were removed.
- No real or paid generation request was made.

## Windows Release Verification

- The user authorized the Windows GitHub publication. This source branch is Windows-only and must never be merged into, or used to replace, macOS `v2.0.3` / `v2.0.3.1`.
- The Windows Portable EXE and ZIP remain byte-for-byte identical to the accepted cross-computer test package.
- The corresponding Windows source archive is generated from this clean tree after removing validation-only dependencies and build assets. Its final checksum is published with the Portable ZIP in `SHA256SUMS.txt`.
- The review directory contains the GitHub source, Release attachment, review checklist, release copy, and checksums only; it excludes the separate Photoshop plugin delivery.
- Post-review launch observation: the immutable Portable ZIP is clean, but a launched extracted folder creates package-local WebView data. The Windows Credential Manager service name is shared intentionally so an upgrade on the same Windows account can reuse existing FHL Studio credentials; a new Windows account or computer starts without those credentials. Do not redistribute an already launched extracted folder; distribute the verified Portable ZIP.

## Release Record

- Detailed Windows GitHub release record: `docs/changes/2026-07-29-github-windows-v2.0.3-release.md`.
- Rollback: retain the untouched formal-review directory and remove only the independent Windows release/tag/branch if required. Never edit the macOS releases.
