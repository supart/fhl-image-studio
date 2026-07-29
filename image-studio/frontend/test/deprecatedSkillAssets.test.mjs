import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

const root = new URL("../../..", import.meta.url);
const readText = (relativePath) => readFile(new URL(relativePath, root), "utf8");

const assertMissing = async (relativePath) => {
  await assert.rejects(access(new URL(relativePath, root)), (error) => error?.code === "ENOENT");
};

test("deprecated Codex Skill assets stay out of source and release packages", async () => {
  const [readme, docsIndex, releaseNotes, sourceScript, portableScript] = await Promise.all([
    readText("README.md"),
    readText("docs/README.md"),
    readText("RELEASE_NOTES_DESKTOP_V2.0.3.md"),
    readText("scripts/prepare-release-source-v2.0.3.ps1"),
    readText("scripts/package-windows-portable-v2.0.3.ps1"),
  ]);

  await Promise.all([
    assertMissing("SKILL.md"),
    assertMissing("安装CodexSkill.cmd"),
  ]);

  assert.doesNotMatch(docsIndex, /\[SKILL\.md\]/);
  assert.doesNotMatch(sourceScript, /["']SKILL\.md["']/);
  assert.doesNotMatch(sourceScript, /CodexSkill\.cmd/);
  assert.doesNotMatch(portableScript, /Join-Path \$Root ["']SKILL\.md["']/);
  assert.doesNotMatch(portableScript, /CodexSkill\.cmd/);
  assert.match(readme, /Codex Skill 已弃用/);
  assert.match(releaseNotes, /Codex Skill 已弃用/);
});

test("manual CLI chain remains available after Skill removal", async () => {
  const [agents, cli, packageScript] = await Promise.all([
    readText("AGENTS.md"),
    readText("image-cli.cmd"),
    readText("scripts/package-windows-portable-v2.0.3.ps1"),
  ]);

  assert.match(agents, /cli\.env\.local/);
  assert.match(agents, /APIMart/);
  assert.match(cli, /runtime\\cli\\gptcodex-image\.exe/);
  assert.match(cli, /config\\cli\.env\.local/);
  assert.match(cli, /PUBLIC_ROOT%\\\."\) do set "PUBLIC_ROOT=%%~fI\\"/);
  assert.doesNotMatch(cli, /--base-url\s+https:\/\/www\.fhl\.mom/);
  assert.doesNotMatch(cli, /--api-mode\s+images/);
  assert.match(packageScript, /AGENTS\.md/);
  assert.match(packageScript, /runtime\\cli\\gptcodex-image\.exe/);
});

test("profile sync still writes CLI env from active profile and API key saves", async () => {
  const [profiles, store] = await Promise.all([
    readText("image-studio/frontend/src/state/studioStore.profiles.ts"),
    readText("image-studio/frontend/src/state/studioStore.ts"),
  ]);

  assert.match(profiles, /syncCLIConfigQuietly\(cliConfigFromProfileState\(store\.getState\(\),\s*next,\s*apiKey\)\)/);
  assert.match(profiles, /syncCLIConfigQuietly\(cliConfigFromProfileState\(store\.getState\(\),\s*refreshed,\s*apiKey\)\)/);
  assert.match(store, /if \s*\(trimmed\)/);
  assert.match(store, /syncCLIConfigQuietly\(cliConfigFromState\(get\(\),\s*\{\s*apiKey:\s*(?:trimmed|cleanedAPIKey)\s*\}\)\)/);
  assert.match(store, /syncCLIConfigQuietly\(cliConfigFromState\(get\(\), \{ clearAPIKey: true \}\)\)/);
});
