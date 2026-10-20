import { Arrow, Circle, Ellipse, Line, Rect } from "react-konva";
import type Konva from "konva";
import type { Annotation } from "./annotationTypes";
import { annotationTransformHandles, arrowControlPoint, getDefaultAnnotationArrowBend } from "./annotationGeometry";
import { annotationArrowHeadSize } from "./annotationTypes";
import { AnnotationShape } from "../../components/canvas/AnnotationShape";

export function AnnotationLayer({
  annotations,
  selectedAnnotationId,
  annotationKind,
  viewScale,
  onSelect,
  onActivate,
  drag,
  color,
  freehandPoints,
  strokeWidth,
}: {
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  annotationKind: Annotation["kind"] | "plainArrow" | "pointer" | "eraser";
  viewScale: number;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  drag?: { kind: Annotation["kind"] | "plainArrow"; sx: number; sy: number; x: number; y: number } | null;
  color: string;
  freehandPoints?: number[] | null;
  strokeWidth: number;
}) {
  const scaled = Math.max(0.05, viewScale);
  return (
    <>
      {annotations.map((annotation) => (
        <AnnotationShape
          key={annotation.id}
          annotation={annotation}
          selected={selectedAnnotationId === annotation.id}
          viewScale={scaled}
          onSelect={() => onSelect(annotation.id)}
          onActivate={() => onActivate(annotation.id)}
        />
      ))}
      {annotationKind === "pointer" && selectedAnnotationId ? (() => {
        const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId);
        if (!selected) return null;
        const handleRadius = Math.max(5, 7 / scaled);
        return annotationTransformHandles(selected).map((handle) => (
          <Circle
            key={`transform-${selected.id}-${handle.handle}`}
            x={handle.x}
            y={handle.y}
            radius={handleRadius}
            fill="#ffffff"
            stroke="#4d7cff"
            strokeWidth={Math.max(1, 2 / scaled)}
            shadowColor="#1f3c88"
            shadowBlur={3 / scaled}
            shadowOpacity={0.45}
            listening={false}
          />
        ));
      })() : null}
      {drag?.kind === "rect" && (
        <Rect
          x={Math.min(drag.sx, drag.x)}
          y={Math.min(drag.sy, drag.y)}
          width={Math.abs(drag.x - drag.sx)}
          height={Math.abs(drag.y - drag.sy)}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={[6 / scaled, 4 / scaled]}
          listening={false}
        />
      )}
      {drag?.kind === "ellipse" && (
        <Ellipse
          x={(drag.sx + drag.x) / 2}
          y={(drag.sy + drag.y) / 2}
          radiusX={Math.abs(drag.x - drag.sx) / 2}
          radiusY={Math.abs(drag.y - drag.sy) / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={[6 / scaled, 4 / scaled]}
          listening={false}
        />
      )}
      {(drag?.kind === "line" || drag?.kind === "arrow" || drag?.kind === "plainArrow") && (
        <Arrow
          points={drag.kind === "arrow" || drag.kind === "plainArrow"
            ? (() => {
                const preview: Annotation = {
                  id: "preview",
                  kind: "arrow",
                  x: drag.sx,
                  y: drag.sy,
                  width: drag.x - drag.sx,
                  height: drag.y - drag.sy,
                  color,
                  bend: drag.kind === "arrow"
                    ? getDefaultAnnotationArrowBend(drag.x - drag.sx, drag.y - drag.sy, 1)
                    : 0,
                };
                const control = arrowControlPoint(preview);
                return [drag.sx, drag.sy, control.x, control.y, drag.x, drag.y];
              })()
            : [drag.sx, drag.sy, drag.x, drag.y]}
          stroke={color}
          strokeWidth={strokeWidth}
          fill={drag.kind === "arrow" || drag.kind === "plainArrow" ? color : undefined}
          pointerLength={drag.kind === "arrow" || drag.kind === "plainArrow" ? annotationArrowHeadSize(strokeWidth) : 0}
          pointerWidth={drag.kind === "arrow" || drag.kind === "plainArrow" ? annotationArrowHeadSize(strokeWidth) : 0}
          tension={drag.kind === "arrow" || drag.kind === "plainArrow" ? 0.5 : 0}
          listening={false}
        />
      )}
      {freehandPoints && freehandPoints.length >= 4 ? (
        <Line
          points={freehandPoints.slice()}
          stroke={color}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          listening={false}
        />
      ) : null}
    </>
  );
}

export type AnnotationKonvaEvent = Konva.KonvaEventObject<MouseEvent>;
