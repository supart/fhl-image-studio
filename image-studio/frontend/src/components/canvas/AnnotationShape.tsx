import { Arrow, Ellipse, Group, Line, Rect, Text } from "react-konva";
import Konva from "konva";
import type { Annotation } from "../../types/domain";
import { arrowControlPoint } from "../../features/annotation/annotationGeometry";
import {
  annotationArrowHeadSize,
  annotationFontSize,
  annotationLabelPosition,
  annotationStrokeWidth,
} from "../../features/annotation/annotationTypes";

export function AnnotationShape({
  annotation,
  selected,
  onSelect,
  onActivate,
  viewScale = 1,
}: {
  annotation: Annotation;
  selected: boolean;
  onSelect: () => void;
  onActivate?: () => void;
  viewScale?: number;
}) {
  const halo = selected ? "#4d7cff" : undefined;
  const strokeWidth = annotationStrokeWidth(annotation, annotation.kind === "highlight" ? 18 : 3);
  const fontSize = annotationFontSize(annotation);
  const arrowHeadSize = annotationArrowHeadSize(strokeWidth);
  const opacity = annotation.opacity ?? 1;
  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    onSelect();
  };
  const onDoubleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!onActivate) return;
    e.cancelBubble = true;
    onActivate();
  };

  if (annotation.kind === "rect") {
    return (
      <Rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.width ?? 0}
        height={annotation.height ?? 0}
        stroke={annotation.color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        onClick={onClick}
        onDblClick={onDoubleClick}
      />
    );
  }

  if (annotation.kind === "ellipse") {
    return (
      <Ellipse
        x={annotation.x + (annotation.width ?? 0) / 2}
        y={annotation.y + (annotation.height ?? 0) / 2}
        radiusX={Math.abs(annotation.width ?? 0) / 2}
        radiusY={Math.abs(annotation.height ?? 0) / 2}
        stroke={annotation.color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        onClick={onClick}
        onDblClick={onDoubleClick}
      />
    );
  }

  if (annotation.kind === "arrow") {
    const control = arrowControlPoint(annotation);
    return (
      <Group onClick={onClick} onDblClick={onDoubleClick}>
        <Arrow
          points={[
            annotation.x,
            annotation.y,
            control.x,
            control.y,
            annotation.x + (annotation.width ?? 0),
            annotation.y + (annotation.height ?? 0),
          ]}
          stroke={annotation.color}
          strokeWidth={strokeWidth}
          fill={annotation.color}
          pointerLength={arrowHeadSize}
          pointerWidth={arrowHeadSize}
          tension={0.5}
          opacity={opacity}
          shadowColor={halo}
          shadowBlur={selected ? 12 : 0}
          shadowOpacity={selected ? 0.9 : 0}
          onClick={onClick}
          onDblClick={onDoubleClick}
        />
        {annotation.text?.trim() ? (
          (() => {
            const label = annotationLabelPosition(annotation);
            return (
          <Text
            x={label.x}
            y={label.y}
            text={annotation.text}
            fill={annotation.color}
            fontSize={fontSize}
            opacity={opacity}
            padding={2}
            onClick={onClick}
            onDblClick={onDoubleClick}
          />
            );
          })()
        ) : null}
      </Group>
    );
  }

  if (annotation.kind === "line") {
    return (
      <Line
        points={[annotation.x, annotation.y, annotation.x + (annotation.width ?? 0), annotation.y + (annotation.height ?? 0)]}
        stroke={annotation.color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={10 / Math.max(0.05, viewScale)}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        onClick={onClick}
        onDblClick={onDoubleClick}
      />
    );
  }

  if (annotation.kind === "freehand" || annotation.kind === "highlight") {
    return (
      <Line
        points={annotation.points ?? []}
        stroke={annotation.color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        lineCap="round"
        lineJoin="round"
        tension={0.4}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        hitStrokeWidth={10 / Math.max(0.05, viewScale)}
        onClick={onClick}
        onDblClick={onDoubleClick}
      />
    );
  }

  return (
    <Text
      x={annotation.x}
      y={annotation.y}
      text={annotation.text ?? ""}
      fill={annotation.color}
      fontSize={fontSize}
      opacity={opacity}
      shadowColor={halo}
      shadowBlur={selected ? 8 : 0}
      shadowOpacity={selected ? 0.9 : 0}
      onClick={onClick}
      onDblClick={onDoubleClick}
    />
  );
}
