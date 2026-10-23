import { useEffect, useRef, useState, type PointerEvent } from "react";
import { usePlotArea, useXAxisInverseScale, ZIndexLayer } from "recharts";
import type { AbsoluteRange } from "@/lib/metrics";

interface Drag {
  pointer: number;
  start: number;
  end: number;
  left: number;
  width: number;
  from: number;
  to: number;
}

export function ChartZoom({
  onZoom,
  onInspect,
  enabled,
  title,
}: {
  onZoom: (range: AbsoluteRange) => void;
  onInspect?: (timestamp: number) => void;
  enabled: boolean;
  title: string;
}) {
  const plot = usePlotArea();
  const inverse = useXAxisInverseScale();
  const drag = useRef<Drag | null>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const dragging = selection !== null;
  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drag.current = null;
        setSelection(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dragging]);
  if (!plot || !inverse || !enabled) return null;
  function position(event: PointerEvent<SVGRectElement>): number {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
    return matrix
      ? new DOMPoint(event.clientX, event.clientY).matrixTransform(
          matrix.inverse(),
        ).x
      : NaN;
  }
  function down(event: PointerEvent<SVGRectElement>) {
    if (event.button !== 0 || !event.isPrimary || !plot || !inverse) return;
    const x = position(event);
    const from = Number(inverse(plot.x));
    const to = Number(inverse(plot.x + plot.width));
    if (![x, from, to].every(Number.isFinite) || from >= to) return;
    drag.current = {
      pointer: event.pointerId,
      start: x,
      end: x,
      left: plot.x,
      width: plot.width,
      from,
      to,
    };
    setSelection({ start: x, end: x });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGRectElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const x = position(event);
    if (!Number.isFinite(x)) return;
    current.end = Math.max(
      current.left,
      Math.min(current.left + current.width, x),
    );
    setSelection({ start: current.start, end: current.end });
  }
  function cancel() {
    drag.current = null;
    setSelection(null);
  }
  function up(event: PointerEvent<SVGRectElement>) {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    move(event);
    const current = drag.current;
    cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    // A click inspects a sample; a drag selects a time range in either direction.
    if (!current) return;
    const at = (x: number) =>
      Math.round(
        current.from +
          ((x - current.left) / current.width) * (current.to - current.from),
      );
    if (Math.abs(current.end - current.start) < 6) {
      onInspect?.(Math.max(0, at(current.start)));
      return;
    }
    const from = Math.max(0, at(Math.min(current.start, current.end)));
    const to = at(Math.max(current.start, current.end));
    if (from < to) onZoom({ from, to });
  }
  return (
    <ZIndexLayer zIndex={3000}>
      <g>
        <rect
          data-zoom-plot={title}
          x={plot.x}
          y={plot.y}
          width={plot.width}
          height={plot.height}
          fill="transparent"
          className="cursor-crosshair"
          style={{ touchAction: "pan-y" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
        />
        {selection && (
          <rect
            x={Math.min(selection.start, selection.end)}
            y={plot.y}
            width={Math.abs(selection.end - selection.start)}
            height={plot.height}
            fill="var(--primary)"
            fillOpacity={0.15}
            stroke="var(--primary)"
            strokeOpacity={0.5}
            pointerEvents="none"
          />
        )}
      </g>
    </ZIndexLayer>
  );
}
