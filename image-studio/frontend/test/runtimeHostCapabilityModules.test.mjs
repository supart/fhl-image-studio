import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const runtimeRoot = new URL("../src/platform/runtime/", import.meta.url);
const capabilityModules = [
  "hostContext.ts",
  "hostClipboard.ts",
  "hostTasks.ts",
  "hostFiles.ts",
  "hostMedia.ts",
  "hostCredentials.ts",
];

const expectedModuleEdges = [
  "hostClipboard.ts->hostContext.ts",
  "hostCredentials.ts->hostContext.ts",
  "hostFiles.ts->hostContext.ts",
  "hostFiles.ts->hostCredentials.ts",
  "hostFiles.ts->hostMedia.ts",
  "hostMedia.ts->hostContext.ts",
  "hostTasks.ts->hostContext.ts",
  "hostTasks.ts->hostMedia.ts",
].sort();

const expectedFacadeExports = [
  "BeginNativeFileDrag",
  "BuildBatchOutputPath",
  "Cancel",
  "ChooseBatchInputDir",
  "ChooseBatchOutputDir",
  "ChooseOutputDir",
  "CropImage",
  "DeleteStoredAPIKey",
  "Edit",
  "EventsOff",
  "EventsOn",
  "ExportHistoryToFile",
  "FlipImage",
  "Generate",
  "GetAutomationStatus",
  "GetOutputDir",
  "GetStoredAPIKey",
  "ImportHistoryFromFile",
  "ImportImageFromB64",
  "ImportImagePath",
  "ListBatchInputImages",
  "OpenExternalURL",
  "OpenFile",
  "OpenImageDialog",
  "OpenImagesDialog",
  "OpenMaterialSyncDir",
  "OpenOutputDir",
  "OptimizePrompt",
  "PasteLocalEdit",
  "ReadImageAsBase64",
  "ReadImageMetadata",
  "ReadClipboardText",
  "ReadTextFile",
  "RegisterImportedImageAsset",
  "RegisterMediaAsset",
  "RemoveManagedImage",
  "ReversePrompt",
  "RotateImage",
  "SaveImageAs",
  "SaveImageBlobToOutput",
  "SaveImagePathAs",
  "SaveImagePathToDir",
  "SaveImagePathToOutput",
  "SaveImageToDir",
  "SetOutputDir",
  "SetStoredAPIKey",
  "ShareImageAs",
  "ShareImagePathAs",
  "SyncMaterialGroupToOutput",
  "WindowSetDarkTheme",
  "WindowSetLightTheme",
  "WindowSetSystemDefaultTheme",
  "detectHostKind",
  "getHostCapabilities",
  "getKernelRuntimeMode",
  "probeCurrentUpstream",
  "registerEphemeralLog",
  "setKernelRuntimeMode",
].sort();

function parseSource(fileName) {
  const source = readFileSync(new URL(fileName, runtimeRoot), "utf8");
  return {
    source,
    tree: ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}

function facadeExports() {
  const { tree } = parseSource("host.ts");
  return tree.statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      return [];
    }
    return statement.exportClause.elements.map((element) => element.name.text);
  }).sort();
}

function capabilityEdges() {
  return capabilityModules.flatMap((fileName) => {
    const { tree } = parseSource(fileName);
    return tree.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) return [];
      const target = statement.moduleSpecifier.text.replace(/^\.\//, "");
      const normalizedTarget = target.endsWith(".ts") ? target : `${target}.ts`;
      return capabilityModules.includes(normalizedTarget) ? [`${fileName}->${normalizedTarget}`] : [];
    });
  }).sort();
}

test("runtime host facade keeps the exact public export contract", () => {
  assert.deepEqual(facadeExports(), expectedFacadeExports);
});

test("runtime host capability modules never import the compatibility facade", () => {
  for (const fileName of capabilityModules) {
    const { tree } = parseSource(fileName);
    const facadeImports = tree.statements
      .filter((statement) => ts.isImportDeclaration(statement))
      .map((statement) => statement.moduleSpecifier)
      .filter((specifier) => ts.isStringLiteralLike(specifier))
      .map((specifier) => specifier.text)
      .filter((specifier) => /(?:^|\/)host(?:\.ts)?$/.test(specifier));
    assert.deepEqual(facadeImports, [], `${fileName} must not import host.ts`);
  }
});

test("runtime host capability dependencies stay acyclic and on the audited baseline", () => {
  assert.deepEqual(capabilityEdges(), expectedModuleEdges);
});

test("runtime host facade is a compatibility-only re-export module", () => {
  const { tree } = parseSource("host.ts");
  const executableStatements = tree.statements.filter((statement) => !ts.isExportDeclaration(statement));
  assert.deepEqual(executableStatements, []);
});
