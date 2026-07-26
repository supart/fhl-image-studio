# Photoshop UXP Bridge

## Intent

Add a Photoshop 2023-compatible UXP panel that uses the already configured
FHL Studio desktop process for single-image text-to-image and image-to-image
work. Keep the plugin, temporary media, and release package isolated from the
desktop and Android source trees.

## Safety Boundary

- Do not modify the V2.0.2.1 archive.
- Do not restore the cancelled Windows installer.
- Do not read or log API keys or `config/cli.env.local`.
- Do not perform paid image generation during automated acceptance.
- Preserve the current V2.0.3 Portable ZIP and hashes before rebuilding.

## Implementation Status

- [x] Pre-bridge Portable archive and hash manifest
- [x] Loopback bridge lifecycle, authorization, idempotency, and job tests
- [x] Active desktop profile synchronization without credentials
- [x] Independent UXP project, reference slots, selection workflow, and result placement
- [x] Plugin unit/syntax/manifest/package verification and Photoshop 2023 manual checklist
- [x] Development CCX packaging, payload safety scan, documentation, and hash
- [ ] Wails binding regeneration, full desktop verification, and Portable rebuild
- [ ] Photoshop 2023 manual load/placement matrix and UXP Developer Tool package

## Resume Point

Continue from the first unchecked item. Re-run the smallest focused test after
each implementation batch, and update this record before any long build.

## Archived Baseline

- ZIP: `release-assets/archive/pre-photoshop-bridge-20260725/FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable-pre-ps-bridge.zip`
- ZIP SHA-256: `28D1ECFF218ECE8CB0A902D33D4C54AEEF4AFA79A994071CC9F09B51CC347130`
- Contained EXE SHA-256: `F0C8C0889AC0A982ABC736D87CBBAE4B9D141862306EA5C77EAA4CA4786F2AE3`

## Backend And Desktop Runtime Batch

- Added the in-process PS Bridge with the approved `47631-47640` loopback port
  range and seven HTTP routes. The bridge keeps one active task, makes
  `clientTaskId` retries idempotent, and retains the latest 50 terminal jobs.
- Public HTTP profile data contains provider/model/capabilities only. Base URL,
  proxy, Keyring user, and API key remain inside the desktop process.
- Added Wails profile synchronization and remote-provider execution. APIMart
  credentials are read once per task and scrubbed from retained source objects;
  RunningHub does not request a credential. Both use concurrency 1.
- Desktop history now records output media plus Photoshop document/layer/crop
  metadata, without persistent Blob/Base64 source images.
- Added focused Go and Node tests for port avoidance, loopback/origin checks,
  token rotation, profile redaction, missing credentials, 10-image limit,
  concurrent idempotency, single-task cancellation, result serving, remote
  credential isolation, history conversion, and provider mask behavior.
- Batch verification passed: `go test ./backend`, `npm run typecheck`, and
  `node --test test/psBridgeRuntime.test.mjs` (4/4).

## Independent Plugin Batch

- Added `FHL-Image-Studio方汤圆版-PS插件开发` at the repository root with an
  isolated manifest, panel UI, Bridge client, Photoshop adapter, pixel crop
  pipeline, tests, documentation and packaging scripts.
- The plugin implements one active task, text/image modes, selection prompts,
  target and ordered reference slots, submission-time recapture, 10-image
  limit, bounded alpha trimming, placement modes and metadata-only history.
- Added exact manifest validation for Photoshop 2023, local file permission,
  the `127.0.0.1:47631-47640` allowlist and 1x/2x icon dimensions.
- Corrected compact size values to desktop-compatible exact pixels, froze the
  real selection mask before other captures, corrected its alpha orientation,
  and coupled selection mode to image-edit mode.
- Verification passed: plugin tests 16/16, JavaScript syntax, manifest, source
  safety scan and CCX payload scan.
- Unsigned development CCX: 83,857 bytes; SHA-256
  `B9597881E5E40CFB02C2237939D112B64DB405077FCC0DB06996363D6557B1A8`.
- No real generation, credential read, upstream request or user image access
  occurred. Photoshop 2023 and UXP Developer Tool acceptance remain pending.
