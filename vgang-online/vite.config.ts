import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Riding with a phone loads `tiltpad/link.js` and `tiltpad/pad.html` from the sibling folder, as on GitHub Pages
 * (`../tiltpad/`). The dev server serves that folder at `/tiltpad/` so the same relative path works locally.
 */
function serveTiltpad(): Plugin {
  const root = fileURLToPath(new URL('../tiltpad/public/', import.meta.url));
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  return {
    name: 'serve-tiltpad',
    configureServer(server) {
      server.middlewares.use('/tiltpad', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = normalize(join(root, rel.endsWith('/') ? `${rel}index.html` : rel));
        if (!file.startsWith(root.replace(/[\\/]$/, '') + sep) || !existsSync(file) || statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Relative base so the build works wherever it is hosted (https://<user>.github.io/hGame/vgang-online/,
// a custom domain or another static host) without changes.
export default defineConfig({
  base: './',
  plugins: [serveTiltpad()],
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
