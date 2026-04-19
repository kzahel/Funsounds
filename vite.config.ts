import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/Funsounds/',
  root: '.',
  publicDir: 'public',
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      // Bench and demo pull from the vendored build so the patched wasm is picked up.
      'physx-js-webidl': resolve(__dirname, 'vendor/physx-js-webidl/dist/physx-js-webidl.mjs'),
    },
  },
  server: {
    fs: {
      allow: [resolve(__dirname), resolve(__dirname, 'vendor')],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'qbert-harness': resolve(__dirname, 'qbert-harness.html'),
        '3d-demo': resolve(__dirname, '3d-demo.html'),
        'physics-demo': resolve(__dirname, 'physics-demo.html'),
        'physics-bench': resolve(__dirname, 'physics-bench.html'),
      },
    },
  },
  // The physx-js-webidl wasm is loaded via `new URL(...)` with import.meta.url,
  // which Vite only honors when it keeps the module pre-bundled out of the
  // `optimizeDeps` transform. See https://vitejs.dev/guide/features.html#web-assembly
  optimizeDeps: {
    exclude: ['physx-js-webidl'],
  },
  assetsInclude: ['**/*.wasm'],
});
