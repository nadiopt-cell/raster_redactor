import { useCallback, useState } from 'react';
import { cloneFragments } from '@/lib/geometry';
import type { Fragment, HistoryEntry } from '@/lib/types';

const HISTORY_LIMIT = 100;

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
    setHistory((old) => {
      const trimmed = [...old.slice(0, historyIndex + 1), { fragments: cloneFragments(clean), selectedId: selection ?? null }];
      return trimmed.length > HISTORY_LIMIT ? trimmed.slice(trimmed.length - HISTORY_LIMIT) : trimmed;
    });
    setHistoryIndex(Math.min(historyIndex + 1, HISTORY_LIMIT - 1));
  }, [historyIndex, selectedId, setFragments]);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const index = historyIndex - 1;
    const snapshot = history[index];
    setHistoryIndex(index);
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(snapshot.fragments.some((fragment) => fragment.id === snapshot.selectedId) ? snapshot.selectedId : null);
    setNotice('Изменение отменено.');
  }, [canUndo, history, historyIndex, setFragments, setSelectedId, setNotice]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const index = historyIndex + 1;
    const snapshot = history[index];
    setHistoryIndex(index);
    setFragments(cloneFragments(snapshot.fragments));
    setSelectedId(snapshot.fragments.some((fragment) => fragment.id === snapshot.selectedId) ? snapshot.selectedId : null);
    setNotice('Изменение восстановлено.');
  }, [canRedo, history, historyIndex, setFragments, setSelectedId, setNotice]);

  const resetHistory = useCallback(() => {
    setHistory([{ fragments: [], selectedId: null }]);
    setHistoryIndex(0);
  }, []);

  return { history, historyIndex, canUndo, canRedo, commit, undo, redo, resetHistory };
}
