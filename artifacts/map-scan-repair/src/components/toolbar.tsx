import {
  ArrowDownToLine, ArrowLeftRight, FilePlus2, Hand, MousePointer2, Redo2,
  RotateCcw, RotateCw, ScanLine, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';
import type { DocumentImage, Tool } from '@/lib/types';

interface ToolbarProps {
  tool: Tool;
  onToolSelect: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  percentZoom: string;
  selectedNumber: number | null;
  onRotate: (degrees: number) => void;
  onDelete: () => void;
}

export function Toolbar({ tool, onToolSelect, canUndo, canRedo, onUndo, onRedo, onZoomIn, onZoomOut, onFit, percentZoom, selectedNumber, onRotate, onDelete }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className={`btn-icon ${tool === 'select' ? 'active' : ''}`} onClick={() => onToolSelect('select')} title="Выбрать фрагмент" aria-label="Выбрать фрагмент" data-testid="toolbar-select"><MousePointer2 size={15} /></button>
        <button className={`btn-icon ${tool === 'lasso' ? 'active' : ''}`} onClick={() => onToolSelect('lasso')} title="Контур фрагмента" aria-label="Контур фрагмента" data-testid="toolbar-lasso"><ScanLine size={15} /></button>
        <button className={`btn-icon ${tool === 'points' ? 'active' : ''}`} onClick={() => onToolSelect('points')} title="Опорные точки" aria-label="Опорные точки" data-testid="toolbar-points"><ArrowLeftRight size={15} /></button>
        <span className="tool-separator" />
        <button className="btn-icon" onClick={onUndo} disabled={!canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить" data-testid="canvas-undo"><Undo2 size={16} /></button>
        <button className="btn-icon" onClick={onRedo} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить" data-testid="canvas-redo"><Redo2 size={16} /></button>
        <span className="tool-separator" />
        <button className="btn-icon" onClick={onZoomOut} title="Уменьшить" aria-label="Уменьшить" data-testid="zoom-out"><ZoomOut size={16} /></button>
        <span className="zoom-readout">{percentZoom}</span>
        <button className="btn-icon" onClick={onZoomIn} title="Увеличить" aria-label="Увеличить" data-testid="zoom-in"><ZoomIn size={16} /></button>
        <button className="btn-icon" onClick={onFit} title="Вписать лист" aria-label="Вписать лист" data-testid="zoom-fit"><ScanLine size={16} /></button>
      </div>
      <div className="toolbar-group">
        {selectedNumber != null && <>
          <button className="btn-icon" onClick={() => onRotate(-1)} title="Повернуть на −1°" aria-label="Повернуть на −1°" data-testid="toolbar-rotate-left"><RotateCcw size={15} /></button>
          <button className="btn-icon" onClick={() => onRotate(1)} title="Повернуть на +1°" aria-label="Повернуть на +1°" data-testid="toolbar-rotate-right"><RotateCw size={15} /></button>
          <button className="btn-icon" onClick={onDelete} title="Удалить фрагмент" aria-label="Удалить фрагмент" data-testid="toolbar-delete-fragment"><X size={15} /></button>
          <span className="tool-separator" />
        </>}
        <button className="btn-icon" onClick={() => onToolSelect('pan')} title="Переместить вид" aria-label="Переместить вид"><Hand size={15} /></button>
        <span className="tool-separator" />
        <span className="eyebrow" style={{ letterSpacing: '.08em' }}>{selectedNumber != null ? `ФРАГМЕНТ ${selectedNumber}` : 'ОБЗОР ЛИСТА'}</span>
      </div>
    </div>
  );
}

export interface TopbarProps {
  documentImage: DocumentImage | null;
  fileRef: RefObject<HTMLInputElement | null>;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportClick: () => void;
  onExportClick: () => void;
}

export function Topbar({ documentImage, fileRef, onImportFile, onImportClick, onExportClick }: TopbarProps) {
  return (
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
        <button className="btn" onClick={onImportClick} data-testid="button-import-document"><FilePlus2 size={15} /><span>Открыть файл</span></button>
        <button className="btn btn-primary" onClick={onExportClick} disabled={!documentImage} data-testid="button-export-png"><ArrowDownToLine size={15} /><span>Экспорт PNG</span></button>
      </div>
    </header>
  );
}
