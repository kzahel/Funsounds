import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/Funsounds/',
  root: '.',
  publicDir: 'public',
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'qbert-harness': resolve(__dirname, 'qbert-harness.html'),
      },
    },
  },
});
