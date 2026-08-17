import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
const boundaryRoots = [resolve(srcRoot, "state"), resolve(srcRoot, "lib")];

const allowedReverseDependencies = [
  "state/autoAspectSizing->components/panel/sizeCapabilities",
  "state/materialLibrary->components/history/historyPromptGroups",
  "state/sharedEditAutoAspect->components/panel/sizeCapabilities",
  "state/studioStore->app/dev/previewData",
  "state/studioStore->components/panel/sizeCapabilities",
  "state/studioStore.images->platform/android/bridge",
  "state/studioStore.media->platform/android/bridge",
].sort();

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function projectPath(path) {
  return relative(srcRoot, path)
    .replaceAll("\\", "/")
    .replace(/\.(?:d\.)?tsx?$/, "");
}

function importedModule(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return expression && ts.isStringLiteralLike(expression) ? expression.text : "";
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
    const argument = node.arguments[0];
    if ((isDynamicImport || isRequire) && ts.isStringLiteralLike(argument)) return argument.text;
  }
  return "";
}

function isReverseDependency(target) {
  return target.startsWith("components/")
    || target.startsWith("app/dev/")
    || target === "platform/android/bridge"
    || target.startsWith("platform/android/bridge/");
}

function reverseDependencies() {
  const edges = [];
  for (const file of boundaryRoots.flatMap(sourceFiles)) {
    const source = readFileSync(file, "utf8");
    const scriptKind = extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
    const visit = (node) => {
      const specifier = importedModule(node);
      if (specifier.startsWith(".")) {
        const target = projectPath(resolve(dirname(file), specifier));
        if (isReverseDependency(target)) edges.push(`${projectPath(file)}->${target}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return edges.sort();
}

test("state and library reverse dependencies stay on the exact audited baseline", () => {
  assert.deepEqual(reverseDependencies(), allowedReverseDependencies);
});
