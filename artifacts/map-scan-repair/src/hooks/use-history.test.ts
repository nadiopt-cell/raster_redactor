import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, pushHistoryEntry, restoreSelection } from './use-history';
import type { Fragment, HistoryEntry } from '@/lib/types';

const makeFragment = (id: number): Fragment => ({
  id, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], dx: 0, dy: 0, rotation: 0, pairs: [], visible: true,
});

const entry = (id: number): HistoryEntry => ({ fragments: [makeFragment(id)], selectedId: id });

describe('pushHistoryEntry', () => {
  it('добавляет запись после текущего индекса, обрывая redo-ветку', () => {
    const history = [entry(1), entry(2), entry(3)];
    // Стоим на записи 1 (index 0): redo-ветка [2, 3] должна пропасть.
    const { history: next, index } = pushHistoryEntry(history, 0, entry(4));
    expect(next.map((item) => item.fragments[0].id)).toEqual([1, 4]);
    expect(index).toBe(1);
  });

  it('растёт от пустой истории', () => {
    const initial: HistoryEntry = { fragments: [], selectedId: null };
    const { history, index } = pushHistoryEntry([initial], 0, entry(1));
    expect(history).toHaveLength(2);
    expect(index).toBe(1);
  });

  it('РЕГРЕССИЯ: на лимите отбрасывает самые старые записи и держит индекс на последней', () => {
    let history = Array.from({ length: HISTORY_LIMIT }, (_, id) => entry(id));
    let index = HISTORY_LIMIT - 1;
    ({ history, index } = pushHistoryEntry(history, index, entry(100)));
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].fragments[0].id).toBe(1); // запись 0 выброшена
    expect(index).toBe(HISTORY_LIMIT - 1);
    expect(history[index].fragments[0].id).toBe(100);
  });

  it('повторные коммиты на лимите не растят массив и не теряют свежие записи', () => {
    let history = Array.from({ length: HISTORY_LIMIT }, (_, id) => entry(id));
    let index = HISTORY_LIMIT - 1;
    for (let nextId = HISTORY_LIMIT; nextId < HISTORY_LIMIT + 5; nextId++) {
      ({ history, index } = pushHistoryEntry(history, index, entry(nextId)));
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[index].fragments[0].id).toBe(HISTORY_LIMIT + 4);
    expect(history[0].fragments[0].id).toBe(5);
  });

  it('РЕГРЕССИЯ: два коммита в одном батче сохраняют обе записи', () => {
    // Раньше commit вычислял setHistoryIndex с устаревшим historyIndex из замыкания:
    // второй pushHistoryEntry обязан обрезал redo-ветку вместе с только что добавленной записью.
    // Теперь index всегда берётся из результата предыдущего pushHistoryEntry (актуальный stateRef).
    const initial: HistoryEntry = { fragments: [], selectedId: null };
    const first = pushHistoryEntry([initial], 0, entry(1));
    const second = pushHistoryEntry(first.history, first.index, entry(2));
    expect(second.history.map((item) => item.selectedId)).toEqual([null, 1, 2]);
    expect(second.index).toBe(2);
  });
});

describe('restoreSelection', () => {
  it('возвращает id, если фрагмент есть в снапшоте', () => {
    expect(restoreSelection(entry(7))).toBe(7);
  });

  it('сбрасывает выделение, если фрагмента в снапшоте больше нет', () => {
    expect(restoreSelection({ fragments: [], selectedId: 7 })).toBeNull();
  });

  it('возвращает null для снапшота без выделения', () => {
    expect(restoreSelection({ fragments: [makeFragment(1)], selectedId: null })).toBeNull();
  });
});
