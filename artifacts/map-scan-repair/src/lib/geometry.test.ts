import { describe, expect, it } from 'vitest';
import {
  applyAffineTriangle, buildMesh, cachedCentroid, centroid, cloneFragments, distance,
  expandPolygon, inverseFragmentPoint, pointInside, pointOnOrNearPolygon,
  sourceBBox, transformedPoint, triangleCentroid, triangulate,
} from './geometry';
import type { Fragment, Point } from './types';

const square = (): Point[] => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

const makeFragment = (overrides: Partial<Fragment> = {}): Fragment => ({
  id: 1, polygon: square(), dx: 0, dy: 0, rotation: 0, pairs: [], visible: true, ...overrides,
});

const triangleArea = (t: Point[]) =>
  Math.abs((t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;

const captureTransform = () => {
  const matrix = [1, 0, 0, 1, 0, 0];
  const ctx = {
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      const [a0, b0, c0, d0, e0, f0] = matrix;
      matrix[0] = a0 * a + c0 * b; matrix[1] = b0 * a + d0 * b;
      matrix[2] = a0 * c + c0 * d; matrix[3] = b0 * c + d0 * d;
      matrix[4] = a0 * e + c0 * f + e0; matrix[5] = b0 * e + d0 * f + f0;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, matrix };
};

describe('applyAffineTriangle', () => {
  it('отображает src в dst для набора треугольников', () => {
    const cases: Point[][][] = [
      [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], [{ x: 20, y: 30 }, { x: 40, y: 30 }, { x: 20, y: 50 }]],
      [[{ x: 1, y: 2 }, { x: 300, y: 4 }, { x: 5, y: 600 }], [{ x: -50, y: 12 }, { x: 80, y: 700 }, { x: 200, y: -30 }]],
      [[{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }], [{ x: 9, y: 9 }, { x: 9, y: 109 }, { x: 59, y: 9 }]],
    ];
    cases.forEach(([src, dst]) => {
      const { ctx, matrix } = captureTransform();
      expect(applyAffineTriangle(ctx, src, dst)).toBe(true);
      const [a, b, c, d, e, f] = matrix;
      src.forEach((point, index) => {
        const px = a * point.x + c * point.y + e;
        const py = b * point.x + d * point.y + f;
        expect(Math.hypot(px - dst[index].x, py - dst[index].y)).toBeLessThan(1e-8);
      });
    });
  });

  it('отклоняет вырожденный (коллинеарный) треугольник и не трогает трансформ', () => {
    const { ctx, matrix } = captureTransform();
    const ok = applyAffineTriangle(ctx, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(ok).toBe(false);
    expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('triangulate', () => {
  it('квадрат + центр даёт 4 треугольника', () => {
    const points = [...square(), { x: 50, y: 50 }];
    expect(triangulate(points)).toHaveLength(4);
  });

  it('дубль вершины даёт 2 треугольника без потери площади', () => {
    const points = [...square(), { x: 0, y: 0 }];
    const triangles = triangulate(points);
    expect(triangles).toHaveLength(2);
    const area = triangles.reduce((sum, tri) => sum + triangleArea(tri.map((index) => points[index])), 0);
    expect(area).toBeCloseTo(10000, 6);
  });

  it('точка на ребре покрывает полную площадь (10000 из 10000)', () => {
    const points = [...square(), { x: 50, y: 0 }];
    const triangles = triangulate(points);
    const area = triangles.reduce((sum, tri) => sum + triangleArea(tri.map((index) => points[index])), 0);
    expect(area).toBeCloseTo(10000, 6);
  });

  it('коллинеарные точки не порождают треугольников', () => {
    expect(triangulate([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])).toHaveLength(0);
  });
});

describe('pointInside / pointOnOrNearPolygon', () => {
  const poly = square();

  it('внутри', () => {
    expect(pointInside({ x: 5, y: 5 }, poly)).toBe(true);
  });

  it('снаружи', () => {
    expect(pointInside({ x: 150, y: 5 }, poly)).toBe(false);
    expect(pointOnOrNearPolygon({ x: 150, y: 5 }, poly, 1)).toBe(false);
    expect(pointOnOrNearPolygon({ x: 50, y: -20 }, poly, 1)).toBe(false);
  });

  it('на ребре ловится через допуск', () => {
    expect(pointOnOrNearPolygon({ x: 0, y: 5 }, poly, 1)).toBe(true);
    expect(pointOnOrNearPolygon({ x: 5, y: 0 }, poly, 1)).toBe(true);
  });

  it('вырожденный полигон не падает', () => {
    const degenerate = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(() => pointInside({ x: 0, y: 0 }, degenerate)).not.toThrow();
    expect(() => pointOnOrNearPolygon({ x: 0, y: 0 }, degenerate, 1)).not.toThrow();
  });
});

describe('transformedPoint / inverseFragmentPoint', () => {
  it('взаимно обратны при произвольных dx, dy, rotation', () => {
    let maxError = 0;
    for (let index = 0; index < 200; index++) {
      const fragment = makeFragment({
        dx: (Math.random() - 0.5) * 500,
        dy: (Math.random() - 0.5) * 500,
        rotation: (Math.random() - 0.5) * 720,
      });
      const point = { x: Math.random() * 2000 - 500, y: Math.random() * 2000 - 500 };
      const restored = inverseFragmentPoint(transformedPoint(point, fragment), fragment);
      maxError = Math.max(maxError, distance(restored, point));
    }
    expect(maxError).toBeLessThan(1e-6);
  });

  it('тождественное преобразование не двигает точку', () => {
    const fragment = makeFragment();
    const point = { x: 30, y: 40 };
    expect(transformedPoint(point, fragment)).toEqual(point);
  });
});

describe('cloneFragments', () => {
  it('глубоко копирует полигоны и пары', () => {
    const fragment = makeFragment({ pairs: [{ source: { x: 1, y: 2 }, target: { x: 3, y: 4 } }] });
    const [clone] = cloneFragments([fragment]);
    expect(clone).toEqual(fragment);
    expect(clone.polygon[0]).not.toBe(fragment.polygon[0]);
    expect(clone.pairs[0].source).not.toBe(fragment.pairs[0].source);
  });
});

describe('buildMesh', () => {
  it('при нулевом сдвиге mesh совпадает с сырыми координатами', () => {
    const fragment = makeFragment({ pairs: [{ source: { x: 40, y: 40 }, target: { x: 60, y: 50 } }] });
    const mesh = buildMesh(fragment);
    expect(mesh).toHaveLength(5);
    mesh.slice(0, 4).forEach((point, index) => {
      expect(point.source).toEqual(fragment.polygon[index]);
      expect(point.target).toEqual(fragment.polygon[index]);
    });
    expect(mesh[4]).toEqual({ source: { x: 40, y: 40 }, target: { x: 60, y: 50 } });
  });

  it('РЕГРЕССИЯ P0: сдвиг фрагмента переносит и вершины, и цели пар на один вектор', () => {
    const pairs = [{ source: { x: 30, y: 30 }, target: { x: 80, y: 90 } }];
    const meshBase = buildMesh(makeFragment({ pairs }));
    const meshDragged = buildMesh(makeFragment({ dx: 15, dy: -7, pairs }));
    meshBase.forEach((point, index) => {
      expect(meshDragged[index].target.x).toBeCloseTo(point.target.x + 15, 8);
      expect(meshDragged[index].target.y).toBeCloseTo(point.target.y - 7, 8);
    });
    // Источники не двигаются: текстура берётся из исходного места скана.
    meshBase.forEach((point, index) => expect(meshDragged[index].source).toEqual(point.source));
  });

  it('РЕГРЕССИЯ P0: поворот вращает цели пар так же, как вершины полигона', () => {
    // Цель пары совпадает с вершиной (0,0): после поворота она обязана
    // отобразиться в ту же точку, что и сама вершина — иначе сшивка рвётся.
    const fragment = makeFragment({ rotation: 30, pairs: [{ source: { x: 50, y: 50 }, target: { x: 0, y: 0 } }] });
    const mesh = buildMesh(fragment);
    expect(mesh[4].target).toEqual(mesh[0].target);
  });
});

describe('sourceBBox', () => {
  it('возвращает bbox с запасом внутри изображения', () => {
    expect(sourceBBox([{ x: 10, y: 20 }, { x: 30, y: 40 }], 2, 1000, 1000))
      .toEqual({ sx: 8, sy: 18, sw: 24, sh: 24 });
  });

  it('клампит к левому/верхнему краю', () => {
    const box = sourceBBox([{ x: -5, y: -5 }, { x: 10, y: 10 }], 2, 1000, 1000);
    expect(box.sx).toBe(0);
    expect(box.sy).toBe(0);
    expect(box.sw).toBe(12);
    expect(box.sh).toBe(12);
  });

  it('клампит к правому/нижнему краю', () => {
    const box = sourceBBox([{ x: 990, y: 990 }, { x: 1100, y: 1200 }], 2, 1000, 1000);
    expect(box.sx).toBe(988);
    expect(box.sy).toBe(988);
    expect(box.sw).toBe(12);
    expect(box.sh).toBe(12);
  });

  it('полигон целиком вне изображения даёт нулевой bbox', () => {
    const box = sourceBBox([{ x: -100, y: -100 }, { x: -50, y: -50 }], 2, 1000, 1000);
    expect(box.sw).toBe(0);
    expect(box.sh).toBe(0);
  });
});

describe('expandPolygon', () => {
  it('отодвигает точки от центроида на заданное расстояние', () => {
    const expanded = expandPolygon(square(), 5);
    // Для вершины (0,0) квадрата 100×100: направление к углу, смещение ровно 5.
    expect(expanded[0].x).toBeCloseTo(-5 / Math.SQRT2, 8);
    expect(expanded[0].y).toBeCloseTo(-5 / Math.SQRT2, 8);
    expect(distance(expanded[0], { x: 0, y: 0 })).toBeCloseTo(5, 8);
  });

  it('вырожденный полигон из одинаковых точек не даёт NaN', () => {
    const expanded = expandPolygon([{ x: 5, y: 5 }, { x: 5, y: 5 }], 3);
    expanded.forEach((point) => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });
});

describe('centroid / cachedCentroid', () => {
  it('считает среднее вершин', () => {
    expect(centroid(square())).toEqual({ x: 50, y: 50 });
  });

  it('кеш: тот же массив — тот же объект, новый массив — новый расчёт', () => {
    const poly = square();
    const first = cachedCentroid(poly);
    expect(cachedCentroid(poly)).toBe(first);
    const moved = poly.map((point) => ({ ...point, x: point.x + 100 }));
    const second = cachedCentroid(moved);
    expect(second).toEqual({ x: 150, y: 50 });
    expect(second).not.toBe(first);
  });
});

describe('distance', () => {
  it('евклидово расстояние', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe('triangleCentroid', () => {
  it('считает среднее трёх вершин', () => {
    expect(triangleCentroid([{ x: 0, y: 0 }, { x: 6, y: 3 }, { x: 3, y: 9 }])).toEqual({ x: 3, y: 4 });
  });
});
