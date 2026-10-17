// Чистые помощники загрузки документа — без импортов pdf.js/React,
// чтобы покрывались тестами в node-окружении (см. load-utils.test.ts).

export const isTiffFile = (file: { type: string; name: string }): boolean =>
  file.type === 'image/tiff' || /\.tiff?$/i.test(file.name);

export const isPdfFile = (file: { type: string; name: string }): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

// Известные классы ошибок pdf.js → понятные русские тексты вместо «Invalid PDF structure».
const PDF_ERROR_MESSAGES: Record<string, string> = {
  PasswordException: 'PDF защищён паролем. Пересохраните документ без пароля и откройте снова.',
  InvalidPDFException: 'Файл повреждён или это не PDF. Попробуйте пересохранить документ и открыть заново.',
  MissingPDFException: 'Документ не найден или пуст.',
};

export const describeLoadError = (caught: unknown): string => {
  if (caught instanceof Error) {
    const mapped = PDF_ERROR_MESSAGES[caught.name];
    if (mapped) return mapped;
    return caught.message || 'Не удалось открыть документ.';
  }
  return 'Не удалось открыть документ.';
};
