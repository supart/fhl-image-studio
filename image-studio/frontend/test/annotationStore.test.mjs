import assert from "node:assert/strict";
import test from "node:test";

const { createAnnotationActions, clearPreserveAnnotationSubmit, shouldPreserveAnnotationSubmit } = await import(
  `../src/state/studioStore.annotations.ts?annotation-store=${Date.now()}-${Math.random()}`,
);
const { createAnnotationUpdateUndoEntry } = await import(
  `../src/features/annotation/annotationHistory.ts?annotation-history=${Date.now()}-${Math.random()}`,
);

function makeStore(overrides = {}) {
  const toasts = [];
  let state = {
    activeWorkspaceId: "w1",
    currentImage: { id: "image-1", savedPath: "preview.png" },
    annotations: [{ id: "rect-1", kind: "rect", x: 1, y: 2, width: 20, height: 30, color: "red" }],
    prompt: "",
    sources: [],
    workspaces: [{ id: "w1", sources: [] }, { id: "w2", sources: [] }],
    pushToast: (text) => toasts.push(text),
    submit: async () => undefined,
    ...overrides,
  };
  const store = {
    getState: () => state,
    setState: (patch) => {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
    },
  };
  return { store, getState: () => state, toasts };
}

test("annotation geometry updates create one reversible history entry", () => {
  const before = { id: "rect-1", kind: "rect", x: 10, y: 20, width: 30, height: 40, color: "red", points: [1, 2] };
  const after = { ...before, x: 55, y: 65, points: [9, 10] };
  const history = createAnnotationUpdateUndoEntry("rect-1", before, after, "annotation-drag");
  assert.ok(history);
  let state = { annotations: [history.after] };
  state = { ...state, ...history.entry.undo(state) };
  assert.deepEqual(state.annotations, [before]);
  state = { ...state, ...history.entry.redo(state) };
  assert.deepEqual(state.annotations, [after]);
});

test("annotation update history preserves ordered move and transform steps", () => {
  const created = { id: "arrow-1", kind: "arrow", x: 10, y: 10, width: 100, height: 20, bend: 0, color: "blue" };
  const moved = { ...created, x: 40, y: 45 };
  const transformed = { ...moved, width: 160, height: 36, bend: 18 };
  const move = createAnnotationUpdateUndoEntry(created.id, created, moved, "annotation-drag");
  const transform = createAnnotationUpdateUndoEntry(created.id, moved, transformed, "annotation-transform");
  assert.ok(move);
  assert.ok(transform);
  let state = { annotations: [transformed] };
  state = { ...state, ...transform.entry.undo(state) };
  assert.deepEqual(state.annotations, [moved]);
  state = { ...state, ...move.entry.undo(state) };
  assert.deepEqual(state.annotations, [created]);
  state = { ...state, ...move.entry.redo(state) };
  assert.deepEqual(state.annotations, [moved]);
  state = { ...state, ...transform.entry.redo(state) };
  assert.deepEqual(state.annotations, [transformed]);
});

test("unchanged annotation updates do not create history entries", () => {
  const annotation = { id: "text-1", kind: "text", x: 1, y: 2, text: "same", color: "black" };
  assert.equal(createAnnotationUpdateUndoEntry(annotation.id, annotation, { ...annotation }), null);
});

test("annotation submit refuses to run without an image or annotations", async () => {
  const noImage = makeStore({ currentImage: null });
  const noImageActions = createAnnotationActions(noImage.store, { reuseAsSource: async () => { throw new Error("unexpected"); } });
  await noImageActions.submitAnnotationEdit();
  assert.match(noImage.toasts[0], /没有图片/);

  const noAnnotations = makeStore({ annotations: [] });
  const noAnnotationsActions = createAnnotationActions(noAnnotations.store, { reuseAsSource: async () => { throw new Error("unexpected"); } });
  await noAnnotationsActions.submitAnnotationEdit();
  assert.match(noAnnotations.toasts[0], /至少一条批注/);
});

