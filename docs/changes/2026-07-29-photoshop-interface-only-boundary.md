# Photoshop Interface-Only Boundary Audit (2026-07-29)

## Confirmed Policy

The independently sold Photoshop plugin uses the desktop only through the
local Bridge v1 HTTP interface. It is not a desktop source dependency, build
input or GitHub Release artifact.

## Audit

- `rg --files` found no plugin source, CCX, installer or sales payload in the
  desktop source tree. Matches were Markdown compatibility/history records.
- `scripts/prepare-release-source-v2.0.3.ps1` resolves the desktop source root
  and copies only fixed root files plus whitelisted desktop directories. The
  sibling plugin project is outside that root and is not traversed.
- Stable desktop documentation now records the supported plugin version and
  Bridge contract without mirroring current commercial package hashes.

Historical change records may mention earlier plugin compatibility evidence,
but they do not contain the plugin runtime source or distributable payload.

## Verification

- Documentation-only change.
- `git diff --check` passed for the touched desktop documents.
- No runtime, package, credential or provider request changed.
