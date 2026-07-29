# Photoshop Plugin Compatibility Candidate

Date: 2026-07-27

## Goal

Build the current V2.0.3 desktop source into a new isolated Portable candidate
for compatibility testing with the already packaged Photoshop plugin. Do not
confuse the browser development page on port 5173 with the native Bridge.

## Candidate

- Root:
  `发布验证/fhl-ps-plugin-compatibility-final-20260727`
- Portable directory:
  `FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable`
- EXE size: 20,762,112 bytes
- EXE SHA-256:
  `7BC8CA86365B3EAED5ED3B20B1625CEA6E7E5F3A92949E282F35348477373C52`
- ZIP size: 12,125,524 bytes
- ZIP SHA-256:
  `2D9EBCC07CB83BA47DD08BD848A319F1F417CF187F367091374A2561F15DC954`

## Verification

- Full CLI and Wails production build: passed.
- Portable marker and exact formal EXE name: present.
- Root-level desktop EXE count: one.
- Deprecated `SKILL.md` and `*CodexSkill.cmd` assets: zero.
- Package compliance scan: zero issues.
- New desktop PID `22604` is visible and listens only on loopback Bridge port
  `47631`.
- `GET /fhl-ps/v1/health`: service `fhl-studio-ps-bridge`, API v1, `ok=true`.
- `POST /fhl-ps/v1/session`: API v1 and the same Bridge instance ID.
- Authenticated `GET /fhl-ps/v1/profile`: expected HTTP 503 because this clean
  Portable has not yet been configured (`profileReady=false`).
- Photoshop PID `31136` remained open and its document was not saved or
  closed. The prior desktop PID `47484` was closed only after the new package
  passed checks.

## Manual Resume Point

1. In the visible new FHL Studio window, configure and test at least one API.
2. Confirm Bridge health changes to `profileReady=true`.
3. In Photoshop, open the installed FHL Studio plugin and reconnect. Selecting
   a desktop directory is unnecessary while the Bridge is already visible; if
   a directory is requested, choose this candidate Portable root.
4. Verify Profile/model display, then submit only the user's intended manual
   compatibility generation.

Computer Use could activate the Photoshop window but Photoshop 2023 exposed no
readable UXP panel accessibility tree. No blind clicks were made. No provider
probe, generation request, paid API call, Photoshop save or plugin-package
mutation was performed by Codex.