test("annotation confirmation refuses empty snapshots without touching workspace state", async () => {
  const noImage = makeStore({ currentImage: null, annotations: [] });
  const noImageActions = createAnnotationActions(noImage.store, { reuseAsSource: async () => { throw new Error("unexpected"); } });
  assert.equal(await noImageActions.confirmAnnotationComposite(), "cancelled");
  assert.deepEqual(noImage.getState().workspaces, [{ id: "w1", sources: [] }, { id: "w2", sources: [] }]);

  const noAnnotations = makeStore({ annotations: [] });
  const noAnnotationsActions = createAnnotationActions(noAnnotations.store, { reuseAsSource: async () => { throw new Error("unexpected"); } });
  assert.equal(await noAnnotationsActions.confirmAnnotationComposite(), "cancelled");
  assert.deepEqual(noAnnotations.getState().sources, []);
  assert.match(noAnnotations.toasts.at(-1), /至少一条标注/);
});

test("annotation submit materializes one source and mirrors it to the workspace", async () => {
  let submitCalls = 0;
  const fixture = makeStore({
    submit: async () => { submitCalls += 1; },
  });
  const actions = createAnnotationActions(fixture.store, {
    reuseAsSource: async () => {
      const current = fixture.getState().currentImage;
      fixture.store.setState({
        currentImage: { ...current, savedPath: "managed.png" },
        sources: [{ path: "managed.png", name: "managed.png" }],
      });
    },
  });

  await actions.submitAnnotationEdit();
  const state = fixture.getState();
  assert.equal(submitCalls, 1);
  assert.equal(state.mode, "edit");
  assert.deepEqual(state.sources.map((source) => source.path), ["managed.png"]);
  assert.deepEqual(state.workspaces[0].sources.map((source) => source.path), ["managed.png"]);
  assert.equal(shouldPreserveAnnotationSubmit("w1"), false);
});

test("annotation submit aborts when the workspace changes during source materialization", async () => {
  let submitCalls = 0;
  const fixture = makeStore({ submit: async () => { submitCalls += 1; } });
  const actions = createAnnotationActions(fixture.store, {
    reuseAsSource: async () => {
      fixture.store.setState({ activeWorkspaceId: "w2" });
    },
  });

  await actions.submitAnnotationEdit();
  assert.equal(submitCalls, 0);
  assert.match(fixture.toasts.at(-1), /工作区已切换/);
  assert.equal(shouldPreserveAnnotationSubmit("w1"), false);
});

test("duplicate annotation submit is ignored while the first action is waiting", async () => {
  let release;
  let submitCalls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const fixture = makeStore({ submit: async () => { submitCalls += 1; } });
  const actions = createAnnotationActions(fixture.store, {
    reuseAsSource: async () => {
      await gate;
      const current = fixture.getState().currentImage;
      fixture.store.setState({
        currentImage: { ...current, savedPath: "managed.png" },
        sources: [{ path: "managed.png", name: "managed.png" }],
      });
    },
  });

  const first = actions.submitAnnotationEdit();
  await Promise.resolve();
  await actions.submitAnnotationEdit();
  assert.match(fixture.toasts.at(-1), /重复提交/);
  release();
  await first;
  assert.equal(submitCalls, 1);
  clearPreserveAnnotationSubmit("w1");
});

test("annotation submit failure keeps the source image and annotations intact", async () => {
  const fixture = makeStore({ submit: async () => { throw new Error("mock submit failed"); } });
  const originalAnnotations = fixture.getState().annotations;
  const actions = createAnnotationActions(fixture.store, {
    reuseAsSource: async () => {
      const current = fixture.getState().currentImage;
      fixture.store.setState({
        currentImage: { ...current, savedPath: "managed.png" },
        sources: [{ path: "managed.png", name: "managed.png" }],
      });
    },
  });

  await assert.rejects(actions.submitAnnotationEdit(), /mock submit failed/);
  assert.equal(fixture.getState().currentImage.id, "image-1");
  assert.deepEqual(fixture.getState().annotations, originalAnnotations);
  assert.equal(shouldPreserveAnnotationSubmit("w1"), false);
});

