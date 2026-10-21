import { defineConfig } from 'vitest/config';

// Relative base so the build works both at https://<user>.github.io/vgang-online/
// and on a custom domain or another static host without changes.
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 800,
    // The game, plus the real-map builder at /newmap/ (paths relative to the project root).
    rolldownOptions: {
      input: { main: 'index.html', newmap: 'newmap/index.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
