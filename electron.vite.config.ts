import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const alias = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: true, rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
});
