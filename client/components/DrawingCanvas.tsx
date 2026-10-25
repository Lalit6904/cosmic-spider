import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DrawingPoint, DrawingStroke } from '../../shared/protocol';

interface DrawingCanvasProps {
  strokes: DrawingStroke[];
  canDraw: boolean;
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
  onChunk: (stroke: {
    strokeId: string;
    color: string;
    width: number;
    tool: 'pen' | 'eraser';
    points: DrawingPoint[];
  }) => void;
  onEnd: (strokeId: string) => void;
  onComplete: (stroke: DrawingStroke) => void;
  label: string;
}

interface LiveStroke extends DrawingStroke {
  finished: boolean;
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: DrawingStroke,
  width: number,
  height: number,
): void {
  if (stroke.points.length === 0) return;
  const scale = Math.max(0.55, Math.min(width, height) / 700);
  context.save();
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = Math.max(1, stroke.width * scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const points = stroke.points;
  const first = points[0]!;
  if (points.length === 1) {
    context.beginPath();
    context.arc(first.x * width, first.y * height, Math.max(0.5, context.lineWidth / 2), 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(first.x * width, first.y * height);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index]!;
      context.lineTo(point.x * width, point.y * height);
    }
    context.stroke();
  }
  context.restore();
}

export function DrawingCanvas({
  strokes,
  canDraw,
  color,
  width,
  tool,
  onChunk,
  onEnd,
  onComplete,
  label,
}: DrawingCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokes);
  const liveRef = useRef<LiveStroke | null>(null);
  const settingsRef = useRef({ color, width, tool });
  const pointerRef = useRef<{
    pointerId: number;
    pending: DrawingPoint[];
    lastSentAt: number;
    lastPoint: DrawingPoint;
  } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSize, setHasSize] = useState(false);

  settingsRef.current = { color, width, tool };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      setHasSize(true);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    const merged = new Map<string, DrawingStroke>();
    for (const stroke of strokesRef.current) merged.set(stroke.id, stroke);
    if (liveRef.current) merged.set(liveRef.current.id, liveRef.current);
    for (const stroke of merged.values()) {
      drawStroke(context, stroke, rect.width, rect.height);
    }
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    const live = liveRef.current;
    if (live?.finished && strokes.some((stroke) => stroke.id === live.id)) {
      liveRef.current = null;
    }
    redraw();
  }, [strokes, redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    redraw();
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    if (!canDraw && liveRef.current) {
      liveRef.current = null;
      pointerRef.current = null;
      setDrawing(false);
      redraw();
    }
  }, [canDraw, redraw]);

  const toPoint = (event: ReactPointerEvent<HTMLCanvasElement>): DrawingPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const sendPending = useCallback(
    (force = false) => {
      const pointer = pointerRef.current;
      const live = liveRef.current;
      if (!pointer || !live || pointer.pending.length === 0) return;
      const now = performance.now();
      if (!force && now - pointer.lastSentAt < 45) return;
      const points = pointer.pending;
      pointer.pending = [];
      pointer.lastSentAt = now;
      onChunk({
        strokeId: live.id,
        color: live.color,
        width: live.width,
        tool: live.tool,
        points,
      });
    },
    [onChunk],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || event.button !== 0 || pointerRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPoint(event);
    const paint = settingsRef.current;
    const stroke: LiveStroke = {
      id: crypto.randomUUID(),
      color: paint.color,
      width: paint.width,
      tool: paint.tool,
      points: [point],
      finished: false,
    };
    liveRef.current = stroke;
    pointerRef.current = {
      pointerId: event.pointerId,
      pending: [point],
      lastSentAt: 0,
      lastPoint: point,
    };
    setDrawing(true);
    sendPending(true);
    redraw();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !pointerRef.current || pointerRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = toPoint(event);
    const pointer = pointerRef.current;
    const live = liveRef.current;
    if (!live) return;
    const distance = Math.hypot(point.x - pointer.lastPoint.x, point.y - pointer.lastPoint.y);
    if (distance < 0.0007) return;
    const previousPoint = pointer.lastPoint;
    pointer.lastPoint = point;
    pointer.pending.push(point);
    live.points.push(point);

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.max(0.55, Math.min(rect.width, rect.height) / 700);
      context.save();
      context.globalCompositeOperation = live.tool === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = live.color;
      context.lineWidth = Math.max(1, live.width * scale);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(previousPoint.x * rect.width, previousPoint.y * rect.height);
      context.lineTo(point.x * rect.width, point.y * rect.height);
      context.stroke();
      context.restore();
    }
    sendPending();
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current || pointerRef.current.pointerId !== event.pointerId) return;
    const live = liveRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    sendPending(true);
    if (live) {
      live.finished = true;
      onEnd(live.id);
      onComplete({
        id: live.id,
        color: live.color,
        width: live.width,
        tool: live.tool,
        points: [...live.points],
      });
    }
    pointerRef.current = null;
    setDrawing(false);
    redraw();
  };

  return (
    <div
      className={`canvas-wrap ${canDraw ? 'canvas-wrap--active' : 'canvas-wrap--readonly'} ${
        drawing ? 'canvas-wrap--drawing' : ''
      }`}
    >
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onContextMenu={(event) => event.preventDefault()}
        tabIndex={canDraw ? 0 : -1}
        role="img"
        aria-label={label}
        data-ready={hasSize || undefined}
      />
      {!canDraw && (
        <div className="canvas-readonly-note">
          <span aria-hidden="true">◌</span> Watch the constellation form
        </div>
      )}
    </div>
  );
}
