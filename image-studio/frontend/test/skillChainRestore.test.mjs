import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../..", import.meta.url);
const readText = async (relativePath) => {
  try {
    return await readFile(new URL(relativePath, root), "utf8");
  } catch (error) {
    if (!relativePath.endsWith("CodexSkill.cmd") || error?.code !== "ENOENT") throw error;
    const entries = await readdir(root);
    const installerName = entries.find((name) => /CodexSkill\.cmd$/i.test(name));
    assert.ok(installerName, "Codex skill installer must exist in the package root");
    return readFile(new URL(installerName, root), "utf8");
  }
};

test("root skill chain assets are present", async () => {
  const [agents, skill, installer, cli, packageScript] = await Promise.all([
    readText("AGENTS.md"),
    readText("SKILL.md"),
    readText("安装CodexSkill.cmd"),
    readText("image-cli.cmd"),
    readText("scripts/package-windows-portable-v2.0.3.ps1"),
  ]);

  assert.match(agents, /cli\.env\.local/);
  assert.match(agents, /APIMart/);
  assert.match(skill, /name:\s*fhl-image-studio-v2-0-3/);
  assert.match(skill, /APIMart/);
  assert.match(skill, /config\\cli\.env\.local/);
  assert.match(skill, /default CLI execution stays sequential/);
  assert.match(installer, /fhl-image-studio/);
  assert.match(installer, /fhl-image-studio-cli/);
  assert.match(installer, /fhl-ty-v2/);
  assert.match(cli, /runtime\\cli\\gptcodex-image\.exe/);
  assert.match(cli, /config\\cli\.env\.local/);
  assert.match(cli, /PUBLIC_ROOT%\\\."\) do set "PUBLIC_ROOT=%%~fI\\"/);
  assert.doesNotMatch(cli, /--base-url\s+https:\/\/www\.fhl\.mom/);
  assert.doesNotMatch(cli, /--api-mode\s+images/);
  assert.match(packageScript, /AGENTS\.md/);
  assert.match(packageScript, /SKILL\.md/);
  assert.match(packageScript, /CodexSkill\.cmd/);
  assert.match(packageScript, /runtime\\cli\\gptcodex-image\.exe/);
});

test("profile sync writes cli env from active profile and api key saves", async () => {
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
