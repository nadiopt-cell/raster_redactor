import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowDownToLine, ArrowLeftRight, CircleHelp, Eye, EyeOff, FileImage, FilePlus2,
  Hand, MousePointer2, RotateCcw,
  RotateCw, ScanLine, Undo2, Redo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type Point = { x: number; y: number };
type Pair = { source: Point; target: Point };
type Fragment = { id: number; polygon: Point[]; dx: number; dy: number; rotation: number; pairs: Pair[]; visible: boolean };
type DocumentImage = { image: HTMLImageElement; name: string; width: number; height: number };
type Tool = 'select' | 'lasso' | 'points' | 'pan';
type HistoryEntry = { fragments: Fragment[]; selectedId: number | null };
const HISTORY_LIMIT = 100;
// Лимиты холста браузера: сторона не более 32767 px, консервативная площадь 100 Мп (Safari/iOS).
const MAX_CANVAS_EDGE = 32_767;
const MAX_CANVAS_PIXELS = 100_000_000;

const cloneFragments = (items: Fragment[]) => items.map((item) => ({
  ...item, polygon: item.polygon.map((p) => ({ ...p })),
  pairs: item.pairs.map((pair) => ({ source: { ...pair.source }, target: { ...pair.target } })),
}));
const centroid = (poly: Point[]) => poly.reduce((v, p) => ({ x: v.x + p.x / poly.length, y: v.y + p.y / poly.length }), { x: 0, y: 0 });
const polygonCentroids = new WeakMap<Point[], Point>();
const cachedCentroid = (poly: Point[]) => {
  const cached = polygonCentroids.get(poly);
  if (cached) return cached;
  const center = centroid(poly);
  polygonCentroids.set(poly, center);
  return center;
};
const expandPolygon = (points: Point[], by: number) => {
  const center = centroid(points);
  return points.map((point) => {
    const dx = point.x - center.x; const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * by, y: point.y + (dy / length) * by };
  });
};
const sourceBBox = (points: Point[], padding: number, imageWidth: number, imageHeight: number) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  points.forEach((point) => {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  });
  const sx = Math.max(0, Math.floor(minX - padding));
  const sy = Math.max(0, Math.floor(minY - padding));
  const sw = Math.min(imageWidth, Math.ceil(maxX + padding)) - sx;
  const sh = Math.min(imageHeight, Math.ceil(maxY + padding)) - sy;
  return { sx, sy, sw: Math.max(0, sw), sh: Math.max(0, sh) };
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pointInside = (point: Point, poly: Point[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const pointOnOrNearPolygon = (point: Point, poly: Point[], tolerance: number) => {
  if (pointInside(point, poly)) return true;
  return poly.some((a, index) => {
    const b = poly[(index + 1) % poly.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= tolerance;
  });
};
const transformedPoint = (point: Point, fragment: Fragment) => {
  const center = cachedCentroid(fragment.polygon); const angle = fragment.rotation * Math.PI / 180;
  const x = point.x - center.x; const y = point.y - center.y;
  return { x: center.x + fragment.dx + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + fragment.dy + x * Math.sin(angle) + y * Math.cos(angle) };
};
const inverseFragmentPoint = (point: Point, fragment: Fragment) => {
  const center = cachedCentroid(fragment.polygon); const angle = -fragment.rotation * Math.PI / 180;
  const x = point.x - center.x - fragment.dx; const y = point.y - center.y - fragment.dy;
  return { x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) };
};

type MeshPoint = { source: Point; target: Point };
type Triangle = [number, number, number];
const circumcircle = (a: Point, b: Point, c: Point) => {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return { x: 0, y: 0, r2: -1 };
  const aa = a.x * a.x + a.y * a.y; const bb = b.x * b.x + b.y * b.y; const cc = c.x * c.x + c.y * c.y;
  const x = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
  const y = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  return { x, y, r2: (x - a.x) ** 2 + (y - a.y) ** 2 };
};
const triangulate = (points: Point[]): Triangle[] => {
  if (points.length < 3) return [];
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys); const maxX = Math.max(...xs); const maxY = Math.max(...ys);
  const delta = Math.max(maxX - minX, maxY - minY) * 10 + 1;
  const all = [...points, { x: minX - delta, y: minY - delta }, { x: minX + (maxX - minX) / 2, y: maxY + delta }, { x: maxX + delta, y: minY - delta }];
  const n = points.length; let triangles: Triangle[] = [[n, n + 1, n + 2]];
  for (let index = 0; index < n; index++) {
    const bad = triangles.filter((tri) => {
      const circle = circumcircle(all[tri[0]], all[tri[1]], all[tri[2]]);
      return circle.r2 >= 0 && (all[index].x - circle.x) ** 2 + (all[index].y - circle.y) ** 2 <= circle.r2 + 1e-6;
    });
    const edges: [number, number][] = [];
    bad.forEach((tri) => [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].forEach((edge) => {
      const reverse = edges.findIndex((candidate) => candidate[0] === edge[1] && candidate[1] === edge[0]);
      if (reverse >= 0) edges.splice(reverse, 1); else edges.push(edge as [number, number]);
    }));
    triangles = triangles.filter((tri) => !bad.includes(tri));
    edges.forEach((edge) => triangles.push([edge[0], edge[1], index]));
  }
  return triangles.filter((tri) => tri.every((index) => index < n));
};
const applyAffineTriangle = (ctx: CanvasRenderingContext2D, src: Point[], dst: Point[]) => {
  const [a, b, c] = src; const [u, v, w] = dst;
  const det = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  if (Math.abs(det) < 0.0001) return false;
  const m11 = (u.x * (b.y - c.y) + v.x * (c.y - a.y) + w.x * (a.y - b.y)) / det;
  const m12 = (u.y * (b.y - c.y) + v.y * (c.y - a.y) + w.y * (a.y - b.y)) / det;
  const m21 = (u.x * (c.x - b.x) + v.x * (a.x - c.x) + w.x * (b.x - a.x)) / det;
  const m22 = (u.y * (c.x - b.x) + v.y * (a.x - c.x) + w.y * (b.x - a.x)) / det;
  const dx = (u.x * (b.x * c.y - c.x * b.y) + v.x * (c.x * a.y - a.x * c.y) + w.x * (a.x * b.y - b.x * a.y)) / det;
  const dy = (u.y * (b.x * c.y - c.x * b.y) + v.y * (c.x * a.y - a.x * c.y) + w.y * (a.x * b.y - b.x * a.y)) / det;
  ctx.transform(m11, m12, m21, m22, dx, dy);
  return true;
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ kind: 'pan' | 'fragment'; pointer: Point; pan: Point; fragments: Fragment[]; id?: number } | null>(null);
  const loadTokenRef = useRef(0);
  const userFileLoadedRef = useRef(false);
  const idCounter = useRef(1);
  const [documentImage, setDocumentImage] = useState<DocumentImage | null>(null);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([{ fragments: [], selectedId: null }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<Point[]>([]);
  const [pendingSource, setPendingSource] = useState<Point | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedFragment = fragments.find((fragment) => fragment.id === selectedId) ?? null;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const canWarp = !!selectedFragment && selectedFragment.pairs.length >= 3;

  const commit = useCallback((next: Fragment[], nextSelectedId?: number | null) => {
    const clean = cloneFragments(next);
    const selection = nextSelectedId === undefined ? selectedId : nextSelectedId;
    setFragments(clean);
    setHistory((old) => {
      const trimmed = [...old.slice(0, historyIndex + 1), { fragments: cloneFragments(clean), selectedId: selection ?? null }];
      return trimmed.length > HISTORY_LIMIT ? trimmed.slice(trimmed.length - HISTORY_LIMIT) : trimmed;
    });
    setHistoryIndex(Math.min(historyIndex + 1, HISTORY_LIMIT - 1));
  }, [historyIndex, selectedId]);

  const fitImage = useCallback((size?: { width: number; height: number }) => {
    if (!documentImage || !wrapRef.current) return;
    const width = size?.width ?? wrapRef.current.clientWidth;
    const height = size?.height ?? wrapRef.current.clientHeight;
    if (!width || !height) return;
    const nextZoom = Math.min((width - 70) / documentImage.width, (height - 65) / documentImage.height, 1.25);
    setZoom(nextZoom);
    setPan({ x: (width - documentImage.width * nextZoom) / 2, y: (height - documentImage.height * nextZoom) / 2 });
  }, [documentImage]);

  const loadImage = useCallback((image: HTMLImageElement, name: string) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE || width * height > MAX_CANVAS_PIXELS) {
      throw new Error(`Изображение слишком большое для браузера: ${Math.round(width * height / 1_000_000)} Мп, максимум ${Math.round(MAX_CANVAS_PIXELS / 1_000_000)} Мп. Уменьшите скан или сохраните его в PDF.`);
    }
    setDocumentImage({ image, name, width, height });
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setFragments([]);
    setHistory([{ fragments: [], selectedId: null }]);
    setHistoryIndex(0);
    setSelectedId(null);
    setDraftPolygon([]);
    setPendingSource(null);
    setError('');
    setNotice('');
  }, []);

  const loadPdf = useCallback(async (data: ArrayBuffer, name: string) => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
    try {
      const page = await pdf.getPage(1);
      try {
        const base = page.getViewport({ scale: 1 });
        const maxEdge = 6000;
        const maxPixels = 36_000_000;
        const scale = Math.min(
          maxEdge / base.width,
          maxEdge / base.height,
          Math.sqrt(maxPixels / (base.width * base.height)),
          8,
        );
        // Нижняя граница 0.05: раньше Math.max(1, scale) отменял ограничения для крупных страниц,
        // и canvas превышал лимиты браузера; теперь рендер всегда укладывается в лимит.
        const renderScale = Math.max(0.05, scale);
        const viewport = page.getViewport({ scale: renderScale });
        const pageCanvas = window.document.createElement('canvas');
        pageCanvas.width = Math.ceil(viewport.width);
        pageCanvas.height = Math.ceil(viewport.height);
        const context = pageCanvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Браузер не смог подготовить поверхность для PDF.');
        await page.render({ canvasContext: context, viewport }).promise;
        page.cleanup();
        const blob = await new Promise<Blob>((resolve, reject) => {
          pageCanvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error('Не удалось подготовить страницу PDF.'));
          }, 'image/png');
        });
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        try {
          image.src = objectUrl;
          await image.decode();
          await loadImage(image, name);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        const messages: string[] = [];
        if (renderScale < 1) {
          messages.push(`Страница PDF отрисована с уменьшением до ${Math.round(renderScale * 100)} %, чтобы уложиться в лимит холста браузера.`);
        }
        if (pdf.numPages > 1) {
          messages.push(`Открыта первая страница из ${pdf.numPages}. Остальные страницы PDF пока не загружены.`);
        }
        if (messages.length) setNotice(messages.join(' '));
      } finally {
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
  }, [loadImage]);

  const loadUrl = useCallback(async (url: string, name: string) => {
    const token = ++loadTokenRef.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Файл примера не найден.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const image = new Image();
      try {
        image.src = objectUrl;
        await image.decode();
        if (token !== loadTokenRef.current) return; // устаревшая загрузка: пользователь уже открыл свой файл
        await loadImage(image, name);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (caught) {
      if (token !== loadTokenRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Не удалось открыть документ.');
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [loadImage]);

  useEffect(() => {
    if (userFileLoadedRef.current) return;
    void loadUrl(`${import.meta.env.BASE_URL}example-map.jpg`, 'example-map.jpg');
  }, [loadUrl]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (fragments.length === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [fragments.length]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setCanvasSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (documentImage && canvasSize.width && canvasSize.height && pan.x === 0 && pan.y === 0) fitImage(canvasSize);
  }, [documentImage, canvasSize, pan, fitImage]);

  const drawScene = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, includeGuides: boolean) => {
    if (!documentImage) return;
    const { image } = documentImage;
    const displayedFragments = includeGuides
      ? fragments.filter((fragment) => fragment.visible || fragment.id === selectedId)
      : fragments;
    const holes = displayedFragments.filter((fragment) => fragment.polygon.length >= 3);
    ctx.save();
    if (holes.length) {
      ctx.beginPath();
      ctx.rect(0, 0, documentImage.width, documentImage.height);
      holes.forEach((fragment) => {
        ctx.moveTo(fragment.polygon[0].x, fragment.polygon[0].y);
        fragment.polygon.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();
      });
      try { ctx.clip('evenodd'); } catch { ctx.clip(); }
    }
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    holes.forEach((fragment) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(fragment.polygon[0].x, fragment.polygon[0].y);
      fragment.polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.fillStyle = '#d7cbb0';
      ctx.fill();
      ctx.restore();
    });
    holes.forEach((fragment) => {
      if (fragment.pairs.length >= 3) {
        const mesh: MeshPoint[] = fragment.polygon.map((source) => ({ source, target: transformedPoint(source, fragment) }));
        fragment.pairs.forEach((pair) => mesh.push({
          source: pair.source,
          target: transformedPoint(pair.target, fragment),
        }));
        const triangles = triangulate(mesh.map((point) => point.source));
        const boundary = expandPolygon(fragment.polygon.map((point) => transformedPoint(point, fragment)), 0.5);
        triangles.forEach((triangle) => {
          const src = triangle.map((index) => mesh[index].source);
          const dst = triangle.map((index) => mesh[index].target);
          const center = { x: (src[0].x + src[1].x + src[2].x) / 3, y: (src[0].y + src[1].y + src[2].y) / 3 };
          if (!pointInside(center, fragment.polygon)) return;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(boundary[0].x, boundary[0].y);
          boundary.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
          ctx.closePath();
          ctx.clip();
          const expandedDst = expandPolygon(dst, 0.5);
          ctx.beginPath(); ctx.moveTo(expandedDst[0].x, expandedDst[0].y); ctx.lineTo(expandedDst[1].x, expandedDst[1].y); ctx.lineTo(expandedDst[2].x, expandedDst[2].y); ctx.closePath(); ctx.clip();
          if (applyAffineTriangle(ctx, src, dst)) {
            const box = sourceBBox(src, 2, w, h);
            if (box.sw > 0 && box.sh > 0) ctx.drawImage(image, box.sx, box.sy, box.sw, box.sh, box.sx, box.sy, box.sw, box.sh);
          }
          ctx.restore();
        });
      }
      if (fragment.pairs.length < 3) {
        ctx.save();
        const center = cachedCentroid(fragment.polygon);
        ctx.translate(center.x + fragment.dx, center.y + fragment.dy);
        ctx.rotate(fragment.rotation * Math.PI / 180);
        ctx.translate(-center.x, -center.y);
        ctx.beginPath();
        ctx.moveTo(fragment.polygon[0].x, fragment.polygon[0].y);
        fragment.polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath(); ctx.clip();
        const box = sourceBBox(fragment.polygon, 2, w, h);
        if (box.sw > 0 && box.sh > 0) ctx.drawImage(image, box.sx, box.sy, box.sw, box.sh, box.sx, box.sy, box.sw, box.sh);
        ctx.restore();
      }
    });
    if (!includeGuides) return;
    holes.forEach((fragment) => {
      ctx.save();
      const polygon = fragment.polygon.map((point) => transformedPoint(point, fragment));
      ctx.beginPath(); ctx.moveTo(polygon[0].x, polygon[0].y); polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y)); ctx.closePath();
      ctx.strokeStyle = fragment.id === selectedId ? '#b56549' : '#31594d';
      ctx.lineWidth = 2 / zoom; ctx.setLineDash([7 / zoom, 5 / zoom]); ctx.stroke(); ctx.setLineDash([]);
      if (fragment.id === selectedId) polygon.forEach((point) => {
        ctx.beginPath(); ctx.arc(point.x, point.y, 4 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#f8f1df'; ctx.fill(); ctx.strokeStyle = '#a8553e'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
      });
      ctx.restore();
      fragment.pairs.forEach((pair, index) => {
        const source = transformedPoint(pair.source, fragment);
        const target = transformedPoint(pair.target, fragment);
        [source, target].forEach((point, pointIndex) => {
          ctx.beginPath(); ctx.arc(point.x, point.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = pointIndex ? '#b56549' : '#31594d'; ctx.fill(); ctx.strokeStyle = '#fff8e9'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
        });
        ctx.fillStyle = '#fcf8ed'; ctx.font = `${10 / zoom}px "DM Mono", monospace`; ctx.fillText(String(index + 1), source.x + 7 / zoom, source.y - 7 / zoom);
      });
    });
    if (draftPolygon.length) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(draftPolygon[0].x, draftPolygon[0].y);
      draftPolygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      if (draftPolygon.length > 2) ctx.lineTo(draftPolygon[0].x, draftPolygon[0].y);
      ctx.strokeStyle = '#b56549'; ctx.lineWidth = 2 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.stroke(); ctx.setLineDash([]);
      draftPolygon.forEach((point, index) => {
        ctx.beginPath(); ctx.arc(point.x, point.y, (index === 0 ? 5 : 3.5) / zoom, 0, Math.PI * 2);
        ctx.fillStyle = index === 0 ? '#b56549' : '#f8f1df'; ctx.fill(); ctx.strokeStyle = '#b56549'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
      });
      ctx.restore();
    }
    if (pendingSource && selectedFragment) {
      const marker = transformedPoint(pendingSource, selectedFragment);
      ctx.beginPath(); ctx.arc(marker.x, marker.y, 6 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#31594d'; ctx.fill(); ctx.strokeStyle = '#fff8e9'; ctx.lineWidth = 2 / zoom; ctx.stroke();
    }
  }, [documentImage, fragments, selectedId, zoom, draftPolygon, pendingSource]);

  const canvasBufferRef = useRef('');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvasSize.width || canvas.clientWidth;
    const height = canvasSize.height || canvas.clientHeight;
    if (!width || !height) return;
    const bufferKey = `${Math.round(width)}x${Math.round(height)}@${dpr}`;
    if (canvasBufferRef.current !== bufferKey) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvasBufferRef.current = bufferKey;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!documentImage) return;
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    drawScene(ctx, documentImage.width, documentImage.height, true);
    ctx.restore();
  }, [documentImage, fragments, canvasSize, pan, zoom, drawScene]);

  const finishLasso = useCallback(() => {
    if (draftPolygon.length < 3) {
      setNotice('Нужно поставить не менее трёх вершин контура.');
      return;
    }
    const fragment: Fragment = { id: idCounter.current++, polygon: draftPolygon.map((p) => ({ ...p })), dx: 0, dy: 0, rotation: 0, pairs: [], visible: false };
    commit([...fragments, fragment], fragment.id);
    setSelectedId(fragment.id);
    setDraftPolygon([]);
    setTool('select');
    setNotice(`Фрагмент ${fragments.length + 1} добавлен. Перетащите его за область или контур.`);
  }, [draftPolygon, fragments, commit]);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const index = historyIndex - 1;
    const snapshot = history[index];
    setHistoryIndex(index);
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(snapshot.fragments.some((fragment) => fragment.id === snapshot.selectedId) ? snapshot.selectedId : null);
    setNotice('Изменение отменено.');
  }, [canUndo, history, historyIndex]);
  const redo = useCallback(() => {
    if (!canRedo) return;
    const index = historyIndex + 1;
    const snapshot = history[index];
    setHistoryIndex(index);
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(snapshot.fragments.some((fragment) => fragment.id === snapshot.selectedId) ? snapshot.selectedId : null);
    setNotice('Изменение восстановлено.');
  }, [canRedo, history, historyIndex]);

  const screenToImage = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom };
  };
  const onCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!documentImage) return;
    if (event.button === 2) return;
    event.preventDefault();
    const pointer = { x: event.clientX, y: event.clientY };
    if (tool === 'pan' || event.button === 1 || event.shiftKey) {
      dragRef.current = { kind: 'pan', pointer, pan: { ...pan }, fragments: cloneFragments(fragments) };
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    const imagePoint = screenToImage(event);
    if (tool === 'lasso') {
      if (draftPolygon.length >= 3 && distance(imagePoint, draftPolygon[0]) < 13 / zoom) finishLasso();
      else setDraftPolygon((points) => [...points, imagePoint]);
      return;
    }
    if (tool === 'points') {
      if (!selectedFragment) { setNotice('Сначала выделите или создайте фрагмент.'); return; }
      if (!pendingSource) {
        const sourcePoint = inverseFragmentPoint(imagePoint, selectedFragment);
        if (!pointInside(sourcePoint, selectedFragment.polygon)) {
          setNotice('Исходную точку нужно поставить внутри выбранного фрагмента.');
          return;
        }
        setPendingSource(sourcePoint);
        setNotice('Источник отмечен. Щёлкните по месту, куда этот фрагмент карты должен лечь.');
      } else {
        const next = fragments.map((fragment) => fragment.id === selectedFragment.id
          ? { ...fragment, pairs: [...fragment.pairs, { source: pendingSource, target: inverseFragmentPoint(imagePoint, fragment) }] } : fragment);
        commit(next); setPendingSource(null);
        setNotice(`Опорных пар: ${(selectedFragment.pairs.length + 1)}. Для локальной деформации нужно минимум три.`);
      }
      return;
    }
    const hitTest = (fragment: Fragment) =>
      pointOnOrNearPolygon(inverseFragmentPoint(imagePoint, fragment), fragment.polygon, 12 / zoom);
    const reverseFragments = [...fragments].reverse();
    const hit = reverseFragments.find((fragment) => (fragment.visible || fragment.id === selectedId) && hitTest(fragment))
      ?? reverseFragments.find(hitTest);
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = { kind: 'fragment', pointer, pan: { ...pan }, fragments: cloneFragments(fragments), id: hit.id };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else setSelectedId(null);
  };
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const applyDragMove = (point: { x: number; y: number }) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      setPan({ x: drag.pan.x + point.x - drag.pointer.x, y: drag.pan.y + point.y - drag.pointer.y });
      return;
    }
    const dx = (point.x - drag.pointer.x) / zoom;
    const dy = (point.y - drag.pointer.y) / zoom;
    setFragments(drag.fragments.map((fragment) => fragment.id === drag.id ? { ...fragment, dx: fragment.dx + dx, dy: fragment.dy + dy } : fragment));
  };
  const onCanvasPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    pendingDragRef.current = { x: event.clientX, y: event.clientY };
    if (dragFrameRef.current == null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const point = pendingDragRef.current;
        pendingDragRef.current = null;
        if (point) applyDragMove(point);
      });
    }
  };
  const onCanvasPointerUp = () => {
    if (dragFrameRef.current != null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const pending = pendingDragRef.current;
    pendingDragRef.current = null;
    if (pending) applyDragMove(pending);
    const drag = dragRef.current;
    if (drag?.kind === 'fragment') {
      const start = drag.fragments.find((fragment) => fragment.id === drag.id);
      const current = fragments.find((fragment) => fragment.id === drag.id);
      const moved = !start || !current || Math.hypot(current.dx - start.dx, current.dy - start.dy) > 0.5;
      if (moved) commit(fragments);
    }
    dragRef.current = null;
  };
  const rotateSelected = (degrees: number) => {
    if (!selectedFragment) return;
    commit(fragments.map((fragment) => fragment.id === selectedId ? { ...fragment, rotation: fragment.rotation + degrees } : fragment));
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    commit(fragments.filter((fragment) => fragment.id !== selectedId), null);
    setSelectedId(null);
    setNotice('Фрагмент удалён. Это действие можно отменить.');
  };

  useEffect(() => {
    const isTextEntry = (value: EventTarget | null) => {
      const element = value as HTMLElement | null;
      if (!element) return false;
      return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault(); if (event.shiftKey) redo(); else undo(); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
      if (event.key === 'Escape') {
        setDraftPolygon([]); setPendingSource(null); setNotice('Текущий контур или точка отменены.');
      }
      if (event.key === 'Enter' && tool === 'lasso') finishLasso();
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyV') setTool('select');
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyL') { setTool('lasso'); setDraftPolygon([]); }
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyP') { setTool('points'); setPendingSource(null); }
      if (!event.ctrlKey && !event.metaKey) {
        const zoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd' || event.code === 'Equal';
        const zoomOut = event.key === '-' || event.code === 'NumpadSubtract' || event.code === 'Minus';
        if (zoomIn) setZoom((value) => Math.min(4, value * 1.15));
        else if (zoomOut) setZoom((value) => Math.max(.08, value / 1.15));
      }
      if (event.code === 'Delete' || event.code === 'Backspace') {
        if (selectedId) { event.preventDefault(); deleteSelected(); }
        return;
      }
      if (event.code === 'Space') { event.preventDefault(); setTool('pan'); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setTool((current) => current === 'pan' ? 'select' : current); };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [undo, redo, tool, finishLasso, selectedId, deleteSelected]);
  const toggleFragmentVisibility = (id: number) => {
    const fragment = fragments.find((item) => item.id === id);
    if (!fragment) return;
    const visible = !fragment.visible;
    commit(fragments.map((item) => item.id === id ? { ...item, visible } : item), visible ? id : (selectedId === id ? null : selectedId));
    if (visible) {
      setSelectedId(id);
      setNotice('Участок показан на холсте и останется видимым.');
    } else {
      if (selectedId === id) setSelectedId(null);
      setNotice('Участок скрыт на холсте; исправление останется в PNG.');
    }
  };
  const removePair = (index: number) => {
    if (!selectedFragment) return;
    commit(fragments.map((fragment) => fragment.id === selectedId ? { ...fragment, pairs: fragment.pairs.filter((_, i) => i !== index) } : fragment));
  };
  const processFile = async (file: File) => {
    const token = ++loadTokenRef.current;
    userFileLoadedRef.current = true;
    setLoading(true); setError(''); setNotice('');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        await loadPdf(await file.arrayBuffer(), file.name);
        if (token === loadTokenRef.current) setLoading(false);
      }
      else {
        const url = URL.createObjectURL(file);
        const image = new Image();
        const finish = () => { URL.revokeObjectURL(url); if (token === loadTokenRef.current) setLoading(false); };
        image.onload = () => {
          if (token !== loadTokenRef.current) { URL.revokeObjectURL(url); return; }
          try { loadImage(image, file.name); }
          catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось открыть изображение. Проверьте формат файла.'); }
          finish();
        };
        image.onerror = () => {
          if (token !== loadTokenRef.current) { URL.revokeObjectURL(url); return; }
          setError('Не удалось открыть изображение. Проверьте формат файла.');
          finish();
        };
        image.src = url;
      }
    } catch (caught) {
      if (token !== loadTokenRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файл.');
      setLoading(false);
    }
  };
  const onImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (fragments.length > 0) { setPendingFile(file); return; }
    void processFile(file);
  };
  const exportPng = () => {
    if (!documentImage) return;
    let output: HTMLCanvasElement;
    try {
      output = window.document.createElement('canvas');
      output.width = documentImage.width; output.height = documentImage.height;
      const context = output.getContext('2d');
      if (!context) throw new Error('Не удалось создать экспортное изображение.');
      context.imageSmoothingQuality = 'high';
      drawScene(context, output.width, output.height, false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'SecurityError') setError('Экспорт запрещён политикой безопасности: холст скомпрометирован сторонними данными.');
      else setError(caught instanceof Error ? caught.message : 'Экспорт не удался: браузер не смог подготовить изображение.');
      return;
    }
    try {
      output.toBlob((blob) => {
        if (!blob) { setError('Не удалось сформировать PNG.'); return; }
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url; link.download = `${documentImage.name.replace(/\.[^.]+$/, '')}-исправлено.png`;
        link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        const sizeMb = blob.size / (1024 * 1024);
        setNotice(sizeMb > 50
          ? `PNG сохранён (${Math.round(sizeMb)} МБ). Файл большой — скачивание и открытие могут занять время.`
          : 'PNG сохранён в исходном разрешении документа.');
      }, 'image/png');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'SecurityError') setError('Экспорт запрещён политикой безопасности: холст скомпрометирован сторонними данными.');
      else setError('Экспорт не удался: браузер не смог сформировать PNG.');
    }
  };
  const percentZoom = `${Math.round(zoom * 100)}%`;
  const pointCount = useMemo(() => fragments.reduce((sum, fragment) => sum + fragment.pairs.length, 0), [fragments]);
  const cursorClass = tool === 'pan' ? 'pan' : tool === 'points' ? 'points' : tool === 'select' ? 'move' : '';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><ScanLine size={19} strokeWidth={1.6} /></div>
          <div><div className="brand-title">Редактор сканов карт</div><div className="brand-subtitle">стол реставратора · локальная работа</div></div>
        </div>
        <div className="top-divider" />
        <div className="document-name" data-testid="document-name">
          <strong>{documentImage?.name ?? 'Документ не открыт'}</strong>
          <span>{documentImage ? `${documentImage.width.toLocaleString('ru-RU')} × ${documentImage.height.toLocaleString('ru-RU')} px · в браузере` : 'Импортируйте скан для начала работы'}</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={onImportFile} data-testid="input-import-document" />
        <div className="header-actions">
          <button className="btn" onClick={() => fileRef.current?.click()} data-testid="button-import-document"><FilePlus2 size={15} /><span>Открыть файл</span></button>
          <button className="btn btn-primary" onClick={exportPng} disabled={!documentImage} data-testid="button-export-png"><ArrowDownToLine size={15} /><span>Экспорт PNG</span></button>
        </div>
      </header>

      <section className="workspace">
        <aside className="rail rail-left">
          <div className="rail-head">
            <div className="eyebrow">Рабочий стол / 01</div>
            <h1 className="section-title">Восстановление</h1>
          </div>
          <div className="panel-block">
            <div className="panel-caption">Инструменты</div>
            <div className="tool-list">
              <button className={`tool-button ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} data-testid="tool-select"><span className="tool-icon"><MousePointer2 size={14} /></span>Выбрать и сдвинуть<span className="shortcut">V</span></button>
              <button className={`tool-button ${tool === 'lasso' ? 'active' : ''}`} onClick={() => { setTool('lasso'); setDraftPolygon([]); }} data-testid="tool-lasso"><span className="tool-icon"><ScanLine size={14} /></span>Контур фрагмента<span className="shortcut">L</span></button>
              <button className={`tool-button ${tool === 'points' ? 'active' : ''}`} onClick={() => { setTool('points'); setPendingSource(null); }} data-testid="tool-control-points"><span className="tool-icon"><ArrowLeftRight size={14} /></span>Опорные точки<span className="shortcut">P</span></button>
              <button className={`tool-button ${tool === 'pan' ? 'active' : ''}`} onClick={() => setTool('pan')} data-testid="tool-pan"><span className="tool-icon"><Hand size={14} /></span>Перемещение вида<span className="shortcut">Пробел</span></button>
            </div>
            {tool === 'lasso' && <p className="hint">Щёлкайте по вершинам. Замкните контур кликом по первой точке или нажмите Enter. Escape отменяет контур.</p>}
            {tool === 'points' && <p className="hint">Для каждой пары: щёлкните исходное место, затем его правильное положение. Три пары и более задают локальную деформацию.</p>}
          </div>
          <div className="panel-block">
            <div className="panel-caption">Слои документа</div>
            <div className="status-card">
              <div className="status-row"><span>Исходный лист</span><strong>{documentImage ? 'ОТКРЫТ' : 'НЕТ'}</strong></div>
              <div className="status-row"><span>Фрагменты</span><strong>{fragments.length.toString().padStart(2, '0')}</strong></div>
              <div className="status-row"><span>Опорные пары</span><strong>{pointCount.toString().padStart(2, '0')}</strong></div>
              <div className="status-row"><span>Разрешение</span><strong>{documentImage ? `${Math.round(documentImage.width * documentImage.height / 1_000_000 * 10) / 10} Мп` : '—'}</strong></div>
            </div>
            <div style={{ marginTop: 9, display: 'flex', gap: 6 }}>
              <button className="mini-action" onClick={undo} disabled={!canUndo} data-testid="button-undo"><Undo2 size={13} />Отменить</button>
              <button className="mini-action" onClick={redo} disabled={!canRedo} data-testid="button-redo"><Redo2 size={13} />Повторить</button>
            </div>
          </div>
          <div className="panel-block" style={{ flex: 1 }}>
            <div className="panel-caption">Обработанные участки</div>
            {fragments.length === 0 ? <p className="hint">Пока нет выделенных областей. Обведите повреждённый участок инструментом «Контур фрагмента».</p> : fragments.map((fragment, index) => (
              <div key={fragment.id} className={`fragment-item ${selectedId === fragment.id ? 'selected' : ''}`} data-testid={`fragment-item-${fragment.id}`}>
                <button className="fragment-select" onClick={() => setSelectedId(fragment.id)} data-testid={`fragment-select-${fragment.id}`}>
                  <span className="fragment-num">{String(index + 1).padStart(2, '0')}</span>
                  <span className="fragment-details">Участок карты<small>{fragment.polygon.length} вершин · {fragment.pairs.length} пар</small></span>
                </button>
                <button
                  className={`fragment-visibility ${fragment.visible ? 'visible' : ''}`}
                  onClick={() => toggleFragmentVisibility(fragment.id)}
                  title={fragment.visible ? 'Скрыть участок с холста' : 'Закрепить показ на холсте'}
                  aria-label={fragment.visible ? 'Скрыть участок с холста' : 'Закрепить показ на холсте'}
                  aria-pressed={fragment.visible}
                  data-testid={`fragment-visibility-${fragment.id}`}
                >
                  {fragment.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </div>
            ))}
            {fragments.length > 0 && <p className="hint">Нажмите на участок, чтобы временно показать его. Значок глаза закрепляет показ; скрытые исправления всё равно попадут в PNG.</p>}
          </div>
          <div className="panel-block">
            <div className="eyebrow">Все операции выполняются локально</div>
            <p className="hint">Скан не покидает это устройство. История хранится в памяти вкладки — до сотни последних шагов.</p>
          </div>
        </aside>

        <section className="canvas-column">
          <div className="toolbar">
            <div className="toolbar-group">
              <button className={`btn-icon ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Выбрать фрагмент" aria-label="Выбрать фрагмент" data-testid="toolbar-select"><MousePointer2 size={15} /></button>
              <button className={`btn-icon ${tool === 'lasso' ? 'active' : ''}`} onClick={() => { setTool('lasso'); setDraftPolygon([]); }} title="Контур фрагмента" aria-label="Контур фрагмента" data-testid="toolbar-lasso"><ScanLine size={15} /></button>
              <button className={`btn-icon ${tool === 'points' ? 'active' : ''}`} onClick={() => { setTool('points'); setPendingSource(null); }} title="Опорные точки" aria-label="Опорные точки" data-testid="toolbar-points"><ArrowLeftRight size={15} /></button>
              <span className="tool-separator" />
              <button className="btn-icon" onClick={undo} disabled={!canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить" data-testid="canvas-undo"><Undo2 size={16} /></button>
              <button className="btn-icon" onClick={redo} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить" data-testid="canvas-redo"><Redo2 size={16} /></button>
              <span className="tool-separator" />
              <button className="btn-icon" onClick={() => setZoom((value) => Math.max(.08, value / 1.2))} title="Уменьшить" aria-label="Уменьшить" data-testid="zoom-out"><ZoomOut size={16} /></button>
              <span className="zoom-readout">{percentZoom}</span>
              <button className="btn-icon" onClick={() => setZoom((value) => Math.min(4, value * 1.2))} title="Увеличить" aria-label="Увеличить" data-testid="zoom-in"><ZoomIn size={16} /></button>
              <button className="btn-icon" onClick={() => fitImage()} title="Вписать лист" aria-label="Вписать лист" data-testid="zoom-fit"><ScanLine size={16} /></button>
            </div>
            <div className="toolbar-group">
              {selectedFragment && <>
                <button className="btn-icon" onClick={() => rotateSelected(-1)} title="Повернуть на −1°" aria-label="Повернуть на −1°" data-testid="toolbar-rotate-left"><RotateCcw size={15} /></button>
                <button className="btn-icon" onClick={() => rotateSelected(1)} title="Повернуть на +1°" aria-label="Повернуть на +1°" data-testid="toolbar-rotate-right"><RotateCw size={15} /></button>
                <button className="btn-icon" onClick={deleteSelected} title="Удалить фрагмент" aria-label="Удалить фрагмент" data-testid="toolbar-delete-fragment"><X size={15} /></button>
                <span className="tool-separator" />
              </>}
              <button className="btn-icon" onClick={() => setTool('pan')} title="Переместить вид" aria-label="Переместить вид"><Hand size={15} /></button>
              <span className="tool-separator" />
              <span className="eyebrow" style={{ letterSpacing: '.08em' }}>{selectedFragment ? `ФРАГМЕНТ ${fragments.findIndex((f) => f.id === selectedId) + 1}` : 'ОБЗОР ЛИСТА'}</span>
            </div>
          </div>
          <div className={`canvas-wrap ${cursorClass}`} ref={wrapRef}>
            {documentImage && <canvas ref={canvasRef} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp} onContextMenu={(event) => event.preventDefault()} data-testid="map-canvas" />}
            {!documentImage && !loading && <div className="canvas-empty"><div className="empty-card"><div className="empty-icon"><FileImage size={23} /></div><h2>Начните с листа карты</h2><p>Откройте изображение или PDF. Пример скана загружается автоматически — если он недоступен, выберите файл вручную.</p><button className="btn btn-primary" onClick={() => fileRef.current?.click()}><FilePlus2 size={15} />Выбрать документ</button></div></div>}
            {loading && <div className="loading-surface"><div className="loading-box">Подготавливаем скан на этом устройстве<div className="skeleton-line" /><div className="skeleton-line" style={{ width: '72%' }} /></div></div>}
            {error && <div className="error-banner" role="alert">{error} <button className="btn-icon" onClick={() => setError('')} aria-label="Закрыть сообщение"><X size={13} /></button></div>}
            {notice && <div className="canvas-overlay" role="status">{notice}</div>}
          </div>
          <footer className="canvas-statusbar">
            <span>{tool === 'lasso' ? 'КОНТУР · КЛИК — ВЕРШИНА · ENTER — ЗАМКНУТЬ · ESC — ОТМЕНА' : tool === 'points' ? pendingSource ? 'ТОЧКИ · ИСТОЧНИК ОТМЕЧЕН · ВЫБЕРИТЕ ЦЕЛЬ' : 'ТОЧКИ · ВЫБЕРИТЕ ИСХОДНУЮ ТОЧКУ' : 'КООРДИНАТЫ В ПИКСЕЛЯХ ИСХОДНОГО СКАНА'}</span>
            <span>{documentImage ? `${documentImage.width} × ${documentImage.height} PX` : 'НЕТ ДОКУМЕНТА'}</span>
          </footer>
        </section>

        <aside className="rail rail-right">
          <div className="rail-head">
            <div className="eyebrow">Точная подгонка</div>
            <h2 className="section-title">Свойства участка</h2>
          </div>
          <div className="panel-block right-content">
            <div className="panel-caption">Геометрия</div>
            {selectedFragment ? <>
              <div className="status-card">
                <div className="status-row"><span>Вершины контура</span><strong>{selectedFragment.polygon.length}</strong></div>
                <div className="status-row"><span>Сдвиг X</span><strong>{Math.round(selectedFragment.dx)} px</strong></div>
                <div className="status-row"><span>Сдвиг Y</span><strong>{Math.round(selectedFragment.dy)} px</strong></div>
                <div className="status-row"><span>Поворот</span><strong>{selectedFragment.rotation.toFixed(1)}°</strong></div>
              </div>
              <div className="fragment-actions">
                <button className="mini-action" onClick={() => rotateSelected(-1)} data-testid="button-rotate-left"><RotateCcw size={13} />−1°</button>
                <button className="mini-action" onClick={() => rotateSelected(1)} data-testid="button-rotate-right"><RotateCw size={13} />+1°</button>
                <button className="mini-action" onClick={deleteSelected} title="Удалить фрагмент" data-testid="button-delete-fragment"><X size={13} />Убрать</button>
              </div>
              <div className="instruction">В режиме «Выбрать и сдвинуть» тяните фрагмент за область или пунктирный край. Shift или пробел — двигать весь лист.</div>
            </> : <p className="hint">Выберите участок на листе или начертите контур, чтобы увидеть его параметры.</p>}
          </div>
          <div className="panel-block right-content">
            <div className="panel-caption">Сшивка по опорным точкам</div>
            {!selectedFragment ? <p className="hint">Выделите фрагмент перед созданием пар точек.</p> : <>
              <p className="hint">Пара задаёт соответствие исходной точки её целевому положению. Деформация строится по треугольной сетке.</p>
              <div className="control-row">
                <button className={`btn ${tool === 'points' ? 'btn-primary' : ''}`} onClick={() => { setTool(tool === 'points' ? 'select' : 'points'); setPendingSource(null); }} data-testid="button-add-control-pair"><ArrowLeftRight size={14} />{tool === 'points' ? 'Завершить пары' : 'Поставить пару'}</button>
              </div>
              {selectedFragment.pairs.length > 0 && selectedFragment.pairs.map((pair, index) => (
                <div className="control-pair" key={`${selectedFragment.id}-${index}`}>
                  <div className="pair-head"><span className="pair-index">{index + 1}</span><span className="eyebrow">Сопоставление</span><button className="btn-icon" onClick={() => removePair(index)} title="Удалить пару" aria-label={`Удалить пару ${index + 1}`}><X size={13} /></button></div>
                  <div className="point-cell">ИСТОЧНИК<strong>{Math.round(pair.source.x)}, {Math.round(pair.source.y)}</strong></div>
                  <div className="point-cell">ЦЕЛЬ<strong>{Math.round(pair.target.x)}, {Math.round(pair.target.y)}</strong></div>
                </div>
              ))}
              {selectedFragment.pairs.length > 0 && <button className="mini-action" style={{ width: '100%', marginTop: 8 }} onClick={() => commit(fragments.map((fragment) => fragment.id === selectedId ? { ...fragment, pairs: [] } : fragment))} data-testid="button-clear-pairs"><X size={13} />Очистить пары</button>}
              <div className="status-row" style={{ marginTop: 11 }}><span>Сетка деформации</span><strong>{canWarp ? 'АКТИВНА' : `${selectedFragment.pairs.length}/3`}</strong></div>
            </>}
          </div>
          <div className="panel-block right-content">
            <div className="panel-caption">Клавиши и приёмы</div>
            <div className="status-row"><span>Замкнуть контур</span><strong>ENTER</strong></div>
            <div className="status-row"><span>Отменить действие</span><strong>CTRL Z</strong></div>
            <div className="status-row"><span>Масштаб</span><strong>+ / −</strong></div>
            <div className="status-row"><span>Панорамирование</span><strong>ПРОБЕЛ</strong></div>
            <p className="hint" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><CircleHelp size={13} style={{ flex: '0 0 auto', marginTop: 2 }} />Лассо — это полигональный контур: кликайте по углам повреждённого листа, не ведите курсор как кистью.</p>
          </div>
          <div className="panel-block right-content" style={{ marginTop: 'auto' }}>
            <div className="eyebrow">Версия 01 · сохранение локально</div>
            <p className="hint">Экспорт включает исправленную композицию в полном разрешении исходника.</p>
          </div>
        </aside>
      </section>

      <AlertDialog open={pendingFile != null} onOpenChange={(open) => { if (!open) setPendingFile(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить документ?</AlertDialogTitle>
            <AlertDialogDescription>
              На листе есть обработанные участки. Открытие нового файла удалит их вместе с историей правок.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить текущий</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const file = pendingFile; setPendingFile(null); if (file) void processFile(file); }}>Заменить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export default App;
