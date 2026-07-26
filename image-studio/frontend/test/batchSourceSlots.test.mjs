import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const contractsSource = readFileSync(new URL("../src/platform/runtime/browserJobContracts.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../dev/browserJobProxy.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../src/platform/runtime/host.ts", import.meta.url), "utf8");
const sharedStoreSource = readFileSync(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");

test("batch image-to-image builds reference slots around one rotating source", () => {
  assert.match(storeSource, /function buildBatchCombinedSourcePaths/);
  assert.match(storeSource, /let batchFixedSources = batchProcessMode[\s\S]*?s\.sources/);
  assert.match(storeSource, /const batchSourceSlotIndex = batchProcessMode[\s\S]*?clampBatchSourceSlotIndex\(batchProcess\.batchSourceSlotIndex, batchFixedSources\.length\)/);
  assert.match(storeSource, /batchReferenceOrderAutoAspectSource\(\s*batchFixedSources,\s*batchSelectedSources\[index\],\s*batchSourceSlotIndex,\s*\)/);
  assert.match(storeSource, /normalizedReferenceSlotIndex\(batchSourceSlotIndex, fixedSources\.length\) === 0/);
  assert.match(storeSource, /const firstFixedSource = fixedSources\[0\] \?\? null/);
  assert.match(storeSource, /const batchFixedSourcePaths = batchProcessMode[\s\S]*?batchFixedSources\.map\(\(src\) => src\.path\)/);
  assert.match(storeSource, /const combinedSourcePaths = buildBatchCombinedSourcePaths\(batchFixedSourcePaths, source\.path, batchSourceSlotIndex\)/);
  assert.match(storeSource, /sourceImagePaths: combinedSourcePaths/);
  assert.match(storeSource, /batchSourcePath: source\.path/);
  assert.match(storeSource, /batchSourceSlotIndex,/);
});

test("batch browser proxy materializes virtual sources before queueing", () => {
  assert.match(storeSource, /async function materializeVirtualSourceForBrowserProxy/);
  assert.match(storeSource, /async function materializeBatchSourcesForBrowserProxy/);
  assert.match(storeSource, /batchProcessMode && shouldUseBackgroundTaskProxyForSubmit\(effectiveAPIMode\)/);
  assert.match(storeSource, /batchSelectedSources = materializedBatch\.selectedSources/);
  assert.match(storeSource, /batchFixedSources = materializedBatch\.fixedSources/);
  assert.match(storeSource, /batchSelectedSources\.some\(\(source\) => isVirtualImagePath\(source\.path\)\)/);
});

test("packaged E2E browser imports do not persist volatile memory batch sources", () => {
  assert.match(hostSource, /function shouldAvoidVolatileBrowserImages/);
  assert.match(hostSource, /persistBrowserImageToLocalInput/);
  assert.match(hostSource, /ImportImageFromB64/);
  assert.match(hostSource, /shouldAvoidVolatileBrowserImages\(\)[\s\S]*\? null[\s\S]*fallbackVirtual/);
  assert.match(sharedStoreSource, /function isVolatileMemoryPath/);
  assert.match(sharedStoreSource, /discoveredSources: workspace\.batchProcess\.discoveredSources[\s\S]*?filter\(\(source\) => !isVolatileMemoryPath\(source\.path\)\)/);
  assert.match(sharedStoreSource, /if \(!itemPath \|\| isVolatileMemoryPath\(itemPath\)\) return null;/);
});

test("batch source identity survives browser proxy jobs and history sync", () => {
  assert.match(domainSource, /export interface JobGroupSnapshot[\s\S]*?batchSourcePath\?: string;/);
  assert.match(domainSource, /export interface JobGroupSnapshot[\s\S]*?batchSourceSlotIndex\?: number;/);
  assert.match(contractsSource, /export interface BrowserJobSubmitPayload[\s\S]*?batchSourcePath\?: string;/);
  assert.match(contractsSource, /export interface BrowserJobSubmitPayload[\s\S]*?batchSourceSlotIndex\?: number;/);
  assert.match(proxySource, /batchSourcePath: typeof effectivePayload\.batchSourcePath === "string"/);
  assert.match(proxySource, /batchSourceSlotIndex: Number\.isFinite\(Number\(effectivePayload\.batchSourceSlotIndex\)\)/);
  assert.match(storeSource, /batchSourcePath: task\.batchSourcePath \|\| ""/);
  assert.match(storeSource, /batchSourceSlotIndex: task\.batchSourceSlotIndex/);
  assert.match(storeSource, /type BrowserSourceIdentity = \{/);
  assert.match(storeSource, /sourceImages\?: SourceImage\[\]/);
  assert.match(storeSource, /panoramaRoundtrip\?: HistoryItem\["panoramaRoundtrip"\]/);
  assert.match(storeSource, /sourceIdentity\?: BrowserSourceIdentity/);
  assert.match(storeSource, /sourceIdentity\?\.batchSourcePath \|\| group\.batchSourcePath \|\| group\.sourceImagePaths\?\.\[0\]/);
  assert.match(storeSource, /snapshot\.batchProcessLink\?\.sourcePath \|\| snapshot\.sources\[0\]\?\.path/);
});
