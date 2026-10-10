// Конфетти на canvas. Возвращает функцию остановки.

const COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#facc15', '#ef4444'];

export function celebrate({ reduced = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');

  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const parts = [];
  const make = (x, y, vx, vy) => parts.push({
    x, y, vx, vy,
    w: rand(6, 11), h: rand(9, 16),
    rot: rand(0, Math.PI * 2), vr: rand(-0.22, 0.22),
    tilt: rand(0, Math.PI * 2), vt: rand(0.06, 0.16),
    color: COLORS[(Math.random() * COLORS.length) | 0],
    round: Math.random() < 0.28,
  });

  const gravity = reduced ? 0.03 : 0.32;
  const maxFall = reduced ? 2 : 5.5;
  const total = reduced ? 3200 : 5200;

  function burst(x, y, n, angle) {
    const speed = Math.sqrt(2 * gravity * H * 0.8) * 1.25;
    for (let i = 0; i < n; i++) {
      const a = angle + rand(-0.38, 0.38);
      const v = speed * rand(0.5, 1);
      make(x, y, Math.cos(a) * v, Math.sin(a) * v);
    }
  }
  function rain(n, slow) {
    for (let i = 0; i < n; i++) {
      make(rand(0, W), rand(-H * 0.6, -10), rand(-1, 1), slow ? rand(0.6, 1.6) : rand(1, 3));
    }
  }

  if (reduced) {
    rain(40, true);
  } else {
    const n = W < 600 ? 80 : 120;
    burst(0, H + 10, n, -Math.PI / 3);
    burst(W, H + 10, n, -2 * Math.PI / 3);
  }

  const start = performance.now();
  let last = start;
  let rained = reduced;
  let raf = 0;
  let stopped = false;

  function frame(now) {
    const dt = Math.min(2.5, (now - last) / 16.67);
    last = now;
    const elapsed = now - start;
    if (!rained && elapsed > 550) { rain(W < 600 ? 70 : 110, false); rained = true; }

    g.clearRect(0, 0, W, H);
    const alpha = elapsed > total - 900 ? Math.max(0, (total - elapsed) / 900) : 1;
    g.globalAlpha = alpha;
    const drag = Math.pow(0.985, dt);
    for (const p of parts) {
      p.vx *= drag;
      p.vy = Math.min(p.vy * drag + gravity * dt, maxFall);
      p.x += p.vx * dt + Math.sin(p.tilt) * 0.6;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      if (p.y > H + 40 || p.x < -40 || p.x > W + 40) continue;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      if (p.round) {
        g.beginPath();
        g.arc(0, 0, p.w * 0.42, 0, Math.PI * 2);
        g.fill();
      } else {
        g.scale(1, Math.cos(p.tilt));
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      g.restore();
    }
    if (elapsed < total) raf = requestAnimationFrame(frame);
    else stop();
  }
  raf = requestAnimationFrame(frame);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  }
  return stop;
}
