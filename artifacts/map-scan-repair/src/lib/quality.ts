import { buildMesh, triangulate } from './geometry';
import type { Fragment, Point } from './types';

export type PairQuality = { residuals: (number | null)[]; rms: number | null };
export type ResidualGrade = 'ok' | 'watch' | 'bad';

// Пороги шкалы относительные к диагонали документа: остаток на уровне сотой доли
// диагонали — норма, четверть-процентная — внимание к паре, выше — явное расхождение.
export const residualGrade = (residual: number, diagonal: number): ResidualGrade => {
  if (residual > diagonal / 250) return 'bad';
  if (residual > diagonal / 1000) return 'watch';
  return 'ok';
};

// Барицентрические веса точки в треугольнике; вне треугольника — null, чтобы
// вызывающий код мог перебрать треугольники дальше (eps пропускает вырожденные).
export const barycentric = (triangle: Point[], point: Point): [number, number, number] | null => {
  const [a, b, c] = triangle;
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-9) return null;
  const wA = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / det;
  const wB = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / det;
  const wC = 1 - wA - wB;
  if (wA < -1e-9 || wB < -1e-9 || wC < -1e-9) return null;
  return [wA, wB, wC];
};

const computeQuality = (fragment: Fragment): PairQuality => {
  if (fragment.pairs.length < 3) return { residuals: fragment.pairs.map(() => null), rms: null };
  const mesh = buildMesh(fragment);
  const pairStart = fragment.polygon.length;
  const residuals = fragment.pairs.map((_, index) => {
    const meshIndex = pairStart + index;
    const source = mesh[meshIndex].source;
    const aim = mesh[meshIndex].target;
    // leave-one-out: сетка без этой пары сама предсказывает, куда должно упасть её содержимое.
    const others = [...mesh.slice(0, meshIndex), ...mesh.slice(meshIndex + 1)];
    const triangles = triangulate(others.map((point) => point.source));
    for (const triangle of triangles) {
      const weights = barycentric(triangle.map((corner) => others[corner].source), source);
      if (!weights) continue;
      const predicted = triangle.reduce((point, corner, weightIndex) => ({
        x: point.x + others[corner].target.x * weights[weightIndex],
        y: point.y + others[corner].target.y * weights[weightIndex],
      }), { x: 0, y: 0 });
      return Math.hypot(predicted.x - aim.x, predicted.y - aim.y);
    }
    return null; // пара снаружи выпуклой оболочки остальных — интерполяции нет, не оцениваем
  });
  const estimated = residuals.filter((value) => value !== null) as number[];
  const sumSquared = estimated.reduce((sum, value) => sum + value * value, 0);
  return { residuals, rms: estimated.length > 0 ? Math.sqrt(sumSquared / estimated.length) : null };
};

// Кеш по ссылкам массивов pairs и polygon: во время drag оба остаются теми же объектами
// (spread копирует только dx/dy/rotation), поэтому остатки не пересчитываются на каждый кадр.
// Остатки инвариантны к жёсткому сдвигу и повороту фрагмента: все цели двигаются вместе.
const qualityCache = new WeakMap<object, WeakMap<object, PairQuality>>();

export const pairQuality = (fragment: Fragment): PairQuality => {
  let byPolygon = qualityCache.get(fragment.pairs);
  if (!byPolygon) {
    byPolygon = new WeakMap();
    qualityCache.set(fragment.pairs, byPolygon);
  }
  const cached = byPolygon.get(fragment.polygon);
  if (cached) return cached;
  const quality = computeQuality(fragment);
  byPolygon.set(fragment.polygon, quality);
  return quality;
};
