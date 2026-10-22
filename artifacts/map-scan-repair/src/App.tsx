import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
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
  applyAffineTriangle, buildMesh, cachedCentroid, cloneFragments, distance, triangleCentroid,
  expandPolygon, inverseFragmentPoint, pointInside, pointOnOrNearPolygon,
  sourceBBox, transformedPoint, triangulate,
} from '@/lib/geometry';
import { exportableFragments, nearestPointIndex, removePointAt } from '@/lib/fragments';
import { pairQuality, residualGrade, type PairQuality } from '@/lib/quality';
import { clearSession, loadSession, parseProject, saveSession, serializeProject, type ProjectFile } from '@/lib/project';
import type { DocumentImage, Fragment, Point, Tool } from '@/lib/types';

// Лимиты холста браузера: сторона не более 32767 px, консервативная площадь 100 Мп (Safari/iOS).
const MAX_CANVAS_EDGE = 32_767;
const MAX_CANVAS_PIXELS = 100_000_000;
// Цвет заливки участка, освобождённого от исправленного фрагмента.
const VACATED_FILL = '#d7cbb0';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ kind: 'pan' | 'fragment'; pointer: Point; pan: Point; fragments: Fragment[]; id?: number } | null>(null);
  // Актуальное состояние fragments на время drag: указатель события может отставать
  // от React-рендеров, а commit при pointerup обязан видеть финальную позицию.
  const dragLatestRef = useRef<Fragment[] | null>(null);
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
  const [pendingRestore, setPendingRestore] = useState<ProjectFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedFragment = fragments.find((fragment) => fragment.id === selectedId) ?? null;
  // Остатки пар инвариантны к drag/rotate целиком, поэтому memo по ссылкам polygon/pairs
  // пересчитывается только при содержательных изменениях (коммит, правка пар/вершин).
  const quality = useMemo(
    () => (selectedFragment ? pairQuality(selectedFragment) : null),
    [selectedFragment?.id, selectedFragment?.polygon, selectedFragment?.pairs],
  );

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
    // Сеанс с прошлого раза: если для этого скана что-то сохранялось, предлагаем продолжить.
    const session = loadSession(name, width, height);
    setPendingRestore(session && session.fragments.length > 0 ? session : null);
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

  // Автосохранение сеанса: фрагменты компактны, изображение не вкладывается —
  // скан при восстановлении пользователь открывает заново, сверка по имени и размеру.
  useEffect(() => {
    if (!documentImage) return;
    const timer = window.setTimeout(() => {
      saveSession(documentImage.name, documentImage.width, documentImage.height, fragments, idCounter.current);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [documentImage, fragments]);

  const drawScene = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, includeGuides: boolean, quality: PairQuality | null) => {
    if (!documentImage) return;
    const { image } = documentImage;
    // На холсте скрытый участок временно виден, пока выбран. В экспорт попадают только видимые (закреплённые глазком).
    const displayedFragments = includeGuides
      ? fragments.filter((fragment) => fragment.visible || fragment.id === selectedId)
      : exportableFragments(fragments);
    const holes = displayedFragments.filter((fragment) => fragment.polygon.length >= 3);
    ctx.drawImage(image, 0, 0);
    holes.forEach((fragment) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(fragment.polygon[0].x, fragment.polygon[0].y);
      fragment.polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.fillStyle = VACATED_FILL;
      // even-odd — то же правило, по которому работает pointInside (хит-тест):
      // иначе на самопересекающемся контуре заливка и захват расходятся.
      ctx.fill('evenodd');
      ctx.restore();
    });
    holes.forEach((fragment) => {
      const mesh = buildMesh(fragment);
      if (fragment.pairs.length < 3) {
        // Жёсткая модель пользователя: содержимое сдвигается и поворачивается целиком,
        // опорные пары включаются с трёх штук (та же проверенная семантика, что и раньше).
        ctx.save();
        const center = cachedCentroid(fragment.polygon);
        ctx.translate(center.x + fragment.dx, center.y + fragment.dy);
        ctx.rotate(fragment.rotation * Math.PI / 180);
        ctx.translate(-center.x, -center.y);
        ctx.beginPath();
        ctx.moveTo(fragment.polygon[0].x, fragment.polygon[0].y);
        fragment.polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath(); ctx.clip('evenodd');
        const box = sourceBBox(fragment.polygon, 2, w, h);
        if (box.sw > 0 && box.sh > 0) ctx.drawImage(image, box.sx, box.sy, box.sw, box.sh, box.sx, box.sy, box.sw, box.sh);
        ctx.restore();
      } else {
        // Локальная сетка (3+ пар). Пары проходят через тот же rigid-оператор, что и
        // вершины полигона: drag/rotate переносят сшитый результат целиком, не разрывая
        // деформацию между границей и якорями пар.
        const triangles = triangulate(mesh.map((point) => point.source));
        const boundary = expandPolygon(mesh.slice(0, fragment.polygon.length).map((point) => point.target), 0.5);
        triangles.forEach((triangle) => {
          const src = triangle.map((index) => mesh[index].source);
          const dst = triangle.map((index) => mesh[index].target);
          const center = triangleCentroid(src);
          if (!pointInside(center, fragment.polygon)) return;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(boundary[0].x, boundary[0].y);
          boundary.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
          ctx.closePath();
          ctx.clip('evenodd');
          const expandedDst = expandPolygon(dst, 0.5);
          ctx.beginPath(); ctx.moveTo(expandedDst[0].x, expandedDst[0].y); ctx.lineTo(expandedDst[1].x, expandedDst[1].y); ctx.lineTo(expandedDst[2].x, expandedDst[2].y); ctx.closePath(); ctx.clip();
          if (applyAffineTriangle(ctx, src, dst)) {
            const box = sourceBBox(src, 2, w, h);
            if (box.sw > 0 && box.sh > 0) ctx.drawImage(image, box.sx, box.sy, box.sw, box.sh, box.sx, box.sy, box.sw, box.sh);
          }
          ctx.restore();
        });
      }
    });
    if (!includeGuides) return;
    holes.forEach((fragment) => {
      ctx.save();
      // Граница рисуется по целям mesh: одна и та же модель правит и содержимое, и контур.
      const polygon = buildMesh(fragment).slice(0, fragment.polygon.length).map((point) => point.target);
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
        // Цель рисуется через тот же оператор, что и в mesh (buildMesh):
        // маркер стоит ровно там, куда реально попадает содержимое пары.
        const target = transformedPoint(pair.target, fragment);
        [source, target].forEach((point, pointIndex) => {
          ctx.beginPath(); ctx.arc(point.x, point.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = pointIndex ? '#b56549' : '#31594d'; ctx.fill(); ctx.strokeStyle = '#fff8e9'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
        });
        ctx.fillStyle = '#fcf8ed'; ctx.font = `${10 / zoom}px "DM Mono", monospace`; ctx.fillText(String(index + 1), source.x + 7 / zoom, source.y - 7 / zoom);
        if (fragment.id === selectedId && quality && quality.residuals[index] != null) {
          // Кольцо качества: чем хуже пара держится соседними, тем «горячее» цвет остатка.
          const residual = quality.residuals[index] as number;
          const grade = residualGrade(residual, Math.hypot(w, h));
          ctx.beginPath(); ctx.arc(target.x, target.y, 9.5 / zoom, 0, Math.PI * 2);
          ctx.setLineDash([3.5 / zoom, 2.5 / zoom]);
          ctx.strokeStyle = grade === 'ok' ? '#3f6f4f' : grade === 'watch' ? '#b3872f' : '#b04a3a';
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke(); ctx.setLineDash([]);
        }
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
  }, [documentImage, fragments, selectedId, zoom, draftPolygon, pendingSource, quality]);

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
    drawScene(ctx, documentImage.width, documentImage.height, true, quality);
    ctx.restore();
  }, [documentImage, fragments, canvasSize, pan, zoom, drawScene]);

  const finishLasso = useCallback(() => {
    if (draftPolygon.length < 3) {
      setNotice('Нужно поставить не менее трёх вершин контура.');
      return;
    }
    const fragment: Fragment = { id: idCounter.current++, polygon: draftPolygon.map((p) => ({ ...p })), dx: 0, dy: 0, rotation: 0, pairs: [], visible: true };
    commit([...fragments, fragment], fragment.id);
    setSelectedId(fragment.id);
    setDraftPolygon([]);
    setTool('select');
    setNotice(`Фрагмент ${fragments.length + 1} добавлен. Перетащите его за область или контур.`);
  }, [draftPolygon, fragments, commit]);

  const removeDraftPoint = useCallback((index: number) => {
    if (index < 0 || index >= draftPolygon.length) return;
    setDraftPolygon(removePointAt(draftPolygon, index));
    setNotice(`Вершина ${index + 1} удалена. Осталось: ${draftPolygon.length - 1}.`);
  }, [draftPolygon]);
  const removeLastDraftPoint = useCallback(() => removeDraftPoint(draftPolygon.length - 1), [removeDraftPoint, draftPolygon.length]);
  const cancelDraft = useCallback(() => {
    setDraftPolygon([]);
    setNotice('Контур отменён.');
  }, []);

  const screenToImage = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom };
  };
  const onCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!documentImage) return;
    if (event.button === 2) {
      // Правый клик по вершине незавершённого контура удаляет её.
      event.preventDefault();
      if (tool === 'lasso' && draftPolygon.length) {
        removeDraftPoint(nearestPointIndex(draftPolygon, screenToImage(event), 12 / zoom));
      }
      return;
    }
    event.preventDefault();
    const pointer = { x: event.clientX, y: event.clientY };
    if (tool === 'pan' || event.button === 1 || event.shiftKey) {
      dragRef.current = { kind: 'pan', pointer, pan: { ...pan }, fragments: cloneFragments(fragments) };
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    const imagePoint = screenToImage(event);
    if (tool === 'lasso') {
      // Контур вне листа даёт «пустой» фрагмент (bbox вырождается) — не даём ставить вершины мимо скана.
      if (imagePoint.x < 0 || imagePoint.y < 0 || imagePoint.x > documentImage.width || imagePoint.y > documentImage.height) {
        setNotice('Контур нужно обводить внутри листа скана.');
        return;
      }
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
        const count = selectedFragment.pairs.length + 1;
        setNotice(count >= 3
          ? `Опорных пар: ${count}. Локальная сетка деформации активна.`
          : `Опорных пар: ${count}. Локальная сетка заработает с трёх пар.`);
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
      dragLatestRef.current = null;
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
    const next = drag.fragments.map((fragment) => fragment.id === drag.id ? { ...fragment, dx: fragment.dx + dx, dy: fragment.dy + dy } : fragment);
    dragLatestRef.current = next;
    setFragments(next);
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
      // Читаем позицию из ref, а не из closure: последний applyDragMove мог
      // обновить состояние, которое сюда ещё не «доехало» рендером.
      const latest = dragLatestRef.current ?? drag.fragments;
      const start = drag.fragments.find((fragment) => fragment.id === drag.id);
      const current = latest.find((fragment) => fragment.id === drag.id);
      const moved = !!start && !!current && Math.hypot(current.dx - start.dx, current.dy - start.dy) > 0.5;
      if (moved) commit(latest);
      else if (dragLatestRef.current) setFragments(latest); // микросдвиг — в состоянии, но не в истории
    }
    dragLatestRef.current = null;
    dragRef.current = null;
  };
  const rotateSelected = (degrees: number) => {
    if (!selectedFragment) return;
    commit(fragments.map((fragment) => fragment.id === selectedId ? { ...fragment, rotation: fragment.rotation + degrees } : fragment));
  };
  const deleteFragment = (id: number) => {
    const index = fragments.findIndex((fragment) => fragment.id === id);
    if (index < 0) return;
    const nextSelected = selectedId === id ? null : selectedId;
    commit(fragments.filter((fragment) => fragment.id !== id), nextSelected);
    setSelectedId(nextSelected);
    if (selectedId === id) setPendingSource(null);
    setNotice(`Участок ${index + 1} удалён. Ctrl+Z вернёт его.`);
  };
  const deleteSelected = () => {
    if (selectedId != null) deleteFragment(selectedId);
  };
  const toggleFragmentVisibility = (id: number) => {
    const fragment = fragments.find((item) => item.id === id);
    if (!fragment) return;
    const visible = !fragment.visible;
    commit(fragments.map((item) => item.id === id ? { ...item, visible } : item), visible ? id : (selectedId === id ? null : selectedId));
    if (visible) {
      setSelectedId(id);
      setNotice('Участок показан на холсте и будет сохранён в PNG.');
    } else {
      if (selectedId === id) setSelectedId(null);
      setNotice('Участок скрыт: он не отображается на холсте и не попадёт в PNG.');
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
        event.preventDefault();
        // Пока рисуется контур, Ctrl+Z убирает последнюю вершину, а не откатывает историю.
        if (!event.shiftKey && tool === 'lasso' && draftPolygon.length) removeLastDraftPoint();
        else if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
      if (event.key === 'Escape' && (draftPolygon.length > 0 || pendingSource)) {
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
        // Во время оцифровки контура клавиша убирает последнюю вершину и не трогает готовые участки.
        if (event.repeat) return;
        if (tool === 'lasso' && draftPolygon.length) { event.preventDefault(); removeLastDraftPoint(); return; }
        if (selectedId != null) { event.preventDefault(); deleteSelected(); }
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
  }, [undo, redo, tool, finishLasso, selectedId, deleteSelected, draftPolygon.length, removeLastDraftPoint, zoomAtRef, canvasCenter, pendingSource]);

  const onImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (fragments.length > 0) { setPendingFile(file); return; }
    void processFile(file);
  };
  const exportPng = () => {
    if (!documentImage) return;
    const hiddenCount = fragments.length - exportableFragments(fragments).length;
    let output: HTMLCanvasElement;
    try {
      output = window.document.createElement('canvas');
      output.width = documentImage.width; output.height = documentImage.height;
      const context = output.getContext('2d');
      if (!context) throw new Error('Не удалось создать экспортное изображение.');
      context.imageSmoothingQuality = 'high';
      drawScene(context, output.width, output.height, false, null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'SecurityError') setError('Экспорт запрещён политикой безопасности: холст скомпрометирован сторонними данными.');
      else setError(caught instanceof Error ? caught.message : 'Экспорт не удался: браузер не смог подготовить изображение.');
      return;
    }
    try {
      output.toBlob((blob) => {
        if (!blob) { setError('Не удалось сформировать PNG — вероятно, размер превышает лимиты браузера. Уменьшите скан и попробуйте снова.'); return; }
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url; link.download = `${documentImage.name.replace(/\.[^.]+$/, '')}-исправлено.png`;
        link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        const sizeMb = blob.size / (1024 * 1024);
        const hiddenNote = hiddenCount > 0 ? ` Скрытых участков не включено: ${hiddenCount}.` : '';
        setNotice(sizeMb > 50
          ? `PNG сохранён (${Math.round(sizeMb)} МБ). Файл большой — скачивание и открытие могут занять время.${hiddenNote}`
          : `PNG сохранён в исходном разрешении документа.${hiddenNote}`);
      }, 'image/png');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'SecurityError') setError('Экспорт запрещён политикой безопасности: холст скомпрометирован сторонними данными.');
      else setError('Экспорт не удался: браузер не смог сформировать PNG.');
    }
  };
  const applyProject = useCallback((project: ProjectFile) => {
    idCounter.current = Math.max(project.nextId, 1);
    // commit и клонирует, и записывает шаг истории: undo вернёт к состоянию «до проекта».
    commit(project.fragments, null);
    setSelectedId(null);
    setDraftPolygon([]);
    setPendingSource(null);
    setNotice(`Проект открыт: восстановлено участков — ${project.fragments.length}.`);
  }, [commit]);

  const downloadProject = () => {
    if (!documentImage) return;
    const json = JSON.stringify(serializeProject(documentImage.name, documentImage.width, documentImage.height, fragments, idCounter.current));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url; link.download = `${documentImage.name.replace(/\.[^.]+$/, '')}-проект.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Проект сохранён: контуры и опорные пары в JSON-файле. Изображение в него не входит.');
  };

  const onProjectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const project = typeof reader.result === 'string' ? parseProject(reader.result) : null;
      if (!project) { setError('Файл проекта не распознан: это не сохранение «Редактора сканов карт» нужной версии.'); return; }
      if (!documentImage) {
        setNotice(`Проект требует исходный скан. Откройте «${project.name}» ${project.width}×${project.height} px, затем откройте проект снова.`);
        return;
      }
      if (documentImage.name !== project.name || documentImage.width !== project.width || documentImage.height !== project.height) {
        setError(`Проект создан для другого скана: «${project.name}» ${project.width}×${project.height} px, а сейчас открыт «${documentImage.name}».`);
        return;
      }
      applyProject(project);
    };
    reader.readAsText(file);
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
        projectRef={projectRef}
        canSaveProject={!!documentImage && fragments.length > 0}
        onSaveProject={downloadProject}
        onOpenProject={() => projectRef.current?.click()}
        onProjectFile={onProjectFile}      />

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
          onDeleteFragment={deleteFragment}
          draftCount={draftPolygon.length}
          onRemoveLastPoint={removeLastDraftPoint}
          onCancelDraft={cancelDraft}
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
          onTogglePairTool={() => { setTool(tool === 'points' ? 'select' : 'points'); setPendingSource(null); }}
          onRotate={rotateSelected}
          onDelete={deleteSelected}
          onRemovePair={removePair}
          onClearPairs={() => commit(fragments.map((fragment) => fragment.id === selectedId ? { ...fragment, pairs: [] } : fragment))}
          quality={quality}
          qualityDiagonal={documentImage ? Math.hypot(documentImage.width, documentImage.height) : 0}
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

      <AlertDialog open={pendingRestore != null} onOpenChange={(open) => { if (!open) setPendingRestore(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Продолжить прошлый сеанс?</AlertDialogTitle>
            <AlertDialogDescription>
              Для файла «{pendingRestore?.name}» в этом браузере остались участки с прошлой работы ({pendingRestore?.fragments.length ?? 0} шт.). Восстановить их вместе с опорными парами?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { const project = pendingRestore; if (project) clearSession(project.name, project.width, project.height); setPendingRestore(null); }}>Начать заново</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const project = pendingRestore; setPendingRestore(null); if (project) applyProject(project); }}>Восстановить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export default App;
