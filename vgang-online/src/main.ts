import { Game } from './game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;

// Let the loading screen paint before the (synchronous) texture and geometry generation starts.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    try {
      const game = new Game(canvas);
      game.start();
      document.getElementById('loading')?.remove();
      if (import.meta.env.DEV) (window as unknown as { __vgang: Game }).__vgang = game;
    } catch (err) {
      console.error(err);
      document.body.innerHTML =
        '<p style="color:#fff;background:#1f2a30;font-family:system-ui;padding:24px;margin:0;height:100%">Không khởi động được game. Trình duyệt cần hỗ trợ WebGL.</p>';
    }
  }),
);
