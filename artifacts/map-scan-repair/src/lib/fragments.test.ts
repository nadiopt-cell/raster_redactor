import { describe, expect, it } from 'vitest';
import { exportableFragments, nearestPointIndex, removePointAt } from './fragments';
import type { Fragment, Point } from './types';

const fragment = (id: number, visible: boolean): Fragment => ({
  id, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], dx: 0, dy: 0, rotation: 0, pairs: [], visible,
});

describe('exportableFragments', () => {
  it('отбрасывает скрытые участки и сохраняет порядок видимых', () => {
    const result = exportableFragments([fragment(1, true), fragment(2, false), fragment(3, true)]);
    expect(result.map((f) => f.id)).toEqual([1, 3]);
  });

  it('если все скрыты, экспортировать нечего', () => {
    expect(exportableFragments([fragment(1, false), fragment(2, false)])).toEqual([]);
  });

  it('не меняет исходный массив', () => {
    const input = [fragment(1, true), fragment(2, false)];
    exportableFragments(input);
    expect(input).toHaveLength(2);
  });
});

describe('nearestPointIndex', () => {
  const points: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it('находит вершину в радиусе', () => {
    expect(nearestPointIndex(points, { x: 98, y: 3 }, 10)).toBe(1);
  });

  it('возвращает -1, если рядом ничего нет', () => {
    expect(nearestPointIndex(points, { x: 50, y: 50 }, 10)).toBe(-1);
  });

  it('из двух близких выбирает ближайшую', () => {
    expect(nearestPointIndex([{ x: 0, y: 0 }, { x: 4, y: 0 }], { x: 3, y: 0 }, 10)).toBe(1);
  });

  it('пустой список даёт -1', () => {
    expect(nearestPointIndex([], { x: 0, y: 0 }, 10)).toBe(-1);
  });
});

describe('removePointAt', () => {
  const points: Point[] = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];

  it('удаляет вершину из середины, остальные сохраняют порядок', () => {
    expect(removePointAt(points, 1)).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }]);
  });

  it('удаляет первую и последнюю', () => {
    expect(removePointAt(points, 0)).toEqual([{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(removePointAt(points, 2)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('неверный индекс оставляет массив как есть', () => {
    expect(removePointAt(points, -1)).toBe(points);
    expect(removePointAt(points, 3)).toBe(points);
  });

  it('не мутирует исходный массив', () => {
    removePointAt(points, 0);
    expect(points).toHaveLength(3);
  });
});
