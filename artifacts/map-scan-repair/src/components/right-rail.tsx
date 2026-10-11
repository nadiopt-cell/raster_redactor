import { ArrowLeftRight, CircleHelp, RotateCcw, RotateCw, X } from 'lucide-react';
import type { Fragment, Tool } from '@/lib/types';

interface RightRailProps {
  selectedFragment: Fragment | null;
  tool: Tool;
  canWarp: boolean;
  onTogglePairTool: () => void;
  onRotate: (degrees: number) => void;
  onDelete: () => void;
  onRemovePair: (index: number) => void;
  onClearPairs: () => void;
}

export function RightRail({ selectedFragment, tool, canWarp, onTogglePairTool, onRotate, onDelete, onRemovePair, onClearPairs }: RightRailProps) {
  return (
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
            <button className="mini-action" onClick={() => onRotate(-1)} data-testid="button-rotate-left"><RotateCcw size={13} />−1°</button>
            <button className="mini-action" onClick={() => onRotate(1)} data-testid="button-rotate-right"><RotateCw size={13} />+1°</button>
            <button className="mini-action" onClick={onDelete} title="Удалить фрагмент" data-testid="button-delete-fragment"><X size={13} />Убрать</button>
          </div>
          <div className="instruction">В режиме «Выбрать и сдвинуть» тяните фрагмент за область или пунктирный край. Shift или пробел — двигать весь лист.</div>
        </> : <p className="hint">Выберите участок на листе или начертите контур, чтобы увидеть его параметры.</p>}
      </div>
      <div className="panel-block right-content">
        <div className="panel-caption">Сшивка по опорным точкам</div>
        {!selectedFragment ? <p className="hint">Выделите фрагмент перед созданием пар точек.</p> : <>
          <p className="hint">Пара задаёт соответствие исходной точки её целевому положению. Деформация строится по треугольной сетке.</p>
          <div className="control-row">
            <button className={`btn ${tool === 'points' ? 'btn-primary' : ''}`} onClick={onTogglePairTool} data-testid="button-add-control-pair"><ArrowLeftRight size={14} />{tool === 'points' ? 'Завершить пары' : 'Поставить пару'}</button>
          </div>
          {selectedFragment.pairs.length > 0 && selectedFragment.pairs.map((pair, index) => (
            <div className="control-pair" key={`${selectedFragment.id}-${index}`}>
              <div className="pair-head"><span className="pair-index">{index + 1}</span><span className="eyebrow">Сопоставление</span><button className="btn-icon" onClick={() => onRemovePair(index)} title="Удалить пару" aria-label={`Удалить пару ${index + 1}`}><X size={13} /></button></div>
              <div className="point-cell">ИСТОЧНИК<strong>{Math.round(pair.source.x)}, {Math.round(pair.source.y)}</strong></div>
              <div className="point-cell">ЦЕЛЬ<strong>{Math.round(pair.target.x)}, {Math.round(pair.target.y)}</strong></div>
            </div>
          ))}
          {selectedFragment.pairs.length > 0 && <button className="mini-action" style={{ width: '100%', marginTop: 8 }} onClick={onClearPairs} data-testid="button-clear-pairs"><X size={13} />Очистить пары</button>}
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
  );
}
