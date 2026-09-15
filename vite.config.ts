import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        vm: resolve(__dirname, 'vm.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
