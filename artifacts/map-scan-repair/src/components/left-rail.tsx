import { ArrowLeftRight, Eye, EyeOff, Hand, MousePointer2, Redo2, ScanLine, Trash2, Undo2, X } from 'lucide-react';
import type { DocumentImage, Fragment, Tool } from '@/lib/types';

interface LeftRailProps {
  tool: Tool;
  onToolSelect: (tool: Tool) => void;
  documentImage: DocumentImage | null;
  fragments: Fragment[];
  selectedId: number | null;
  pointCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSelectFragment: (id: number) => void;
  onToggleVisibility: (id: number) => void;
  onDeleteFragment: (id: number) => void;
  /** Сколько вершин уже поставлено в незавершённом контуре. */
  draftCount: number;
  onRemoveLastPoint: () => void;
  onCancelDraft: () => void;
}

export function LeftRail({ tool, onToolSelect, documentImage, fragments, selectedId, pointCount, canUndo, canRedo, onUndo, onRedo, onSelectFragment, onToggleVisibility, onDeleteFragment, draftCount, onRemoveLastPoint, onCancelDraft }: LeftRailProps) {
  return (
    <aside className="rail rail-left">
      <div className="rail-head">
        <div className="eyebrow">Рабочий стол / 01</div>
        <h1 className="section-title">Восстановление</h1>
      </div>
      <div className="panel-block">
        <div className="panel-caption">Инструменты</div>
        <div className="tool-list">
          <button className={`tool-button ${tool === 'select' ? 'active' : ''}`} onClick={() => onToolSelect('select')} aria-pressed={tool === 'select'} data-testid="tool-select"><span className="tool-icon"><MousePointer2 size={14} /></span>Выбрать и сдвинуть<span className="shortcut">V</span></button>
          <button className={`tool-button ${tool === 'lasso' ? 'active' : ''}`} onClick={() => onToolSelect('lasso')} aria-pressed={tool === 'lasso'} data-testid="tool-lasso"><span className="tool-icon"><ScanLine size={14} /></span>Контур фрагмента<span className="shortcut">L</span></button>
          <button className={`tool-button ${tool === 'points' ? 'active' : ''}`} onClick={() => onToolSelect('points')} aria-pressed={tool === 'points'} data-testid="tool-control-points"><span className="tool-icon"><ArrowLeftRight size={14} /></span>Опорные точки<span className="shortcut">P</span></button>
          <button className={`tool-button ${tool === 'pan' ? 'active' : ''}`} onClick={() => onToolSelect('pan')} aria-pressed={tool === 'pan'} data-testid="tool-pan"><span className="tool-icon"><Hand size={14} /></span>Перемещение вида<span className="shortcut">Пробел</span></button>
        </div>
        {tool === 'lasso' && <>
          <p className="hint">Щёлкайте по вершинам. Замкните контур кликом по первой точке или нажмите Enter. Лишнюю вершину уберите правым кликом по ней, клавишей Backspace (последняя) или кнопкой ниже. Escape отменяет контур.</p>
          <div className="draft-actions">
            <button className="mini-action" onClick={onRemoveLastPoint} disabled={draftCount === 0} data-testid="button-remove-last-point"><Undo2 size={13} />Убрать точку{draftCount > 0 ? ` (${draftCount})` : ''}</button>
            <button className="mini-action" onClick={onCancelDraft} disabled={draftCount === 0} data-testid="button-cancel-draft"><X size={13} />Отменить контур</button>
          </div>
        </>}
        {tool === 'points' && <p className="hint">Для каждой пары: щёлкните исходное место, затем его правильное положение. Три пары и более включают локальную сетку деформации.</p>}
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
          <button className="mini-action" onClick={onUndo} disabled={!canUndo} data-testid="button-undo"><Undo2 size={13} />Отменить</button>
          <button className="mini-action" onClick={onRedo} disabled={!canRedo} data-testid="button-redo"><Redo2 size={13} />Повторить</button>
        </div>
      </div>
      <div className="panel-block" style={{ flex: 1 }}>
        <div className="panel-caption">Обработанные участки</div>
        {fragments.length === 0 ? <p className="hint">Пока нет выделенных областей. Обведите повреждённый участок инструментом «Контур фрагмента».</p> : fragments.map((fragment, index) => (
          <div key={fragment.id} className={`fragment-item ${selectedId === fragment.id ? 'selected' : ''}`} data-testid={`fragment-item-${fragment.id}`}>
            <button className="fragment-select" onClick={() => onSelectFragment(fragment.id)} data-testid={`fragment-select-${fragment.id}`}>
              <span className="fragment-num">{String(index + 1).padStart(2, '0')}</span>
              <span className="fragment-details">Участок карты<small>{fragment.polygon.length} вершин · {fragment.pairs.length} пар</small></span>
            </button>
            <button
              className={`fragment-visibility ${fragment.visible ? 'visible' : ''}`}
              onClick={() => onToggleVisibility(fragment.id)}
              title={fragment.visible ? 'Скрыть участок с холста' : 'Закрепить показ на холсте'}
              aria-label={fragment.visible ? 'Скрыть участок с холста' : 'Закрепить показ на холсте'}
              aria-pressed={fragment.visible}
              data-testid={`fragment-visibility-${fragment.id}`}
            >
              {fragment.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button
              className="fragment-delete"
              onClick={() => onDeleteFragment(fragment.id)}
              title="Удалить участок (Ctrl+Z вернёт)"
              aria-label={`Удалить участок ${index + 1}`}
              data-testid={`fragment-delete-${fragment.id}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {fragments.length > 0 && <p className="hint">Нажмите на участок, чтобы выбрать его. Значок глаза включает и выключает участок: скрытые участки не показываются на холсте и не попадают в PNG. Корзина удаляет участок (Ctrl+Z вернёт).</p>}
      </div>
      <div className="panel-block">
        <div className="eyebrow">Все операции выполняются локально</div>
        <p className="hint">Скан не покидает это устройство. История хранится в памяти вкладки — до сотни последних шагов.</p>
      </div>
    </aside>
  );
}
