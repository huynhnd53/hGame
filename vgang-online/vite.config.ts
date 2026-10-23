import { defineConfig } from 'vitest/config';

// Relative base so the build works wherever it is hosted (https://<user>.github.io/hGame/vgang-online/,
// a custom domain or another static host) without changes.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
