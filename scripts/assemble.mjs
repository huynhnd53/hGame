// Puts the two built sites side by side for GitHub Pages:
//   dist/index.html        landing page
//   dist/vgang-online/     the game
//   dist/newmap/           the real-area builder
//   dist/tiltpad/          phone-tilt demo (plain static files, no build step)
import { cpSync, existsSync, rmSync } from 'node:fs';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
for (const app of ['vgang-online', 'newmap']) {
  const built = `${app}/dist`;
  if (!existsSync(built)) throw new Error(`${built} is missing: build ${app} first`);
  cpSync(built, `${out}/${app}`, { recursive: true });
}
cpSync('tiltpad/public', `${out}/tiltpad`, { recursive: true });
cpSync('index.html', `${out}/index.html`);
console.log(`Assembled ${out}/ (index.html, vgang-online/, newmap/, tiltpad/)`);
