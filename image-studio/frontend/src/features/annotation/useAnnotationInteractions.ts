import { useEffect, useRef, useState, type FocusEvent } from "react";
import type Konva from "konva";
import type { Annotation } from "./annotationTypes";
import type { AnnotationTool } from "./annotationTypes";
import {
  annotationHitTest,
  annotationLabelBounds,
  annotationSelectionTolerance,
  annotationTransformHandles,
  getDefaultAnnotationArrowBend,
  resizeAnnotationFromHandle,
  ANNOTATION_MIN_LENGTH,
  type AnnotationTransformHandle,
} from "./annotationGeometry";
import { annotationLabelPosition } from "./annotationTypes";
import { cloneAnnotationForHistory } from "./annotationHistory";

type AnnotationDrag = {
  kind: Exclude<AnnotationTool, "pointer" | "eraser" | "freehand" | "highlight" | "text">;
  sx: number;
  sy: number;
  x: number;
  y: number;
};

type PointerAnnotationDrag = {
  id: string;
  start: { x: number; y: number };
  original: Annotation;
  moved: boolean;
};

type PointerAnnotationTransform = {
  id: string;
  handle: AnnotationTransformHandle;
  original: Annotation;
  moved: boolean;
};

type PointerAnnotationLabelDrag = {
  id: string;
  start: { x: number; y: number };
  original: { x: number; y: number };
  originalAnnotation: Annotation;
  moved: boolean;
};

export type AnnotationEditState = { id: string; text: string; original: Annotation };

type AnnotationInteractionOptions = {
  image: HTMLImageElement | null;
  stageRef: { current: Konva.Stage | null };
  view: { scale: number; x: number; y: number };
  effectiveTool: "pan" | "mask" | "annotate";
  annotationKind: AnnotationTool;
  annotationColor: string;
  annotationStrokeWidth: number;
  annotationFontSize: number;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  resetKey: string;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  commitAnnotationUpdate: (id: string, before: Annotation, after: Annotation, label?: string) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  setAnnotationKind: (kind: AnnotationTool) => void;
  onAnnotationContextMenu?: (id: string, x: number, y: number) => void;
};

function pointerToImageCoord(
  stageRef: { current: Konva.Stage | null },
  image: HTMLImageElement | null,
  view: { scale: number; x: number; y: number },
): { x: number; y: number } | null {
  const stage = stageRef.current;
  if (!stage || !image) return null;
  const pointer = stage.getPointerPosition();
  if (!pointer) return null;
  return {
    x: (pointer.x - view.x) / Math.max(0.05, view.scale),
    y: (pointer.y - view.y) / Math.max(0.05, view.scale),
  };
}

