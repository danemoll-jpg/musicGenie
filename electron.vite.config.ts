import { alphaTab } from '@coderline/alphatab-vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: { outDir: 'out/main', rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), mlWorker: resolve(__dirname, 'src/main/mlWorker.ts') } } },
  },
  preload: {
    build: { outDir: 'out/preload', rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    plugins: [react(), ...alphaTab()],
    build: { outDir: resolve(__dirname, 'out/renderer'), rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
