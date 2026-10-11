import { FileImage, FilePlus2, X } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import type { DocumentImage, Point, Tool } from '@/lib/types';

interface CanvasStageProps {
  toolbar: ReactNode;
  wrapRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  documentImage: DocumentImage | null;
  loading: boolean;
  error: string;
  notice: string;
  tool: Tool;
  pendingSource: Point | null;
  cursorClass: string;
  onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: () => void;
  onCloseError: () => void;
  onImportClick: () => void;
}

export function CanvasStage({ toolbar, wrapRef, canvasRef, documentImage, loading, error, notice, tool, pendingSource, cursorClass, onPointerDown, onPointerMove, onPointerUp, onCloseError, onImportClick }: CanvasStageProps) {
  return (
    <section className="canvas-column">
      {toolbar}
      <div className={`canvas-wrap ${cursorClass}`} ref={wrapRef}>
        {documentImage && <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onContextMenu={(event) => event.preventDefault()} data-testid="map-canvas" />}
        {!documentImage && !loading && <div className="canvas-empty"><div className="empty-card"><div className="empty-icon"><FileImage size={23} /></div><h2>Начните с листа карты</h2><p>Откройте изображение или PDF. Пример скана загружается автоматически — если он недоступен, выберите файл вручную.</p><button className="btn btn-primary" onClick={onImportClick}><FilePlus2 size={15} />Выбрать документ</button></div></div>}
        {loading && <div className="loading-surface"><div className="loading-box">Подготавливаем скан на этом устройстве<div className="skeleton-line" /><div className="skeleton-line" style={{ width: '72%' }} /></div></div>}
        {error && <div className="error-banner" role="alert">{error} <button className="btn-icon" onClick={onCloseError} aria-label="Закрыть сообщение"><X size={13} /></button></div>}
        {notice && <div className="canvas-overlay" role="status">{notice}</div>}
      </div>
      <footer className="canvas-statusbar">
        <span>{tool === 'lasso' ? 'КОНТУР · КЛИК — ВЕРШИНА · ENTER — ЗАМКНУТЬ · ESC — ОТМЕНА' : tool === 'points' ? pendingSource ? 'ТОЧКИ · ИСТОЧНИК ОТМЕЧЕН · ВЫБЕРИТЕ ЦЕЛЬ' : 'ТОЧКИ · ВЫБЕРИТЕ ИСХОДНУЮ ТОЧКУ' : 'КООРДИНАТЫ В ПИКСЕЛЯХ ИСХОДНОГО СКАНА'}</span>
        <span>{documentImage ? `${documentImage.width} × ${documentImage.height} PX` : 'НЕТ ДОКУМЕНТА'}</span>
      </footer>
    </section>
  );
}