export function useAnnotationInteractions({
  image,
  stageRef,
  view,
  effectiveTool,
  annotationKind,
  annotationColor,
  annotationStrokeWidth,
  annotationFontSize,
  annotations,
  selectedAnnotationId,
  resetKey,
  addAnnotation,
  removeAnnotation,
  updateAnnotation,
  commitAnnotationUpdate,
  setSelectedAnnotationId,
  setAnnotationKind,
  onAnnotationContextMenu,
}: AnnotationInteractionOptions) {
  const [drag, setDrag] = useState<AnnotationDrag | null>(null);
  const [annotationEdit, setAnnotationEdit] = useState<AnnotationEditState | null>(null);
  const pointerDragRef = useRef<PointerAnnotationDrag | null>(null);
  const pointerTransformRef = useRef<PointerAnnotationTransform | null>(null);
  const pointerLabelDragRef = useRef<PointerAnnotationLabelDrag | null>(null);
  const pointerHitRef = useRef<string | null>(null);
  const pointerJustMovedRef = useRef(false);
  const annotationEditRef = useRef<AnnotationEditState | null>(null);
  const ignoreNextStagePointerRef = useRef(false);
  const freehandRef = useRef<number[] | null>(null);
  const [, setDrawingTick] = useState(0);
  // Keep the new ref after the existing hooks so Fast Refresh preserves the
  // pre-existing hook slots while event handlers still read the latest list.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  function setEditingAnnotation(next: AnnotationEditState | null) {
    annotationEditRef.current = next;
    setAnnotationEdit(next);
  }

  useEffect(() => {
    setDrag(null);
    setEditingAnnotation(null);
    pointerDragRef.current = null;
    pointerTransformRef.current = null;
    pointerLabelDragRef.current = null;
    pointerHitRef.current = null;
    pointerJustMovedRef.current = false;
    ignoreNextStagePointerRef.current = false;
    freehandRef.current = null;
  }, [resetKey]);

  function localPointer() {
    return pointerToImageCoord(stageRef, image, view);
  }

  function onMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    if (effectiveTool !== "annotate") return;
    if (ignoreNextStagePointerRef.current) {
      ignoreNextStagePointerRef.current = false;
      return;
    }
    if (annotationEditRef.current) {
      onEditCommit();
      return;
    }
    const currentAnnotations = annotationsRef.current;
    const local = localPointer();
    if (!local) return;
    const target = event.target;
    if (target === stageRef.current || target.getClassName?.() === "Image") {
      setSelectedAnnotationId(null);
    }
    if (annotationKind === "eraser") {
      const hit = [...currentAnnotations].reverse().find((annotation) => (
        annotationHitTest(annotation, local, 14 / Math.max(0.05, view.scale))
      ));
      if (hit) removeAnnotation(hit.id);
    } else if (annotationKind === "pointer") {
      const labelHit = [...currentAnnotations].reverse().find((annotation) => {
        const bounds = annotationLabelBounds(annotation);
        return bounds
          && local.x >= bounds.x - annotationSelectionTolerance(annotation, view.scale)
          && local.x <= bounds.x + bounds.width + annotationSelectionTolerance(annotation, view.scale)
          && local.y >= bounds.y - annotationSelectionTolerance(annotation, view.scale)
          && local.y <= bounds.y + bounds.height + annotationSelectionTolerance(annotation, view.scale);
      });
      if (labelHit) {
        const label = annotationLabelPosition(labelHit);
        setSelectedAnnotationId(labelHit.id);
        pointerLabelDragRef.current = {
          id: labelHit.id,
          start: local,
          original: label,
          originalAnnotation: cloneAnnotationForHistory(labelHit),
          moved: false,
        };
        pointerTransformRef.current = null;
        pointerDragRef.current = null;
        pointerHitRef.current = labelHit.id;
        return;
      }
      const selected = selectedAnnotationId
        ? currentAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
        : null;
      const handleTolerance = Math.max(10, 14 / Math.max(0.05, view.scale));
      const transformHandle = selected
        ? annotationTransformHandles(selected).find((candidate) => (
          Math.hypot(candidate.x - local.x, candidate.y - local.y) <= handleTolerance
        ))
        : null;
      if (selected && transformHandle) {
        pointerTransformRef.current = {
          id: selected.id,
          handle: transformHandle.handle,
          original: selected,
          moved: false,
        };
        pointerDragRef.current = null;
        pointerHitRef.current = selected.id;
        return;
      }
      const hit = [...currentAnnotations].reverse().find((annotation) => (
        annotationHitTest(annotation, local, annotationSelectionTolerance(annotation, view.scale))
      ));
      pointerHitRef.current = hit?.id ?? null;
      pointerJustMovedRef.current = false;
      if (hit) {
        setSelectedAnnotationId(hit.id);
        pointerDragRef.current = {
          id: hit.id,
          start: local,
          original: cloneAnnotationForHistory(hit),
          moved: false,
        };
      }
      return;
    } else if (annotationKind === "freehand" || annotationKind === "highlight") {
      freehandRef.current = [local.x, local.y];
      setDrawingTick((tick) => tick + 1);
    } else if (annotationKind === "text") {
      const id = crypto.randomUUID();
      const annotation: Annotation = {
        id,
        kind: "text",
        x: local.x,
        y: local.y,
        text: "",
        color: annotationColor,
        strokeWidth: annotationStrokeWidth,
        fontSize: annotationFontSize,
      };
      addAnnotation(annotation);
      setSelectedAnnotationId(id);
      setEditingAnnotation({ id, text: "", original: cloneAnnotationForHistory(annotation) });
    } else {
      setDrag({ kind: annotationKind as AnnotationDrag["kind"], sx: local.x, sy: local.y, x: local.x, y: local.y });
    }
  }

  function onMouseMove() {
    if (effectiveTool !== "annotate") return;
    const currentAnnotations = annotationsRef.current;
    if (annotationKind === "pointer") {
      const pointerLabelDrag = pointerLabelDragRef.current;
      if (pointerLabelDrag) {
        const target = currentAnnotations.find((annotation) => annotation.id === pointerLabelDrag.id);
        const local = localPointer();
        if (!target || !local) return;
        const dx = local.x - pointerLabelDrag.start.x;
        const dy = local.y - pointerLabelDrag.start.y;
        const imageWidth = image?.naturalWidth ?? image?.width ?? Number.POSITIVE_INFINITY;
        const imageHeight = image?.naturalHeight ?? image?.height ?? Number.POSITIVE_INFINITY;
        const bounds = annotationLabelBounds(target);
        const maxX = bounds ? Math.max(0, imageWidth - bounds.width) : imageWidth;
        const maxY = bounds ? Math.max(0, imageHeight - bounds.height) : imageHeight;
        if (!pointerLabelDrag.moved && Math.hypot(dx, dy) < 2 / Math.max(0.05, view.scale)) return;
        pointerLabelDrag.moved = true;
        updateAnnotation(target.id, {
          labelX: Math.max(0, Math.min(maxX, pointerLabelDrag.original.x + dx)),
          labelY: Math.max(0, Math.min(maxY, pointerLabelDrag.original.y + dy)),
        });
        return;
      }
      const pointerTransform = pointerTransformRef.current;
      if (pointerTransform) {
        const local = localPointer();
        if (!local) return;
        const imageWidth = image?.naturalWidth ?? image?.width ?? Number.POSITIVE_INFINITY;
        const imageHeight = image?.naturalHeight ?? image?.height ?? Number.POSITIVE_INFINITY;
        const bounded = {
          x: Math.max(0, Math.min(imageWidth, local.x)),
          y: Math.max(0, Math.min(imageHeight, local.y)),
        };
        if (!pointerTransform.moved) {
          const origin = pointerTransform.original;
          const originHandle = annotationTransformHandles(origin).find((candidate) => candidate.handle === pointerTransform.handle);
          if (!originHandle || Math.hypot(bounded.x - originHandle.x, bounded.y - originHandle.y) < 2 / Math.max(0.05, view.scale)) return;
        }
        pointerTransform.moved = true;
        updateAnnotation(
          pointerTransform.id,
          resizeAnnotationFromHandle(pointerTransform.original, pointerTransform.handle, bounded),
        );
        return;
      }
      const pointerDrag = pointerDragRef.current;
      if (!pointerDrag) return;
      const target = currentAnnotations.find((annotation) => annotation.id === pointerDrag.id);
      const local = localPointer();
      if (!target || !local) return;
      const dx = local.x - pointerDrag.start.x;
      const dy = local.y - pointerDrag.start.y;
      if (!pointerDrag.moved && Math.hypot(dx, dy) < 2 / Math.max(0.05, view.scale)) return;
      pointerDrag.moved = true;
      pointerJustMovedRef.current = true;
      if (target.kind === "freehand" || target.kind === "highlight") {
        const points = target.points ?? [];
        updateAnnotation(target.id, {
          points: points.map((value, index) => value + (index % 2 === 0 ? dx : dy)),
        });
      } else {
        const patch: Partial<Annotation> = { x: target.x + dx, y: target.y + dy };
        if (target.kind === "arrow" && (target.labelX !== undefined || target.labelY !== undefined)) {
          const label = annotationLabelPosition(target);
          patch.labelX = label.x + dx;
          patch.labelY = label.y + dy;
        }
        updateAnnotation(target.id, patch);
      }
      pointerDrag.start = local;
      return;
    }
    const local = localPointer();
    if (!local) return;
    if ((annotationKind === "freehand" || annotationKind === "highlight") && freehandRef.current) {
      freehandRef.current.push(local.x, local.y);
      setDrawingTick((tick) => tick + 1);
    } else if (annotationKind === "eraser") {
      const hit = [...currentAnnotations].reverse().find((annotation) => (
        annotationHitTest(annotation, local, 14 / Math.max(0.05, view.scale))
      ));
      if (hit) removeAnnotation(hit.id);
    } else {
      setDrag((current) => current ? { ...current, x: local.x, y: local.y } : current);
    }
  }

  function onMouseUp() {
    if (effectiveTool !== "annotate") return;
    const currentAnnotations = annotationsRef.current;
    if (annotationKind === "pointer") {
      const pointerLabelDrag = pointerLabelDragRef.current;
      if (pointerLabelDrag) {
        const target = currentAnnotations.find((annotation) => annotation.id === pointerLabelDrag.id);
        if (pointerLabelDrag.moved && target) {
          commitAnnotationUpdate(
            pointerLabelDrag.id,
            pointerLabelDrag.originalAnnotation,
            target,
            "annotation-label-drag",
          );
        }
        pointerLabelDragRef.current = null;
        pointerDragRef.current = null;
        pointerTransformRef.current = null;
        pointerHitRef.current = null;
        pointerJustMovedRef.current = pointerLabelDrag.moved;
        return;
      }
      const pointerTransform = pointerTransformRef.current;
      if (pointerTransform) {
        const target = currentAnnotations.find((annotation) => annotation.id === pointerTransform.id);
        if (pointerTransform.moved && target) {
          commitAnnotationUpdate(
            pointerTransform.id,
            pointerTransform.original,
            target,
            "annotation-transform",
          );
        }
        pointerTransformRef.current = null;
        pointerDragRef.current = null;
        pointerHitRef.current = null;
        pointerJustMovedRef.current = pointerTransform.moved;
        return;
      }
      const pointerDrag = pointerDragRef.current;
      const hitId = pointerHitRef.current;
      const target = pointerDrag
        ? currentAnnotations.find((annotation) => annotation.id === pointerDrag.id)
        : null;
      if (pointerDrag?.moved && target) {
        commitAnnotationUpdate(pointerDrag.id, pointerDrag.original, target, "annotation-drag");
      }
      pointerDragRef.current = null;
      pointerHitRef.current = null;
      if (pointerDrag?.moved) pointerJustMovedRef.current = true;
      else if (hitId) onSelect(hitId);
      return;
    }
    if ((annotationKind === "freehand" || annotationKind === "highlight") && freehandRef.current) {
      const points = freehandRef.current;
      freehandRef.current = null;
      if (points.length >= 4) {
        addAnnotation({
          id: crypto.randomUUID(),
          kind: annotationKind,
          x: 0,
          y: 0,
          color: annotationColor,
          strokeWidth: annotationStrokeWidth,
          fontSize: annotationFontSize,
          opacity: annotationKind === "highlight" ? 0.32 : 1,
          points,
        });
      }
      setDrawingTick((tick) => tick + 1);
      return;
    }
    if (!drag) return;
    const width = drag.x - drag.sx;
    const height = drag.y - drag.sy;
    if (Math.hypot(width, height) >= ANNOTATION_MIN_LENGTH) {
      const id = crypto.randomUUID();
      const common = {
        id,
        color: annotationColor,
        strokeWidth: annotationStrokeWidth,
        fontSize: annotationFontSize,
      };
      if (drag.kind === "rect" || drag.kind === "ellipse") {
        addAnnotation({
          ...common,
          kind: drag.kind,
          x: Math.min(drag.sx, drag.x),
          y: Math.min(drag.sy, drag.y),
          width: Math.abs(width),
          height: Math.abs(height),
        });
      } else if (drag.kind === "line") {
        addAnnotation({ ...common, kind: "line", x: drag.sx, y: drag.sy, width, height });
      } else if (drag.kind === "arrow" || drag.kind === "plainArrow") {
        const created: Annotation = {
          ...common,
          kind: "arrow",
          x: drag.sx,
          y: drag.sy,
          width,
          height,
          ...(drag.kind === "arrow"
            ? { bend: getDefaultAnnotationArrowBend(width, height, 1), text: "" }
            : { bend: 0 }),
        };
        addAnnotation(created);
        setSelectedAnnotationId(id);
        if (drag.kind === "arrow") setEditingAnnotation({ id, text: "", original: cloneAnnotationForHistory(created) });
      }
    }
    setDrag(null);
  }

  function onSelect(id: string) {
    if (pointerJustMovedRef.current) {
      pointerJustMovedRef.current = false;
      return;
    }
    setSelectedAnnotationId(id);
  }

  function onActivate(id: string) {
    if (effectiveTool !== "annotate" || annotationKind !== "pointer") return;
    if (pointerJustMovedRef.current) {
      pointerJustMovedRef.current = false;
      return;
    }
    setSelectedAnnotationId(id);
    const target = annotationsRef.current.find((annotation) => annotation.id === id);
    if (target?.kind === "text" || (target?.kind === "arrow" && (Boolean(target.text?.trim()) || Math.abs(target.bend ?? 0) > 0))) {
      setEditingAnnotation({ id, text: target.text ?? "", original: cloneAnnotationForHistory(target) });
    }
  }

  function onEditCancel() {
    const edit = annotationEditRef.current;
    if (!edit) return;
    const target = annotationsRef.current.find((annotation) => annotation.id === edit.id);
    const removed = Boolean(target && !target.text?.trim());
    if (removed && target) removeAnnotation(target.id);
    if (!removed) setSelectedAnnotationId(edit.id);
    setEditingAnnotation(null);
    setAnnotationKind("pointer");
  }

  function commitCurrentAnnotationEdit(switchToPointer = true) {
    const edit = annotationEditRef.current;
    if (!edit) return;
    const target = annotationsRef.current.find((annotation) => annotation.id === edit.id);
    if (!target) {
      setEditingAnnotation(null);
      if (switchToPointer) setAnnotationKind("pointer");
      return;
    }
    const text = edit.text.trim();
    const next = { ...target, text };
    // Use the latest store snapshot as the undo baseline. This prevents a
    // style/selection update that landed while typing from making the text
    // commit look stale and silently discarding the draft.
    commitAnnotationUpdate(target.id, cloneAnnotationForHistory(target), next, "annotation-text-edit");
    setSelectedAnnotationId(edit.id);
    setEditingAnnotation(null);
    if (switchToPointer) setAnnotationKind("pointer");
  }

  function onEditCommit() {
    commitCurrentAnnotationEdit(true);
  }

  function onEditBlur(event: FocusEvent<HTMLTextAreaElement>) {
    if (!annotationEditRef.current) return;
    const latest = event.currentTarget.value;
    if (latest !== annotationEditRef.current.text) {
      setEditingAnnotation({ ...annotationEditRef.current, text: latest });
    }
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    const canvasTarget = !relatedTarget || Boolean(relatedTarget.closest(".stage-canvas-wrap, .konvajs-content"));
    if (canvasTarget) ignoreNextStagePointerRef.current = true;
    commitCurrentAnnotationEdit(canvasTarget);
    if (canvasTarget) {
      const clear = () => { ignoreNextStagePointerRef.current = false; };
      window.setTimeout(clear, 0);
    }
  }

  function onContextMenu(event: Konva.KonvaEventObject<PointerEvent>): boolean {
    if (effectiveTool !== "annotate" || annotationKind !== "pointer") return false;
    event.evt.preventDefault();
    const local = localPointer();
    if (!local) return true;
    const hit = [...annotationsRef.current].reverse().find((annotation) => {
      const tolerance = annotationSelectionTolerance(annotation, view.scale);
      const labelBounds = annotationLabelBounds(annotation);
      const labelHit = labelBounds
        && local.x >= labelBounds.x - tolerance
        && local.x <= labelBounds.x + labelBounds.width + tolerance
        && local.y >= labelBounds.y - tolerance
        && local.y <= labelBounds.y + labelBounds.height + tolerance;
      return Boolean(labelHit) || annotationHitTest(annotation, local, tolerance);
    });
    if (hit) {
      setSelectedAnnotationId(hit.id);
      setEditingAnnotation(null);
      onAnnotationContextMenu?.(hit.id, event.evt.clientX, event.evt.clientY);
    }
    return true;
  }

  return {
    drag,
    freehandPoints: freehandRef.current,
    annotationEdit,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onContextMenu,
    onSelect,
    onActivate,
    onEditChange: (text: string) => {
      const current = annotationEditRef.current;
      if (!current) return;
      setEditingAnnotation({ ...current, text });
    },
    onEditCancel,
    onEditCommit,
    onEditBlur,
  };
}
