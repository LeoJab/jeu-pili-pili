/* fx.js — effets spéciaux (particules canvas, secousses, bannières) et sons synthétisés. */
const Fx = (() => {
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const COLORS = ['#ffd426', '#ff3b30', '#ff8a1f', '#29d17d', '#4ac8ff', '#ff4fd8', '#ffffff'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let cv, cx, W = 0, H = 0, P = [], E = [], running = false;

  function init(canvas) {
    cv = canvas; cx = cv.getContext('2d');
    resize(); addEventListener('resize', resize);
    if (!reduce) for (let i = 0; i < 22; i++) E.push(ember(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
    start();
  }
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ember = init0 => ({ x: rand(0, W), y: init0 ? rand(0, H) : H + 10, vx: rand(-0.2, 0.2), vy: -rand(0.3, 1.1), r: rand(1, 3.2), a: rand(0.15, 0.5), ph: rand(0, 6.28) });

  function start() {
    if (running || document.hidden) return;
    running = true; requestAnimationFrame(frame);
  }
  function add(p) { if (P.length < 900) P.push(p); start(); }

  function frame() {
    if (document.hidden) { running = false; return; }
    cx.clearRect(0, 0, W, H);
    cx.globalCompositeOperation = 'lighter';
    for (const e of E) {
      e.ph += 0.03; e.x += e.vx + Math.sin(e.ph) * 0.3; e.y += e.vy;
      if (e.y < -10) Object.assign(e, ember(false));
      cx.globalAlpha = e.a; cx.fillStyle = '#ff9a3c';
      cx.beginPath(); cx.arc(e.x, e.y, e.r, 0, 6.283); cx.fill();
    }
    for (const p of P) {
      p.life--; p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      const k = Math.max(0, p.life / p.max);
      if (p.kind === 'confetti') {
        cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = Math.min(1, k * 3);
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.scale(1, Math.abs(Math.sin(p.rot * 2)) + 0.2);
        cx.fillStyle = p.color; cx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); cx.restore();
        cx.globalCompositeOperation = 'lighter';
      } else if (p.kind === 'emoji') {
        cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = Math.min(1, k * 2);
        cx.font = p.size + 'px serif'; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot);
        cx.fillText(p.emoji, -p.size / 2, p.size / 3); cx.restore();
        cx.globalCompositeOperation = 'lighter';
      } else {
        cx.globalAlpha = k; cx.fillStyle = p.color;
        cx.beginPath(); cx.arc(p.x, p.y, Math.max(0.5, p.size * (p.shrink ? k : 1)), 0, 6.283); cx.fill();
      }
    }
    cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
    P = P.filter(p => p.life > 0);
    if (!P.length && !E.length) { running = false; return; }
    requestAnimationFrame(frame);
  }

  const mk = o => Object.assign({ vx: 0, vy: 0, g: 0, drag: 1, life: 60, size: 3, color: '#fff', rot: 0, vr: 0, kind: 'dot', shrink: false }, o, { max: o.life || 60 });

  /* kind : spark | fire | confetti | chili | rainbow */
  function burst(x, y, kind = 'spark', n = 24) {
    if (reduce) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.283), s = rand(2, 8);
      if (kind === 'fire') add(mk({ x: x + rand(-14, 14), y, vx: rand(-1.2, 1.2), vy: -rand(1.5, 5), g: -0.03, drag: 0.98, life: rand(30, 60), size: rand(5, 13), color: pick(['#ff3b30', '#ff8a1f', '#ffd426']), shrink: true }));
      else if (kind === 'confetti') add(mk({ kind: 'confetti', x, y, vx: Math.cos(a) * s * 0.9, vy: Math.sin(a) * s - 5, g: 0.22, drag: 0.97, life: rand(70, 130), size: rand(3, 6), color: pick(COLORS), rot: rand(0, 6), vr: rand(-0.3, 0.3) }));
      else if (kind === 'chili') add(mk({ kind: 'emoji', emoji: '🌶️', x, y, vx: Math.cos(a) * s * 0.7, vy: Math.sin(a) * s - 4, g: 0.2, drag: 0.98, life: rand(50, 90), size: rand(16, 30), rot: rand(-1, 1), vr: rand(-0.15, 0.15) }));
      else if (kind === 'rainbow') add(mk({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.05, drag: 0.96, life: rand(30, 60), size: rand(2, 5), color: `hsl(${Math.floor(rand(0, 360))} 100% 60%)`, shrink: true }));
      else add(mk({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.12, drag: 0.95, life: rand(25, 55), size: rand(1.5, 4), color: pick(['#ffd426', '#ff8a1f', '#fff']), shrink: true }));
    }
  }
  // Petite pluie d'emojis (limitée pour éviter les ralentissements)
  function emojiRain(emoji, n = 14) {
    if (reduce) n = Math.ceil(n / 3);
    const room = 70 - P.filter(p => p.kind === 'emoji').length;
    n = Math.min(n, room);
    for (let i = 0; i < n; i++) add(mk({ kind: 'emoji', emoji, x: rand(10, W - 10), y: -rand(20, 380), vx: rand(-0.4, 0.4), vy: rand(2.2, 4), g: 0.02, life: 300, size: rand(22, 34), rot: rand(-0.4, 0.4), vr: rand(-0.04, 0.04) }));
  }
  function rain(n = 120, ms = 2200) {
    const t0 = performance.now();
    const id = setInterval(() => {
      if (performance.now() - t0 > ms) return clearInterval(id);
      for (let i = 0; i < Math.ceil(n / 20); i++) add(mk({ kind: 'confetti', x: rand(0, W), y: -10, vx: rand(-1, 1), vy: rand(1, 4), g: 0.06, drag: 0.995, life: 220, size: rand(3, 6), color: pick(COLORS), rot: rand(0, 6), vr: rand(-0.2, 0.2) }));
    }, 100);
  }
  function fireworks(ms = 5000) {
    const t0 = performance.now();
    const id = setInterval(() => {
      if (performance.now() - t0 > ms) return clearInterval(id);
      const x = rand(W * 0.12, W * 0.88), y = rand(H * 0.12, H * 0.5), hue = Math.floor(rand(0, 360));
      for (let i = 0; i < 70; i++) {
        const a = rand(0, 6.283), s = rand(1, 7);
        add(mk({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.07, drag: 0.955, life: rand(45, 85), size: rand(1.5, 3.2), color: `hsl(${hue + rand(-25, 25)} 100% ${rand(55, 75)}%)`, shrink: true }));
      }
      Sfx.play('pop');
    }, 380);
  }

  /* ---- Effets DOM ---- */
  function banner(html, cls = '', ms = 1700) {
    const d = document.createElement('div');
    d.className = 'banner ' + cls; d.innerHTML = html;
    document.getElementById('overlay').appendChild(d);
    setTimeout(() => d.remove(), ms);
  }
  function floatText(x, y, text, cls = '') {
    const d = document.createElement('div');
    d.className = 'floaty ' + cls; d.textContent = text;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    document.getElementById('overlay').appendChild(d);
    setTimeout(() => d.remove(), 1500);
  }
  function shake(power = 1) {
    if (reduce) return;
    const app = document.getElementById('app');
    app.style.setProperty('--sh', (6 * power) + 'px');
    app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 600);
  }
  function flash(color = '#ff3b30') {
    const d = document.createElement('div');
    d.className = 'flash'; d.style.setProperty('--c', color);
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 600);
  }
  function pop(elm, cls = 'pop') {
    if (!elm) return;
    elm.classList.remove(cls); void elm.offsetWidth; elm.classList.add(cls);
  }

  return { init, burst, rain, emojiRain, fireworks, banner, floatText, shake, flash, pop, get W() { return W; }, get H() { return H; } };
})();

