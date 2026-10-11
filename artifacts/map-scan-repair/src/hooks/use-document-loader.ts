import { useCallback, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

const MAX_PDF_EDGE = 6000;
const MAX_PDF_PIXELS = 36_000_000;
const MAX_PDF_SCALE = 8;
const MIN_PDF_SCALE = 0.05;

/**
 * Загрузка документов: PDF через pdf.js, файлы пользователя и автопример.
 * Состояния loading/error/notice остаются у владельца — хук управляет логикой и токенами загрузок.
 */
export function useDocumentLoader(
  loadImage: (image: HTMLImageElement, name: string) => void,
  notice: string,
  setNotice: (message: string) => void,
  setLoading: (value: boolean) => void,
  setError: (message: string) => void,
) {
  const loadTokenRef = useRef(0);
  const userFileLoadedRef = useRef(false);

  const loadPdf = useCallback(async (data: ArrayBuffer, name: string) => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
    try {
      const page = await pdf.getPage(1);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          MAX_PDF_EDGE / base.width,
          MAX_PDF_EDGE / base.height,
          Math.sqrt(MAX_PDF_PIXELS / (base.width * base.height)),
          MAX_PDF_SCALE,
        );
        // Нижняя граница 0.05: раньше Math.max(1, scale) отменял ограничения для крупных страниц,
        // и canvas превышал лимиты браузера; теперь рендер всегда укладывается в лимит.
        const renderScale = Math.max(MIN_PDF_SCALE, scale);
        const viewport = page.getViewport({ scale: renderScale });
        const pageCanvas = window.document.createElement('canvas');
        pageCanvas.width = Math.ceil(viewport.width);
        pageCanvas.height = Math.ceil(viewport.height);
        const context = pageCanvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Браузер не смог подготовить поверхность для PDF.');
        await page.render({ canvasContext: context, viewport }).promise;
        page.cleanup();
        const blob = await new Promise<Blob>((resolve, reject) => {
          pageCanvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error('Не удалось подготовить страницу PDF.'));
          }, 'image/png');
        });
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        try {
          image.src = objectUrl;
          await image.decode();
          await loadImage(image, name);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        const messages: string[] = [];
        if (renderScale < 1) {
          messages.push(`Страница PDF отрисована с уменьшением до ${Math.round(renderScale * 100)} %, чтобы уложиться в лимит холста браузера.`);
        }
        if (pdf.numPages > 1) {
          messages.push(`Открыта первая страница из ${pdf.numPages}. Остальные страницы PDF пока не загружены.`);
        }
        if (messages.length) setNotice(messages.join(' '));
      } finally {
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
  }, [loadImage, setNotice]);

  const loadUrl = useCallback(async (url: string, name: string) => {
    const token = ++loadTokenRef.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Файл примера не найден.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const image = new Image();
      try {
        image.src = objectUrl;
        await image.decode();
        if (token !== loadTokenRef.current) return; // устаревшая загрузка: пользователь уже открыл свой файл
        await loadImage(image, name);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (caught) {
      if (token !== loadTokenRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Не удалось открыть документ.');
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [loadImage, setError, setLoading]);

  const processFile = useCallback(async (file: File) => {
    const token = ++loadTokenRef.current;
    userFileLoadedRef.current = true;
    // Браузеры не декодируют TIFF, хотя accept="image/*" его пропускает: объясняем это сразу, а не через «не удалось открыть».
    if (file.type === 'image/tiff' || /\.tiff?$/i.test(file.name)) {
      setError('Формат TIFF не поддерживается браузером — сохраните скан как PNG, JPEG или PDF.');
      return;
    }
    setLoading(true); setError(''); setNotice('');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        await loadPdf(await file.arrayBuffer(), file.name);
        if (token === loadTokenRef.current) setLoading(false);
      }
      else {
        const url = URL.createObjectURL(file);
        const image = new Image();
        const finish = () => { URL.revokeObjectURL(url); if (token === loadTokenRef.current) setLoading(false); };
        image.onload = () => {
          if (token !== loadTokenRef.current) { URL.revokeObjectURL(url); return; }
          try { loadImage(image, file.name); }
          catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось открыть изображение. Проверьте формат файла.'); }
          finish();
        };
        image.onerror = () => {
          if (token !== loadTokenRef.current) { URL.revokeObjectURL(url); return; }
          setError('Не удалось открыть изображение. Проверьте формат файла.');
          finish();
        };
        image.src = url;
      }
    } catch (caught) {
      if (token !== loadTokenRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файл.');
      setLoading(false);
    }
  }, [loadImage, loadPdf, setError, setLoading, setNotice]);

  useEffect(() => {
    if (userFileLoadedRef.current) return;
    void loadUrl(`${import.meta.env.BASE_URL}example-map.jpg`, 'example-map.jpg');
  }, [loadUrl]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  return { loadPdf, loadUrl, processFile, userFileLoadedRef };
}
