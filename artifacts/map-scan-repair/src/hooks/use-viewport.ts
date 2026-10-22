import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentImage, Point } from '@/lib/types';

export function useViewport(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  documentImage: DocumentImage | null,
) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const fitZoomRef = useRef(1);
  const needsFitRef = useRef(false);
  const prevSizeRef = useRef({ width: 0, height: 0 });

  const fitImage = useCallback((size?: { width: number; height: number }) => {
    if (!documentImage || !wrapRef.current) return;
    const width = size?.width ?? wrapRef.current.clientWidth;
    const height = size?.height ?? wrapRef.current.clientHeight;
    if (!width || !height) return;
    // Math.max(1, …) защищает от отрицательного/нулевого зума в узком контейнере
    const nextZoom = Math.max(0.01, Math.min(Math.max(1, width - 70) / documentImage.width, Math.max(1, height - 65) / documentImage.height, 1.25));
    fitZoomRef.current = nextZoom;
    setZoom(nextZoom);
    setPan({ x: (width - documentImage.width * nextZoom) / 2, y: (height - documentImage.height * nextZoom) / 2 });
  }, [documentImage, wrapRef]);

  // Возвращает true, если зум действительно изменился: колесо мыши перехватывает
  // скролл только в этом случае — на границе диапазона прокрутка остаётся живой.
  const zoomAt = (point: Point, factor: number): boolean => {
    // Без документа зум «в пустоту» только меняет счётчик процентов — не даём.
    if (!documentImage) return false;
    const minZoom = Math.min(0.08, fitZoomRef.current);
    const next = Math.max(minZoom, Math.min(4, zoom * factor));
    if (next === zoom) return false;
    setZoom(next);
    setPan({ x: point.x - ((point.x - pan.x) / zoom) * next, y: point.y - ((point.y - pan.y) / zoom) * next });
    return true;
  };
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;

  const canvasCenter = useCallback(() => {
    const element = wrapRef.current;
    return element ? { x: element.clientWidth / 2, y: element.clientHeight / 2 } : { x: 0, y: 0 };
  }, [wrapRef]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!documentImage) return;
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      if (!zoomAtRef.current({ x: event.clientX - rect.left, y: event.clientY - rect.top }, factor)) return;
      event.preventDefault();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [documentImage, wrapRef]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const prev = prevSizeRef.current;
      const next = { width: box.width, height: box.height };
      prevSizeRef.current = next;
      setCanvasSize(next);
      // При изменении контейнера держим центр документа у центра холста:
      // иначе после resize окна документ может уехать за край.
      if (prev.width > 0 && prev.height > 0) {
        const dx = (next.width - prev.width) / 2;
        const dy = (next.height - prev.height) / 2;
        setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [wrapRef]);

  useEffect(() => {
    if (documentImage && canvasSize.width && canvasSize.height && needsFitRef.current) {
      needsFitRef.current = false;
      fitImage(canvasSize);
    }
  }, [documentImage, canvasSize, fitImage]);

  return { zoom, setZoom, pan, setPan, canvasSize, fitImage, zoomAt, canvasCenter, zoomAtRef, needsFitRef };
}
