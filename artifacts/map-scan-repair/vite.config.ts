import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

export default defineConfig(async ({ command }) => {
  // PORT нужен только для dev-сервера и preview; для `vite build` достаточно BASE_PATH.
  const rawPort = process.env.PORT;

  if (command === 'serve' && !rawPort) {
    throw new Error(
      'PORT environment variable is required but was not provided.',
    );
  }

  const port = Number(rawPort ?? 0);

  if (command === 'serve' && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? '/';
  // По умолчанию 0.0.0.0 — так требует хостинг Replit; локальному запуску (start.bat)
  // достаточно 127.0.0.1, чтобы редактор не был виден из локальной сети.
  const host = process.env.HOST ?? '0.0.0.0';

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== 'production' &&
      process.env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host,
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host,
      allowedHosts: true,
    },
  };
});
