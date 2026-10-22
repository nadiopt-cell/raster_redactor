import type { Fragment, Point } from './types';

/** Участки, которые попадают в экспорт: только видимые (скрытые глазком не экспортируются). */
export const exportableFragments = (fragments: Fragment[]): Fragment[] =>
  fragments.filter((fragment) => fragment.visible);

/** Индекс ближайшей к `point` вершины в пределах `radius` или -1. При равенстве побеждает последняя (она нарисована сверху). */
export const nearestPointIndex = (points: Point[], point: Point, radius: number): number => {
  let best = -1;
  let bestDistance = radius;
  points.forEach((candidate, index) => {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d <= bestDistance) { best = index; bestDistance = d; }
  });
  return best;
};

/** Копия массива без элемента `index`; при неверном индексе возвращает исходный массив. */
export const removePointAt = (points: Point[], index: number): Point[] =>
  index < 0 || index >= points.length ? points : points.filter((_, i) => i !== index);
