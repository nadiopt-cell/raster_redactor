import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ScanLine } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CanvasStage } from '@/components/canvas-stage';
import { LeftRail } from '@/components/left-rail';
import { RightRail } from '@/components/right-rail';
import { Toolbar, Topbar } from '@/components/toolbar';
import { useHistory } from '@/hooks/use-history';
import { useDocumentLoader } from '@/hooks/use-document-loader';
import { useViewport } from '@/hooks/use-viewport';
import {
  applyAffineTriangle, cachedCentroid, cloneFragments, distance,
  expandPolygon, inverseFragmentPoint, pointInside, pointOnOrNearPolygon,
  sourceBBox, transformedPoint, triangulate,
  type MeshPoint,
} from '@/lib/geometry';
import type { DocumentImage, Fragment, Point, Tool } from '@/lib/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Лимиты холста браузера: сторона не более 32767 px, консервативная площадь 100 Мп (Safari/iOS).
const MAX_CANVAS_EDGE = 32_767;
const MAX_CANVAS_PIXELS = 100_000_000;
// Цвет заливки участка, освобождённого от исправленного фрагмента.
const VACATED_FILL = '#d7cbb0';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ kind: 'pan' | 'fragment'; pointer: Point; pan: Point; fragments: Fragment[]; id?: number } | null>(null);
  const spacePanRef = useRef(false);
  const prevToolRef = useRef<Tool>('select');
  const idCounter = useRef(1);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const canvasBufferRef = useRef('');
  const [documentImage, setDocumentImage] = useState<DocumentImage | null>(null);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<Point[]>([]);
  const [pendingSource, setPendingSource] = useState<Point | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedFragment = fragments.find((fragment) => fragment.id === selectedId) ?? null;
  const canWarp = !!selectedFragment && selectedFragment.pairs.length >= 3;

  const { canUndo, canRedo, commit, undo, redo, resetHistory } = useHistory(setFragments, selectedId, setSelectedId, setNotice);
  const { zoom, setZoom, pan, setPan, canvasSize, fitImage, zoomAt, canvasCenter, zoomAtRef, needsFitRef } = useViewport(wrapRef, documentImage);

  const loadImage = useCallback((image: HTMLImageElement, name: string) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE || width * height > MAX_CANVAS_PIXELS) {
      throw new Error(`Изображение слишком большое для браузера: ${Math.round(width * height / 1_000_000)} Мп, максимум ${Math.round(MAX_CANVAS_PIXELS / 1_000_000)} Мп. Уменьшите скан или сохраните его в PDF.`);
    }
    setDocumentImage({ image, name, width, height });
    setPan({ x: 0, y: 0 });
    setZoom(1);
    needsFitRef.current = true;
    setFragments([]);
    resetHistory();
    setSelectedId(null);
    setDraftPolygon([]);
    setPendingSource(null);
    setError('');
    setNotice('');
  }, [needsFitRef, resetHistory, setPan, setZoom]);

  const { processFile } = useDocumentLoader(loadImage, notice, setNotice, setLoading, setError);

  useEffect(() => {
    if (fragments.length === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [fragments.length]);

  const drawScene = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, includeGuides: boolean) => {
    if (!documentImage) return;
    const { image } = documentImage;
    const displayedFragments = includeGuides
      ? fragments.filter((fragment) => fragment.visible || fragment.id === selectedId)
      : fragments;
    const holes = displayedFragments.filter((fragment) => fragment.polygon.length >= 3);
    ctx.drawImage(image, 0, 0);
    holes.forEach((fragment) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(fragment.polygon[0].x, fragment.polygon[0].y);
      fragment.polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.fillStyle = VACATED_FILL;
      ctx.fill();
      ctx.restore();
    });
    holes.forEach((fragment) => {
      if (fragment.pairs.length >= 3) {
        const mesh: MeshPoint[] = fragment.polygon.map((source) => ({ source, target: transformedPoint(source, fragment) }));
        fragment.pairs.forEach((pair) => mesh.push({
          source: pair.source,
          target: pair.target,
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
        const target = pair.target;
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
          ? { ...fragment, pairs: [...fragment.pairs, { source: pendingSource, target: imagePoint }] } : fragment);
        commit(next); setPendingSource(null);
        setNotice(`Опорных пар: ${(selectedFragment.pairs.length + 1)}. Для локальной деформации нужно минимум три.`);
      }
      return;
    }
    const hitTest = (fragment: Fragment) =>
      pointOnOrNearPolygon(inverseFragmentPoint(imagePoint, fragment), fragment.polygon, 12 / zoom);
    const reverseFragments = [...fragments].reverse();
    // Скрытые (не выбранные) фрагменты исключены из хит-теста: раньше их можно было перетаскивать «вслепую».
    // Выбрать скрытый участок можно в списке слева — при выборе он отображается на холсте.
    const hit = reverseFragments.find((fragment) => (fragment.visible || fragment.id === selectedId) && hitTest(fragment));
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = { kind: 'fragment', pointer, pan: { ...pan }, fragments: cloneFragments(fragments), id: hit.id };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else setSelectedId(null);
  };
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
        if (zoomIn) zoomAtRef.current(canvasCenter(), 1.15);
        else if (zoomOut) zoomAtRef.current(canvasCenter(), 1 / 1.15);
      }
      if (event.code === 'Delete' || event.code === 'Backspace') {
        if (selectedId) { event.preventDefault(); deleteSelected(); }
        return;
      }
      if (event.code === 'Space') {
        if (event.repeat) return;
        const element = event.target as HTMLElement | null;
        // не мешаем стандартной активации кнопок и ссылок пробелом
        if (element && (element.tagName === 'BUTTON' || element.tagName === 'A' || element.isContentEditable)) return;
        event.preventDefault();
        if (tool !== 'pan') { prevToolRef.current = tool; spacePanRef.current = true; setTool('pan'); }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spacePanRef.current) return;
      spacePanRef.current = false;
      setTool((current) => (current === 'pan' ? prevToolRef.current : current));
    };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [undo, redo, tool, finishLasso, selectedId, deleteSelected, zoomAtRef, canvasCenter]);

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
  const handleToolSelect = (next: Tool) => {
    if (next === 'lasso') setDraftPolygon([]);
    if (next === 'points') setPendingSource(null);
    setTool(next);
  };
  const percentZoom = `${Math.round(zoom * 100)}%`;
  const pointCount = useMemo(() => fragments.reduce((sum, fragment) => sum + fragment.pairs.length, 0), [fragments]);
  const cursorClass = tool === 'pan' ? 'pan' : tool === 'points' ? 'points' : tool === 'select' ? 'move' : '';
  const selectedNumber = selectedFragment ? fragments.findIndex((fragment) => fragment.id === selectedId) + 1 : null;

  return (
    <main className="app-shell">
      <Topbar
        documentImage={documentImage}
        fileRef={fileRef}
        onImportFile={onImportFile}
        onImportClick={() => fileRef.current?.click()}
        onExportClick={exportPng}
      />

      <section className="workspace">
        <LeftRail
          tool={tool}
          onToolSelect={handleToolSelect}
          documentImage={documentImage}
          fragments={fragments}
          selectedId={selectedId}
          pointCount={pointCount}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onSelectFragment={setSelectedId}
          onToggleVisibility={toggleFragmentVisibility}
        />

        <CanvasStage
          toolbar={
            <Toolbar
              tool={tool}
              onToolSelect={handleToolSelect}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              onZoomIn={() => zoomAt(canvasCenter(), 1.2)}
              onZoomOut={() => zoomAt(canvasCenter(), 1 / 1.2)}
              onFit={() => fitImage()}
              percentZoom={percentZoom}
              selectedNumber={selectedNumber}
              onRotate={rotateSelected}
              onDelete={deleteSelected}
            />
          }
          wrapRef={wrapRef}
          canvasRef={canvasRef}
          documentImage={documentImage}
          loading={loading}
          error={error}
          notice={notice}
          tool={tool}
          pendingSource={pendingSource}
          cursorClass={cursorClass}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onCloseError={() => setError('')}
          onImportClick={() => fileRef.current?.click()}
        />

        <RightRail
          selectedFragment={selectedFragment}
          tool={tool}
          canWarp={canWarp}
          onTogglePairTool={() => { setTool(tool === 'points' ? 'select' : 'points'); setPendingSource(null); }}
          onRotate={rotateSelected}
          onDelete={deleteSelected}
          onRemovePair={removePair}
          onClearPairs={() => commit(fragments.map((fragment) => fragment.id === selectedId ? { ...fragment, pairs: [] } : fragment))}
        />
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
