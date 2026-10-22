import { describe, expect, it } from 'vitest';
import { pairQuality, residualGrade } from './quality';
import type { Fragment } from './types';

const squareFragment = (pairs: Fragment['pairs']): Fragment => ({
  id: 1,
  polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }],
  dx: 0, dy: 0, rotation: 0, pairs, visible: true,
});

describe('pairQuality', () => {
  it('меньше трёх пар — остатки не определены', () => {
    const quality = pairQuality(squareFragment([{ source: { x: 50, y: 50 }, target: { x: 60, y: 60 } }]));
    expect(quality.residuals).toEqual([null]);
    expect(quality.rms).toBeNull();
  });

  it('согласованная сетка (пары остаются на месте) даёт нулевые остатки и RMS', () => {
    const quality = pairQuality(squareFragment([
      { source: { x: 60, y: 60 }, target: { x: 60, y: 60 } },
      { source: { x: 140, y: 60 }, target: { x: 140, y: 60 } },
      { source: { x: 140, y: 140 }, target: { x: 140, y: 140 } },
    ]));
    quality.residuals.forEach((residual) => expect(residual).toBeCloseTo(0, 6));
    expect(quality.rms).toBeCloseTo(0, 6);
  });

  it('оторвавшаяся пара получает большой остаток, который виден и в RMS', () => {
    const quality = pairQuality(squareFragment([
      { source: { x: 60, y: 60 }, target: { x: 60, y: 60 } },
      { source: { x: 140, y: 60 }, target: { x: 140, y: 60 } },
      { source: { x: 140, y: 140 }, target: { x: 140, y: 140 } },
      { source: { x: 60, y: 140 }, target: { x: 120, y: 140 } }, // цель сдвинута влево на 60 px
    ]));
    const last = quality.residuals[3];
    expect(last).not.toBeNull();
    expect(last as number).toBeGreaterThan(5);
    expect(quality.rms as number).toBeGreaterThan(2);
  });

  it('результат кешируется: тот же fragment.pairs и polygon возвращают тот же объект', () => {
    const pairs = [
      { source: { x: 60, y: 60 }, target: { x: 70, y: 60 } },
      { source: { x: 140, y: 60 }, target: { x: 150, y: 60 } },
      { source: { x: 140, y: 140 }, target: { x: 150, y: 140 } },
    ];
    const fragment = squareFragment(pairs);
    expect(pairQuality(fragment)).toBe(pairQuality({ ...fragment, dx: 25 }));
  });

  it('изменённый полигон пересчитывается заново', () => {
    const pairs = [
      { source: { x: 60, y: 60 }, target: { x: 70, y: 60 } },
      { source: { x: 140, y: 60 }, target: { x: 150, y: 60 } },
      { source: { x: 140, y: 140 }, target: { x: 150, y: 140 } },
    ];
    const fragment = squareFragment(pairs);
    const fresh = pairQuality({ ...fragment, polygon: fragment.polygon.map((point) => ({ ...point })) });
    expect(fresh.residuals).toHaveLength(3);
  });
});

describe('residualGrade', () => {
  const diagonal = 4000; // как у скана на 3000×2600 px

  it('норма / внимание / явное расхождение', () => {
    expect(residualGrade(3, diagonal)).toBe('ok');
    expect(residualGrade(10, diagonal)).toBe('watch');
    expect(residualGrade(40, diagonal)).toBe('bad');
  });
});