/* ---- Sons synthétisés (WebAudio, aucun fichier) ---- */
const Sfx = (() => {
  let ac = null, muted = false;
  try { muted = localStorage.getItem('pp_mute') === '1'; } catch (e) { /* ignore */ }

  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(a, f, t0, d, type = 'sine', vol = 0.16, f2) {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.05);
  }
  function noise(a, t0, d, vol = 0.12, freq = 1200) {
    const len = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, len, a.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + t0;
    s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(a.destination); s.start(t);
  }
  const lib = {
    tick: a => tone(a, 880, 0, 0.05, 'square', 0.05),
    card: a => { noise(a, 0, 0.07, 0.14, 2500); tone(a, 260, 0, 0.09, 'triangle', 0.14, 140); },
    deal: a => { for (let i = 0; i < 4; i++) noise(a, i * 0.07, 0.05, 0.1, 3000); },
    bet: a => { tone(a, 520, 0, 0.08, 'square', 0.07); tone(a, 780, 0.07, 0.1, 'square', 0.07); },
    mission: a => { noise(a, 0, 0.5, 0.1, 900); tone(a, 220, 0, 0.5, 'sawtooth', 0.07, 660); tone(a, 660, 0.45, 0.2, 'triangle', 0.12); },
    win: a => [523, 659, 784, 1047].forEach((f, i) => tone(a, f, i * 0.08, 0.2, 'triangle', 0.15)),
    trick: a => { tone(a, 440, 0, 0.1, 'triangle', 0.12); tone(a, 660, 0.08, 0.14, 'triangle', 0.12); },
    lose: a => { tone(a, 300, 0, 0.5, 'sawtooth', 0.12, 80); noise(a, 0, 0.5, 0.1, 600); },
    fire: a => { noise(a, 0, 0.8, 0.16, 700); tone(a, 140, 0, 0.6, 'sawtooth', 0.06, 60); },
    joker: a => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(a, f, i * 0.06, 0.25, 'sine', 0.12)),
    pop: a => { noise(a, 0, 0.18, 0.12, 4000); tone(a, 900, 0, 0.12, 'sine', 0.08, 300); },
    swap: a => { tone(a, 400, 0, 0.15, 'triangle', 0.12, 800); tone(a, 800, 0.12, 0.15, 'triangle', 0.12, 400); },
    fanfare: a => { [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(a, f, i * 0.14, 0.25, 'square', 0.09)); },
  };
  return {
    play(name) {
      if (muted) return;
      const a = ctx(); if (!a) return;
      try { lib[name] && lib[name](a); } catch (e) { /* ignore */ }
    },
    unlock() { ctx(); },
    toggle() { muted = !muted; try { localStorage.setItem('pp_mute', muted ? '1' : '0'); } catch (e) { /* ignore */ } return muted; },
    get muted() { return muted; },
  };
})();
