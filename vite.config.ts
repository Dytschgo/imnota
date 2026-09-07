import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fontRoot = fileURLToPath(
  new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url),
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-drawing-fonts',
      configureServer(server) {
        server.middlewares.use('/excalidraw/fonts', async (req, res, next) => {
          try {
            const target = path.resolve(fontRoot, `.${decodeURIComponent((req.url ?? '').split('?')[0])}`);
            const relative = path.relative(fontRoot, target);
            if (relative.startsWith('..') || path.isAbsolute(relative) || !target.endsWith('.woff2'))
              return next();
            const bytes = await fs.readFile(target);
            res.setHeader('Content-Type', 'font/woff2');
            res.end(bytes);
          } catch {
            next();
          }
        });
      },
      async generateBundle() {
        const emitFonts = async (folder: string): Promise<void> => {
          for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
            const target = path.join(folder, entry.name);
            if (entry.isDirectory()) await emitFonts(target);
            else if (entry.name.endsWith('.woff2'))
              this.emitFile({
                type: 'asset',
                fileName: `excalidraw/fonts/${path.relative(fontRoot, target).replaceAll('\\', '/')}`,
                source: await fs.readFile(target),
              });
          }
        };
        await emitFonts(fontRoot);
      },
    },
  ],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Keep the screenshot engine cacheable independently of the application shell.
        // The larger drawing engine stays behind Workspace's existing lazy import.
        manualChunks(id) {
          const modulePath = id.replaceAll('\\', '/');
          if (/\/node_modules\/(?:konva|react-konva)\//.test(modulePath)) return 'annotation-engine';
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(modulePath)) return 'react-runtime';
        },
      },
    },
  },
  server: { strictPort: true },
});
