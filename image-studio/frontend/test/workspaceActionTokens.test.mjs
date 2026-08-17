import assert from "node:assert/strict";
import test from "node:test";

import {
  captureWorkspaceAction,
  invalidateWorkspaceActions,
  isWorkspaceActionCurrent,
  resetWorkspaceActions,
  settleWorkspaceAction,
} from "../src/state/workspaceActionTokens.ts";

test.beforeEach(() => resetWorkspaceActions());

test("workspace actions remain attached to their origin workspace", () => {
  const first = captureWorkspaceAction("workspace-a", "optimize-prompt");
  const second = captureWorkspaceAction("workspace-b", "optimize-prompt");
  assert.equal(isWorkspaceActionCurrent(first, ["workspace-a", "workspace-b"]), true);
  assert.equal(isWorkspaceActionCurrent(second, ["workspace-a", "workspace-b"]), true);
});

test("newer actions supersede older actions of the same kind in one workspace", () => {
  const oldAction = captureWorkspaceAction("workspace-a", "import-source", { supersede: true });
  const newAction = captureWorkspaceAction("workspace-a", "import-source", { supersede: true });
  assert.equal(isWorkspaceActionCurrent(oldAction, ["workspace-a"]), false);
  assert.equal(settleWorkspaceAction(newAction, ["workspace-a"]), true);
  assert.equal(isWorkspaceActionCurrent(newAction, ["workspace-a"]), false);
});

test("closing or resetting a workspace invalidates delayed completions", () => {
  const action = captureWorkspaceAction("workspace-a", "reverse-prompt");
  invalidateWorkspaceActions("workspace-a");
  assert.equal(isWorkspaceActionCurrent(action, ["workspace-a"]), false);
  assert.equal(isWorkspaceActionCurrent(action, []), false);
});
