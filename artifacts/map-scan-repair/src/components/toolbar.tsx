import {
  ArrowDownToLine, ArrowLeftRight, Columns2, FilePlus2, FolderOpen, Hand, MousePointer2, Redo2, Save,
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
  comparing: boolean;
  /** 0 — только результат, 1 — только нетронутый оригинал. */
  compare: number;
  canCompare: boolean;
  onCompareToggle: () => void;
  onCompareChange: (value: number) => void;
}

export function Toolbar({ tool, onToolSelect, canUndo, canRedo, onUndo, onRedo, onZoomIn, onZoomOut, onFit, percentZoom, selectedNumber, onRotate, onDelete, comparing, compare, canCompare, onCompareToggle, onCompareChange }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className={`btn-icon ${tool === 'select' ? 'active' : ''}`} onClick={() => onToolSelect('select')} aria-pressed={tool === 'select'} title="Выбрать фрагмент" aria-label="Выбрать фрагмент" data-testid="toolbar-select"><MousePointer2 size={15} /></button>
        <button className={`btn-icon ${tool === 'lasso' ? 'active' : ''}`} onClick={() => onToolSelect('lasso')} aria-pressed={tool === 'lasso'} title="Контур фрагмента" aria-label="Контур фрагмента" data-testid="toolbar-lasso"><ScanLine size={15} /></button>
        <button className={`btn-icon ${tool === 'points' ? 'active' : ''}`} onClick={() => onToolSelect('points')} aria-pressed={tool === 'points'} title="Опорные точки" aria-label="Опорные точки" data-testid="toolbar-points"><ArrowLeftRight size={15} /></button>
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
        <button className={`btn-icon ${comparing ? 'active' : ''}`} onClick={onCompareToggle} disabled={!canCompare} title="Сравнить до/после" aria-pressed={comparing} data-testid="toolbar-compare"><Columns2 size={16} /></button>
        {comparing && <input type="range" className="compare-slider" min={0} max={100} value={Math.round(compare * 100)} onChange={(event) => onCompareChange(Number(event.target.value) / 100)} aria-label="Доля нетронутого оригинала поверх результата" data-testid="compare-slider" />}
        {comparing && <span className="tool-separator" />}
        {selectedNumber != null && <>
          <button className="btn-icon" onClick={() => onRotate(-1)} title="Повернуть на −1°" aria-label="Повернуть на −1°" data-testid="toolbar-rotate-left"><RotateCcw size={15} /></button>
          <button className="btn-icon" onClick={() => onRotate(1)} title="Повернуть на +1°" aria-label="Повернуть на +1°" data-testid="toolbar-rotate-right"><RotateCw size={15} /></button>
          <button className="btn-icon" onClick={onDelete} title="Удалить фрагмент" aria-label="Удалить фрагмент" data-testid="toolbar-delete-fragment"><X size={15} /></button>
          <span className="tool-separator" />
        </>}
        <button className={`btn-icon ${tool === 'pan' ? 'active' : ''}`} onClick={() => onToolSelect('pan')} aria-pressed={tool === 'pan'} title="Переместить вид" aria-label="Переместить вид" data-testid="toolbar-pan"><Hand size={15} /></button>
        <span className="tool-separator" />
        <span className="eyebrow" style={{ letterSpacing: '.08em' }}>{selectedNumber != null ? `ФРАГМЕНТ ${selectedNumber}` : 'ОБЗОР ЛИСТА'}</span>
      </div>
    </div>
  );
}

export interface TopbarProps {
  documentImage: DocumentImage | null;
  projectRef: RefObject<HTMLInputElement | null>;
  canSaveProject: boolean;
  onSaveProject: () => void;
  onOpenProject: () => void;
  onProjectFile: (event: ChangeEvent<HTMLInputElement>) => void;  fileRef: RefObject<HTMLInputElement | null>;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportClick: () => void;
  onExportClick: () => void;
}

export function Topbar({ documentImage, fileRef, projectRef, canSaveProject, onSaveProject, onOpenProject, onProjectFile, onImportFile, onImportClick, onExportClick }: TopbarProps) {
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
      <input ref={projectRef} type="file" accept=".json,application/json" hidden onChange={onProjectFile} data-testid="input-open-project" />
      <div className="header-actions">
        <button className="btn" onClick={onImportClick} data-testid="button-import-document"><FilePlus2 size={15} /><span>Открыть файл</span></button>
        <button className="btn" onClick={onSaveProject} disabled={!canSaveProject} title="Контуры и опорные пары в JSON-файле" data-testid="button-save-project"><Save size={15} /><span>Сохранить проект</span></button>
        <button className="btn" onClick={onOpenProject} title="Продолжить работу из сохранённого проекта" data-testid="button-open-project"><FolderOpen size={15} /><span>Открыть проект</span></button>
        <button className="btn btn-primary" onClick={onExportClick} disabled={!documentImage} data-testid="button-export-png"><ArrowDownToLine size={15} /><span>Экспорт PNG</span></button>
      </div>
    </header>
  );
}
