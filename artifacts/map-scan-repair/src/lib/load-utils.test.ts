import { describe, expect, it } from 'vitest';
import { describeLoadError, isPdfFile, isTiffFile } from './load-utils';

describe('isTiffFile', () => {
  it('распознаёт TIFF по mime и расширению', () => {
    expect(isTiffFile({ type: 'image/tiff', name: 'a' })).toBe(true);
    expect(isTiffFile({ type: '', name: 'scan.TIF' })).toBe(true);
    expect(isTiffFile({ type: '', name: 'scan.tiff' })).toBe(true);
    expect(isTiffFile({ type: 'image/png', name: 'a.png' })).toBe(false);
  });
});

describe('isPdfFile', () => {
  it('распознаёт PDF по mime и расширению', () => {
    expect(isPdfFile({ type: 'application/pdf', name: 'a' })).toBe(true);
    expect(isPdfFile({ type: '', name: 'map.pdf' })).toBe(true);
    expect(isPdfFile({ type: '', name: 'map.PDF' })).toBe(true);
    expect(isPdfFile({ type: 'image/png', name: 'a.pdf.png' })).toBe(false);
  });
});

describe('describeLoadError', () => {
  it('маппит известные классы ошибок pdf.js на понятные тексты', () => {
    const password = Object.assign(new Error('No password given'), { name: 'PasswordException' });
    expect(describeLoadError(password)).toContain('паролем');
    const invalid = Object.assign(new Error('Invalid PDF structure'), { name: 'InvalidPDFException' });
    expect(describeLoadError(invalid)).toContain('повреждён');
    const missing = Object.assign(new Error('Missing PDF'), { name: 'MissingPDFException' });
    expect(describeLoadError(missing)).toContain('не найден');
  });

  it('пропускает понятные сообщения без маппинга', () => {
    expect(describeLoadError(new Error('Файл примера не найден.'))).toBe('Файл примера не найден.');
  });

  it('для неизвестного типа ошибки даёт общий текст', () => {
    expect(describeLoadError('строка')).toBe('Не удалось открыть документ.');
    const empty = new Error('');
    expect(describeLoadError(empty)).toBe('Не удалось открыть документ.');
  });
});
