import { useCallback, useRef, useState } from 'react';
import { cloneFragments } from '@/lib/geometry';
import type { Fragment, HistoryEntry } from '@/lib/types';

export const HISTORY_LIMIT = 100;

// Чистая математика истории (покрыта тестами use-history.test.ts):
// запись добавляется после текущего индекса, обрывая redo-ветку; при переполнении
// лимита самые старые записи отбрасываются, индекс всегда указывает на последнюю запись.
export const pushHistoryEntry = (
  history: HistoryEntry[],
  index: number,
  entry: HistoryEntry,
): { history: HistoryEntry[]; index: number } => {
  const trimmed = [...history.slice(0, index + 1), entry];
  const overflow = trimmed.length - HISTORY_LIMIT;
  const next = overflow > 0 ? trimmed.slice(overflow) : trimmed;
  return { history: next, index: next.length - 1 };
};

// Восстановление выделения: id валиден, только если такой фрагмент есть в снапшоте.
export const restoreSelection = (snapshot: HistoryEntry): number | null =>
  snapshot.fragments.some((fragment) => fragment.id === snapshot.selectedId) ? snapshot.selectedId : null;

// История и индекс живут в одном состоянии: они обязаны меняться вместе,
// иначе между двумя set-вызовами возможен рассогласованный взгляд на историю.
type HistoryState = { history: HistoryEntry[]; index: number };

const initialValues = (): HistoryState => ({ history: [{ fragments: [], selectedId: null }], index: 0 });

export function useHistory(
  setFragments: (next: Fragment[]) => void,
  selectedId: number | null,
  setSelectedId: (id: number | null) => void,
  setNotice: (message: string) => void,
) {
  const [state, setState] = useState<HistoryState>(initialValues);
  // Синхронное зеркало состояния: все мутации проходят через apply(),
  // поэтому два вызова commit в одном батче видят результат первого
  // и не используют устаревший индекс (раньше это теряло undo-записи).
  const stateRef = useRef(state);
  const apply = useCallback((next: HistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const { history, index: historyIndex } = state;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const commit = useCallback((next: Fragment[], nextSelectedId?: number | null) => {
    const clean = cloneFragments(next);
    const selection = nextSelectedId === undefined ? selectedId : nextSelectedId;
    setFragments(clean);
    apply(pushHistoryEntry(stateRef.current.history, stateRef.current.index, { fragments: cloneFragments(clean), selectedId: selection ?? null }));
  }, [apply, selectedId, setFragments]);

  const undo = useCallback(() => {
    const old = stateRef.current;
    if (old.index <= 0) return;
    const snapshot = old.history[old.index - 1];
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(restoreSelection(snapshot));
    setNotice('Изменение отменено.');
    apply({ history: old.history, index: old.index - 1 });
  }, [apply, setFragments, setSelectedId, setNotice]);

  const redo = useCallback(() => {
    const old = stateRef.current;
    if (old.index >= old.history.length - 1) return;
    const snapshot = old.history[old.index + 1];
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(restoreSelection(snapshot));
    setNotice('Изменение восстановлено.');
    apply({ history: old.history, index: old.index + 1 });
  }, [apply, setFragments, setSelectedId, setNotice]);

  const resetHistory = useCallback(() => apply(initialValues()), [apply]);

  return { canUndo, canRedo, commit, undo, redo, resetHistory };
}