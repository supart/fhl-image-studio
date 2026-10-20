import type { HistoryItem } from "../types/domain.ts";
import type { StudioState, WorkspaceCanvasRuntime } from "./studioStore.types.ts";

export function createDefaultWorkspaceCanvasRuntime(): WorkspaceCanvasRuntime {
  return {
    sourcePreviewReturnImage: null,
    tool: "pan",
    brushSize: 30,
    annotationStrokeWidth: 4,
    annotationFontSize: 20,
    brushMode: "paint",
    annotationKind: "rect",
    annotationColor: "#ff4d4d",
    selectedAnnotationId: null,
    maskDataURL: null,
    strokes: [],
    annotations: [],
    undoStack: [],
    redoStack: [],
    compareB: null,
    compareMode: "curtain",
    compareSplit: 0.5,
    canvasView: null,
    viewZoom: 1,
    canvasViewResetTick: 0,
  };
}

export function captureWorkspaceCanvasRuntime(state: StudioState): WorkspaceCanvasRuntime {
  return {
    sourcePreviewReturnImage: state.sourcePreviewReturnImage,
    tool: state.tool,
    brushSize: state.brushSize,
    annotationStrokeWidth: state.annotationStrokeWidth,
    annotationFontSize: state.annotationFontSize,
    brushMode: state.brushMode,
    annotationKind: state.annotationKind,
    annotationColor: state.annotationColor,
    selectedAnnotationId: state.selectedAnnotationId,
    maskDataURL: state.maskDataURL,
    strokes: state.strokes,
    annotations: state.annotations,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    compareB: state.compareB,
    compareMode: state.compareMode,
    compareSplit: state.compareSplit,
    canvasView: state.canvasView,
    viewZoom: state.viewZoom,
    canvasViewResetTick: state.canvasViewResetTick,
  };
}

export function workspaceCanvasSelectionPatch(
  state: StudioState,
  targetWorkspaceId: string,
): WorkspaceCanvasRuntime & Pick<StudioState, "workspaceCanvasRuntime"> {
  const workspaceCanvasRuntime = { ...state.workspaceCanvasRuntime };
  if (state.activeWorkspaceId) {
    workspaceCanvasRuntime[state.activeWorkspaceId] = captureWorkspaceCanvasRuntime(state);
  }
  const target = {
    ...createDefaultWorkspaceCanvasRuntime(),
    ...(workspaceCanvasRuntime[targetWorkspaceId] ?? {}),
    annotationStrokeWidth: workspaceCanvasRuntime[targetWorkspaceId]?.annotationStrokeWidth ?? 4,
    annotationFontSize: workspaceCanvasRuntime[targetWorkspaceId]?.annotationFontSize ?? 20,
  };
  workspaceCanvasRuntime[targetWorkspaceId] = target;
  return { ...target, workspaceCanvasRuntime };
}

export function mapWorkspaceCanvasHistoryItems(
  runtimeByWorkspace: Record<string, WorkspaceCanvasRuntime>,
  mapItem: (item: HistoryItem | null) => HistoryItem | null,
): Record<string, WorkspaceCanvasRuntime> {
  return Object.fromEntries(Object.entries(runtimeByWorkspace).map(([workspaceId, runtime]) => [
    workspaceId,
    {
      ...runtime,
      compareB: mapItem(runtime.compareB),
      sourcePreviewReturnImage: mapItem(runtime.sourcePreviewReturnImage),
    },
  ]));
}
