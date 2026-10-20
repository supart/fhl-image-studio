import type { Annotation } from "./annotationTypes";
import type { StudioState, UndoEntry } from "../../state/studioStore.types";

export function cloneAnnotationForHistory(annotation: Annotation): Annotation {
  return {
    ...annotation,
    ...(annotation.points ? { points: annotation.points.slice() } : {}),
  };
}

export function createAnnotationUpdateUndoEntry(
  id: string,
  before: Annotation,
  after: Annotation,
  label = "annotation-update",
): { before: Annotation; after: Annotation; entry: UndoEntry } | null {
  if (!id || before.id !== id || after.id !== id) return null;
  const beforeSnapshot = cloneAnnotationForHistory(before);
  const afterSnapshot = cloneAnnotationForHistory(after);
  if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) return null;
  const entry: UndoEntry = {
    label,
    undo: (state: StudioState) => ({
      annotations: state.annotations.map((annotation) => annotation.id === id
        ? cloneAnnotationForHistory(beforeSnapshot)
        : annotation),
    }),
    redo: (state: StudioState) => ({
      annotations: state.annotations.map((annotation) => annotation.id === id
        ? cloneAnnotationForHistory(afterSnapshot)
        : annotation),
    }),
  };
  return { before: beforeSnapshot, after: afterSnapshot, entry };
}
