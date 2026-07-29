# Photoshop Plugin Commercial Project Boundary (2026-07-28)

## Decision

The Photoshop plugin is an independently sold, maintained and distributed
project. It will not be uploaded to the desktop GitHub repository. The desktop
project continues to support it only through the local Bridge v1 interface and
records the compatible plugin version. There is no source import, shared build
step or release-artifact dependency between the two projects.

## Documentation Changes

- Added `docs/photoshop-plugin-compatibility.md` as the stable public boundary
  and compatibility record.
- Updated the desktop README, documentation index, project structure,
  CHANGELOG, V2.0.3 release notes and current-stage summary.
- The desktop repository documents Bridge implementation, profile capability,
  task lifecycle, Portable launch contract and compatibility tests.
- Plugin source, CCX, direct-install payload, installer/uninstaller, Internet
  share bundle, sales material and order data remain outside the desktop repo,
  source archive, Portable ZIP and GitHub release.
- The independent plugin delivery may contain its own corresponding source as
  required by its license without using desktop GitHub as the plugin download
  or source-hosting channel.

## Verification

- Documentation-only change; no desktop or plugin runtime file changed.
- `git diff --check` passed for the touched desktop documentation.
- No credential, API configuration, user data or provider request was used.
