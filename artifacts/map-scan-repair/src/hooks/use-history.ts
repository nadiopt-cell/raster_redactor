import { useCallback, useState } from 'react';
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

export function useHistory(
  setFragments: (next: Fragment[]) => void,
  selectedId: number | null,
  setSelectedId: (id: number | null) => void,
  setNotice: (message: string) => void,
) {
  const [history, setHistory] = useState<HistoryEntry[]>([{ fragments: [], selectedId: null }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const commit = useCallback((next: Fragment[], nextSelectedId?: number | null) => {
    const clean = cloneFragments(next);
    const selection = nextSelectedId === undefined ? selectedId : nextSelectedId;
    setFragments(clean);
    setHistory((old) => pushHistoryEntry(old, historyIndex, { fragments: cloneFragments(clean), selectedId: selection ?? null }).history);
    setHistoryIndex(pushHistoryEntry(history, historyIndex, { fragments: clean, selectedId: selection ?? null }).index);
  }, [history, historyIndex, selectedId, setFragments]);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const index = historyIndex - 1;
    const snapshot = history[index];
    setHistoryIndex(index);
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(restoreSelection(snapshot));
    setNotice('Изменение отменено.');
  }, [canUndo, history, historyIndex, setFragments, setSelectedId, setNotice]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const index = historyIndex + 1;
    const snapshot = history[index];
    setHistoryIndex(index);
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(restoreSelection(snapshot));
    setNotice('Изменение восстановлено.');
  }, [canRedo, history, historyIndex, setFragments, setSelectedId, setNotice]);

  const resetHistory = useCallback(() => {
    setHistory([{ fragments: [], selectedId: null }]);
    setHistoryIndex(0);
  }, []);

  return { history, historyIndex, canUndo, canRedo, commit, undo, redo, resetHistory };
}
