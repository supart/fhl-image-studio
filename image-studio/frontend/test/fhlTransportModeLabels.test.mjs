import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("desktop FHL labels use the effective transport mode without relabeling non-FHL profiles", async () => {
  const policy = await import(new URL("../src/lib/providerPolicy.ts", import.meta.url));
  const historyRail = source("../src/components/history/HistoryRail.tsx");
  const windowsHistoryRail = source("../src/components/history/WindowsHistoryRail.tsx");
  const quickConfig = source("../src/components/panel/FHLQuickConfigModal.tsx");
  const poolConfig = source("../src/components/panel/FHLImagesPoolConfig.tsx");

  assert.match(historyRail, /apiMode, fhlTransportMode,/);
  assert.equal(policy.fhlTransportLabel("images"), "FHL Images");
  assert.equal(policy.fhlTransportLabel("responses"), "FHL Responses");
  assert.equal(policy.providerModeLabel("apimart"), "APIMart 异步 API");
  assert.equal(policy.providerModeLabel("runninghub"), "RunningHub 桥接");
  assert.match(historyRail, /from "\.\.\/\.\.\/lib\/providerPolicy"/);
  assert.match(historyRail, /fhlTransportLabel\(fhlTransportMode\)/);
  assert.match(historyRail, /apiModeLabel\(profile\.apiMode\)\.replace\(" API", ""\)/);

  assert.match(windowsHistoryRail, /fhlTransportMode: "images" \| "responses";/);
  assert.match(windowsHistoryRail, /from "\.\.\/\.\.\/lib\/providerPolicy"/);
  assert.match(windowsHistoryRail, /\$\{fhlTransportLabel\(fhlTransportMode\)\} API/);
  assert.match(windowsHistoryRail, /isOfficialFHLProfile\(profile\)/);

  assert.match(quickConfig, /title="FHL API 配置"/);
  assert.match(quickConfig, /<FHLDesktopAPIConfig/);
  assert.match(poolConfig, /const transportLabel = fhlTransportMode === "responses" \? "FHL Responses" : "FHL Images";/);
  assert.match(poolConfig, /当前新任务使用 \{transportLabel\}/);
  assert.match(poolConfig, /槽位配置不会随接口切换而改变/);
  assert.match(poolConfig, /const slotDisplayName = profile \? transportLabel : "待创建";/);
  assert.match(poolConfig, /API \{index \+ 1\} · \{transportLabel\}/);
});
