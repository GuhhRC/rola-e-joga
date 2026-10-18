'use strict';
/* Rola e Joga! — Roda (canvas), slot de capas e tela de giro
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   A RODA (canvas) — até 20 itens
   ========================================================================== */
const ACC = () => (document.body.classList.contains('adult') ? '#ff3b4e' : '#2eea7a');
const ACC_GLOW = () => (document.body.classList.contains('adult') ? 'rgba(255,59,78,.55)' : 'rgba(46,234,122,.55)');
const POINTER_SVG =
  '<svg viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg"><path d="M2 3h18L11 24z" style="fill:var(--green)" stroke="#0a0a0a" stroke-width="2" stroke-linejoin="round"/></svg>';

function drawWheel(cv, labels, rot, hi) {
  const size = cv.clientWidth;
  if (!size) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(size * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, size, size);

  const c = size / 2;
  const R = c - 10;
  const n = labels.length;
  const step = TAU / n;
  const fs = n <= 10 ? 13 : n <= 14 ? 11.5 : 10.5;
  const maxChars = Math.max(6, Math.floor((R * 0.62) / (fs * 0.6)));
  const cut = (s) => (s.length > maxChars ? s.slice(0, maxChars - 1).trimEnd() + '…' : s);

  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step - step / 2 - Math.PI / 2;
    x.beginPath();
    x.moveTo(c, c);
    x.arc(c, c, R, a0, a0 + step);
    x.closePath();
    x.fillStyle = i === hi ? ACC() : i % 2 ? '#111713' : '#0b0f0d';
    x.fill();
    x.lineWidth = 1;
    x.strokeStyle = '#1d2a23';
    x.stroke();

    x.save();
    x.translate(c, c);
    x.rotate(rot + i * step - Math.PI / 2);
    x.textAlign = 'right';
    x.textBaseline = 'middle';
    x.fillStyle = i === hi ? '#0a0a0a' : '#cfe9d9';
    x.font = `700 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
    x.fillText(cut(labels[i]), R - 14, 0);
    x.restore();
  }

  // anel neon
  x.beginPath();
  x.arc(c, c, R, 0, TAU);
  x.lineWidth = 2;
  x.strokeStyle = ACC();
  x.shadowColor = ACC_GLOW();
  x.shadowBlur = 14;
  x.stroke();
  x.shadowBlur = 0;

  // miolo
  x.beginPath();
  x.arc(c, c, size * 0.085, 0, TAU);
  x.fillStyle = '#0a0a0a';
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = ACC();
  x.stroke();
  x.beginPath();
  x.arc(c, c, size * 0.024, 0, TAU);
  x.fillStyle = ACC();
  x.fill();
}

function createWheel(labels) {
  const n = labels.length;
  const step = TAU / n;
  let rot = 0;
  let hi = -1;
  const canvas = h('canvas');
  const pointer = h('div', { class: 'pointer', html: POINTER_SVG });
  const el = h('div', { class: 'wheel-wrap' }, canvas, pointer);
  const draw = () => drawWheel(canvas, labels, rot, hi);
  new ResizeObserver(draw).observe(canvas);
  const idxAt = (r) => ((Math.round(-r / step) % n) + n) % n;

  return {
    el,
    async spin(w) {
      hi = -1;
      const delta = (rnd() - 0.5) * 0.7; // cai em qualquer ponto da fatia, não só no meio
      const turns = 6 + Math.floor(rnd() * 3);
      const off = (w + delta) * step;
      const start = rot;
      const final = Math.ceil((start + turns * TAU + off) / TAU) * TAU - off;
      let last = idxAt(start);
      let lastTick = 0;
      await animate(SPIN_MS, easeOut, (e) => {
        rot = start + (final - start) * e;
        const i = idxAt(rot);
        if (i !== last) {
          last = i;
          const t = performance.now();
          if (t - lastTick > 32) { tick(); flick(pointer); lastTick = t; }
        }
        draw();
      });
      rot = final;
      hi = w;
      draw();
    },
    reset() { hi = -1; draw(); },
  };
}

/* ==========================================================================
   O SLOT DE CAPAS — acima de 20 itens
   ========================================================================== */
function createReel(pool) {
  const n = pool.length;
  const strip = h('div', { class: 'reel-strip' });
  const frame = h('div', { class: 'reel-frame' });
  const el = h('div', { class: 'reel' }, strip, frame, h('div', { class: 'reel-fade top' }), h('div', { class: 'reel-fade bot' }));
  let current = pool[Math.floor(rnd() * n)];
  // nome do jogo que está passando no centro (muda conforme o slot gira)
  const nameEl = h('div', { class: 'reel-name', 'aria-live': 'off' });
  const box = h('div', { class: 'reel-box' }, el, nameEl);
  const setName = (g) => { if (g && nameEl.textContent !== g.name) nameEl.textContent = g.name; };

  const pickNot = (g) => {
    let p;
    do { p = pool[Math.floor(rnd() * n)]; } while (p === g && n > 1);
    return p;
  };
  const setPos = (p) => { strip.style.transform = `translateY(${(REEL_ROW * (1 - p)).toFixed(2)}px)`; };
  const build = (seq) => strip.replaceChildren(...seq.map((g) => h('div', { class: 'reel-item' }, coverImg(g))));
  const rest = () => { nameEl.classList.remove('win'); build([pickNot(current), current, pickNot(current)]); setPos(1); setName(current); };
  rest();

  return {
    el: box,
    async spin(w) {
      frame.classList.remove('win');
      nameEl.classList.remove('win');
      const winner = pool[w];
      const win = 40 + Math.floor(rnd() * 6);
      const seq = [pickNot(current), current];
      while (seq.length < win) seq.push(pickNot(seq[seq.length - 1]));
      if (seq[win - 1] === winner) seq[win - 1] = pickNot(winner);
      seq.push(winner, pickNot(winner));
      build(seq);
      setPos(1);
      let last = 1;
      let lastTick = 0;
      await animate(SPIN_MS, easeOut, (e) => {
        const p = 1 + (win - 1) * e;
        setPos(p);
        const i = Math.round(p);
        if (i !== last) {
          last = i;
          setName(seq[i]);
          const t = performance.now();
          if (t - lastTick > 32) { tick(); lastTick = t; }
        }
      });
      setPos(win);
      current = winner;
      setName(winner);
      nameEl.classList.add('win');
      frame.classList.add('win');
    },
    reset() { frame.classList.remove('win'); rest(); },
  };
}

/* ==========================================================================
   Tela de giro (usada pela roleta de jogos e pela roleta de gêneros)
   ========================================================================== */
function spinScreen({ head, n, engine, isReel, ctaText, renderResult }) {
  const machine = h('div', { class: 'machine' + (isReel ? ' is-reel' : '') }, engine.el);
  const result = h('div', { class: 'result' });
  const cta = h('button', { class: 'btn primary big spin-cta', onclick: () => spin() }, ctaText);
  const sec = h('section', { class: 'spin' }, head, machine, cta, result);

  async function spin() {
    if (state.busy || sec.classList.contains('done')) return;
    unlockAudio();
    state.busy = true;
    updateAds();
    cta.disabled = true;
    const sid = state.screenId;
    const idx = Math.floor(rnd() * n);
    await engine.spin(idx);
    if (sid !== state.screenId) return; // saiu da tela no meio do giro
    machine.classList.add('settle');
    winSound();
    await sleep(750);
    machine.classList.remove('settle');
    if (sid !== state.screenId) return;
    result.replaceChildren(...renderResult(idx, again));
    sec.classList.add('done');
    state.busy = false;
    state.resultShown = true;
    updateAds();
  }

  function again() {
    sec.classList.remove('done');
    result.replaceChildren();
    cta.disabled = false;
    engine.reset();
    state.resultShown = false;
    updateAds();
    view.scrollTop = 0;
  }

  machine.addEventListener('click', () => spin());
  state.curSec = sec;
  state.curSpin = spin;
  return sec;
}