test("annotation source preparation failure is reported without changing edit state", async () => {
  const fixture = makeStore({ mode: "generate", sources: [] });
  const actions = createAnnotationActions(fixture.store, {
    reuseAsSource: async () => { throw new Error("mock materialize failure"); },
  });

  await actions.submitAnnotationEdit();
  const state = fixture.getState();
  assert.equal(state.mode, "generate");
  assert.deepEqual(state.sources, []);
  assert.match(fixture.toasts.at(-1), /源图准备失败/);
  assert.equal(shouldPreserveAnnotationSubmit("w1"), false);
});

test("annotation cancellation after workspace switch keeps both workspaces untouched", async () => {
  const fixture = makeStore({
    workspaces: [
      { id: "w1", sources: [{ path: "old.png" }] },
      { id: "w2", sources: [{ path: "other.png" }] },
    ],
    sources: [{ path: "old.png" }],
  });
  const actions = createAnnotationActions(fixture.store, {
    reuseAsSource: async () => { fixture.store.setState({ activeWorkspaceId: "w2" }); },
  });

  await actions.submitAnnotationEdit();
  assert.deepEqual(fixture.getState().workspaces, [
    { id: "w1", sources: [{ path: "old.png" }] },
    { id: "w2", sources: [{ path: "other.png" }] },
  ]);
  assert.equal(shouldPreserveAnnotationSubmit("w1"), false);
});

test("annotation session cancellation restores the captured vector snapshot without persistence", () => {
  const fixture = makeStore({
    annotations: [{ id: "before", kind: "rect", x: 1, y: 2, width: 20, height: 30, color: "red" }],
    selectedAnnotationId: "before",
    undoStack: [{ label: "before" }],
    redoStack: [],
    workspaceCanvasRuntime: {},
    tool: "annotate",
    annotationSource: { sourceHistoryId: "image-1", blob: new Blob(["source"]) },
  });
  const actions = createAnnotationActions(fixture.store, { reuseAsSource: async () => undefined });
  actions.beginAnnotationSession();
  fixture.store.setState({
    annotations: [{ id: "after", kind: "ellipse", x: 5, y: 6, width: 10, height: 12, color: "blue" }],
    selectedAnnotationId: "after",
    undoStack: [{ label: "after" }],
    redoStack: [{ label: "redo" }],
  });
  assert.equal(actions.isAnnotationSessionDirty(), true);
  actions.cancelAnnotationSession();
  const state = fixture.getState();
  assert.deepEqual(state.annotations.map((annotation) => annotation.id), ["before"]);
  assert.equal(state.selectedAnnotationId, "before");
  assert.deepEqual(state.undoStack, [{ label: "before" }]);
  assert.deepEqual(state.redoStack, []);
  assert.equal(state.tool, "pan");
  assert.equal(state.annotationSource, null);
  assert.equal(actions.isAnnotationSessionDirty(), false);
});

test("annotation session snapshots are isolated by workspace and image", () => {
  const fixture = makeStore({ workspaceCanvasRuntime: {}, tool: "annotate", undoStack: [], redoStack: [] });
  const actions = createAnnotationActions(fixture.store, { reuseAsSource: async () => undefined });
  actions.beginAnnotationSession();
  fixture.store.setState({ activeWorkspaceId: "w2" });
  actions.cancelAnnotationSession();
  assert.equal(fixture.getState().activeWorkspaceId, "w2");
  assert.equal(fixture.getState().tool, "pan");
  assert.deepEqual(fixture.getState().annotations.map((annotation) => annotation.id), ["rect-1"]);
});
