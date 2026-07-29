import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/state/keyedSingleFlight.ts", import.meta.url), "utf8");
const module = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText).toString("base64")}`);

const { createKeyedSingleFlight } = module;

test("twenty overlapping calls for one workspace execute only once", async () => {
  const singleFlight = createKeyedSingleFlight();
  let executions = 0;
  let release;
  const operation = () => {
    executions += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const pending = Array.from({ length: 20 }, () => singleFlight("workspace-1", operation));
  await Promise.resolve();

  assert.equal(executions, 1);
  assert.equal(new Set(pending).size, 1);

  release();
  await Promise.all(pending);

  await singleFlight("workspace-1", async () => { executions += 1; });
  assert.equal(executions, 2);
});

test("different workspaces may submit independently", async () => {
  const singleFlight = createKeyedSingleFlight();
  const started = [];

  await Promise.all([
    singleFlight("workspace-a", async () => { started.push("a"); }),
    singleFlight("workspace-b", async () => { started.push("b"); }),
  ]);

  assert.deepEqual(started.sort(), ["a", "b"]);
});
