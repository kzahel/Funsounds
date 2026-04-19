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
      // Use the prebuilt artifact from third_party/physx-webidl/ instead of
      // the stock npm package — our fork adds PxScene_writeActiveTransforms
      // for batch pose readback. See scripts/rebuild-physx-webidl.sh to
      // regenerate the artifact from the kzahel/physx-js-webidl fork.
      'physx-js-webidl': resolve(__dirname, 'third_party/physx-webidl/physx-js-webidl.mjs'),
    },
  },
  server: {
    fs: {
      allow: [resolve(__dirname), resolve(__dirname, 'third_party')],
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
        'model-viewer': resolve(__dirname, 'model-viewer.html'),
        // Add 'physics-bench' back once physics-bench.html is committed.
        // Rollup input paths must exist at build time or CI fails.
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
