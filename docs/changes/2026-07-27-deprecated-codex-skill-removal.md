# Deprecated Codex Skill Removal

Date: 2026-07-27

## Scope

- Retire the old project-specific `fhl-image-studio-*` Codex Skill.
- Keep the desktop application, Photoshop Bridge and manual CLI behavior
  unchanged.
- Preserve historical documentation while removing current shipping and
  installation instructions.
- Do not modify unrelated Codex skills or plugins.

## Implementation

- Deleted root `SKILL.md` and `安装CodexSkill.cmd`.
- Removed exact and wildcard Skill-copy logic from both V2.0.3 packaging
  scripts.
- Replaced current Skill usage instructions with a deprecation notice in the
  README, generated Portable guide and V2.0.3 release notes.
- Removed the Skill contract link from the current documentation index.
- Replaced `skillChainRestore.test.mjs` with
  `deprecatedSkillAssets.test.mjs`. The new contract requires the retired
  assets to remain absent from source and packaging logic and continues to
  guard the standalone CLI/Profile synchronization chain.
- Removed the exact global directories
  `<用户目录>\.codex\skills\fhl-image-studio-v2-0-2-1`,
  `<用户目录>\.codex\skills\fhl-image-studio-cli.disabled`, and
  `<用户目录>\.codex\skills\fhl-image-studio.disabled` after enumerating
  their contents. No other global Skill or plugin path was touched.

## Verification

- Focused deprecated-asset and CLI contract: 3/3 passed.
- Frontend Node tests: 564/564 passed.
- Frontend UI tests: 22/22 passed.
- TypeScript typecheck: passed.
- Windows frontend build: passed with only the existing chunk warnings.
- Clean source staging compliance scan: zero issues.
- Clean source stage contains zero `SKILL.md` or `*CodexSkill.cmd` files.
- Portable staging directory contains zero retired Skill assets.
- Portable ZIP contains zero retired Skill assets.
- All three targeted global Skill directories are absent after cleanup.

The staging runs reused existing local binaries only to verify packaging
contents. They did not rebuild or replace the official EXE, release candidate,
Photoshop plugin or Internet sharing package. No provider or paid request was
made.
