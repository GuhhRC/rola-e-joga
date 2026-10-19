'use strict';
/* Rola e Joga! — Dado d20 (canvas 2D com 3D calculado à mão, sem biblioteca) + som de dado gerado no navegador.
   Mesma interface da roda e do slot: createDie(pool) → { el, spin(w), reset() }. Precisa de exatamente 20 jogos. */

const PHI = (1 + Math.sqrt(5)) / 2;
const D20_VERTS = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
  [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); }); // raio 1
const D20_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/* ---------- álgebra mínima ---------- */
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); },
};
const mmul = (A, B) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const mvec = (M, p) => [v3.dot(M[0], p), v3.dot(M[1], p), v3.dot(M[2], p)];
const mT = (M) => [0, 1, 2].map((i) => [M[0][i], M[1][i], M[2][i]]);
function rotAxis(ax, ang) { // Rodrigues
  const [x, y, z] = v3.norm(ax);
  const c = Math.cos(ang); const s = Math.sin(ang); const t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
function matToAxisAngle(R) { // quaternion → eixo/ângulo (caminho mais curto)
  const tr = R[0][0] + R[1][1] + R[2][2];
  let w; let x; let y; let z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (R[2][1] - R[1][2]) / s; y = (R[0][2] - R[2][0]) / s; z = (R[1][0] - R[0][1]) / s; }
  else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) { const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2; w = (R[2][1] - R[1][2]) / s; x = s / 4; y = (R[0][1] + R[1][0]) / s; z = (R[0][2] + R[2][0]) / s; }
  else if (R[1][1] > R[2][2]) { const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2; w = (R[0][2] - R[2][0]) / s; x = (R[0][1] + R[1][0]) / s; y = s / 4; z = (R[1][2] + R[2][1]) / s; }
  else { const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2; w = (R[1][0] - R[0][1]) / s; x = (R[0][2] + R[2][0]) / s; y = (R[1][2] + R[2][1]) / s; z = s / 4; }
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const ang = 2 * Math.acos(Math.min(1, w));
  const sn = Math.sqrt(1 - w * w);
  return sn < 1e-6 ? { axis: [0, 1, 0], ang: 0 } : { axis: [x / sn, y / sn, z / sn], ang };
}

/* ---------- geometria das faces ---------- */
const D20 = (() => {
  const faces = D20_FACES.map((f) => {
    let [a, b, c] = f.map((i) => D20_VERTS[i]);
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    let n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a)));
    if (v3.dot(n, cen) < 0) { [b, c] = [c, b]; n = n.map((x) => -x); } // garante normal para fora
    const up = v3.norm(v3.sub(a, cen)); // vértice 0 = ponta de cima do triângulo
    return { v: [a, b, c], n, cen: v3.norm(cen), up };
  });
  // numeração de d20 de verdade: faces opostas somam 21
  const num = new Array(20).fill(0);
  let k = 1;
  faces.forEach((f, i) => {
    if (num[i]) return;
    const opp = faces.findIndex((g, j) => j !== i && v3.dot(g.n, f.n) < -0.99);
    num[i] = k; num[opp] = 21 - k; k++;
  });
  return { faces, num };
})();

// orientação final: a face i fica de frente, com a ponta para cima
function faceUpright(i) {
  const f = D20.faces[i];
  const fy = f.up; const fz = f.n; const fx = v3.cross(fy, fz);
  return [fx, fy, fz];
}

/* ---------- som de dado (sintetizado) ---------- */
let noiseBuf;
function noiseBuffer() {
  if (!noiseBuf) {
    const len = Math.floor(actx.sampleRate * 0.2);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function clack(vol = 0.12) { // estalo seco de plástico/resina
  if (state.mute || !actx) return;
  try {
    const t = actx.currentTime;
    const src = actx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = actx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400 + rnd() * 2600; f.Q.value = 1.8 + rnd();
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045 + rnd() * 0.03);
    src.connect(f).connect(g).connect(actx.destination);
    src.start(t); src.stop(t + 0.1);
  } catch { /* sem áudio */ }
}
function thump(vol = 0.25) { // batida na mesa: estalo + corpo grave
  if (state.mute || !actx) return;
  clack(Math.min(0.3, vol * 0.9));
  try {
    const t = actx.currentTime;
    const o = actx.createOscillator(); const g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + 0.18);
  } catch { /* sem áudio */ }
}

/* ---------- o dado ---------- */
const RGB = () => (document.body.classList.contains('adult') ? [255, 59, 78] : [46, 234, 122]);
const HOPS = [[0.0, 0.17, 1], [0.17, 0.12, 0.55], [0.29, 0.085, 0.3], [0.375, 0.06, 0.15], [0.435, 0.04, 0.07]]; // [início, duração, altura relativa] em tempo real (0..1)
const DIE_MS = 5600;
const L_SIDE = 220; // lado do triângulo no espaço do texto
const L_H = L_SIDE * Math.sqrt(3) / 2;
const L_PTS = [[0, -2 * L_H / 3], [-L_SIDE / 2, L_H / 3], [L_SIDE / 2, L_H / 3]]; // topo, esquerda-baixo, direita-baixo

function wrapName(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  let out = lines.slice(0, maxLines);
  if (lines.length > maxLines) out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  out = out.map((l) => { let s = l; while (s.length > 2 && ctx.measureText(s).width > maxW) s = s.slice(0, -2) + '…'; return s; });
  return out;
}

function createDie(pool) {
  if (pool.length !== 20) throw new Error('d20 precisa de 20 jogos');
  const names = D20.faces.map((_, i) => pool[D20.num[i] - 1].name); // face i mostra o jogo (número - 1)
  const faceOfPool = (w) => D20.num.indexOf(w + 1);

  const canvas = h('canvas', { class: 'die-canvas' });
  const wrap = h('div', { class: 'die-wrap' }, canvas);
  const nameEl = h('div', { class: 'reel-name' });
  const box = h('div', { class: 'reel-box die-box' }, wrap, nameEl);

  let R = mmul(rotAxis([1, 0, 0], -0.55), rotAxis([0, 1, 0], 0.7)); // orientação em repouso
  let hop = 0; // altura do pulo (0..1)
  let win = -1;
  let front = -1;

  const rotated = () => D20.faces.map((f) => ({ n: mvec(R, f.n), c: mvec(R, f.cen), v: f.v.map((p) => mvec(R, p)) }));
  const frontOf = () => { let b = 0; let bz = -9; rotated().forEach((f, i) => { if (f.n[2] > bz) { bz = f.n[2]; b = i; } }); return b; };
  const setFront = (i) => { if (i !== front) { front = i; nameEl.textContent = names[i]; } };

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(10, Math.round(rect.width));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    const x = canvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, size, size);
    const [r, g, b] = RGB();
    const rad = size * 0.33;
    const cx = size / 2;
    const groundY = size * 0.83;
    const cy = size * 0.47 - hop * size * 0.16;
    const D = 5.2;

    // brilho de fundo e sombra no chão
    const glow = x.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad * 1.9);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.16)`); glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = glow; x.fillRect(0, 0, size, size);
    const sh = 1 - hop * 0.55;
    x.fillStyle = `rgba(0,0,0,${0.5 * sh})`;
    x.beginPath(); x.ellipse(cx, groundY, rad * 0.95 * sh, rad * 0.17 * sh, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = `rgba(${r},${g},${b},${0.25 * sh})`; x.lineWidth = 1;
    x.beginPath(); x.ellipse(cx, groundY, rad * 1.05, rad * 0.2, 0, 0, Math.PI * 2); x.stroke();

    const proj = (p) => { const s = D / (D - p[2]); return [cx + p[0] * s * rad, cy - p[1] * s * rad]; };
    const light = v3.norm([-0.4, 0.7, 0.6]);
    const rf = rotated();
    let best = 0; let bz = -9;
    rf.forEach((f, i) => {
      if (f.n[2] > bz) { bz = f.n[2]; best = i; }
      const view = v3.sub([0, 0, D], f.c);
      if (v3.dot(f.n, view) <= 0) return; // face de trás
      const P = f.v.map(proj);
      const lit = Math.max(0, v3.dot(f.n, light));
      const facing = Math.max(0, f.n[2]);
      const isWin = i === win;
      x.beginPath(); x.moveTo(P[0][0], P[0][1]); x.lineTo(P[1][0], P[1][1]); x.lineTo(P[2][0], P[2][1]); x.closePath();
      const base = 12 + lit * 20;
      x.fillStyle = isWin ? `rgba(${r},${g},${b},0.30)` : `rgb(${Math.round(base * 0.7 + r * 0.05 * lit)},${Math.round(base + g * 0.06 * lit)},${Math.round(base * 0.8 + b * 0.05 * lit)})`;
      x.fill();
      x.strokeStyle = `rgba(${r},${g},${b},${isWin ? 1 : 0.55 + 0.35 * facing})`;
      x.lineWidth = isWin ? 3 : 1.6; x.lineJoin = 'round'; x.stroke();

      // texto preso ao plano da face (transformação afim triângulo-texto → triângulo-tela)
      if (facing < 0.18) return;
      const e1 = [L_PTS[1][0] - L_PTS[0][0], L_PTS[1][1] - L_PTS[0][1]];
      const e2 = [L_PTS[2][0] - L_PTS[0][0], L_PTS[2][1] - L_PTS[0][1]];
      const q1 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
      const q2 = [P[2][0] - P[0][0], P[2][1] - P[0][1]];
      const det = e1[0] * e2[1] - e1[1] * e2[0];
      const a = (q1[0] * e2[1] - q2[0] * e1[1]) / det;
      const c = (q2[0] * e1[0] - q1[0] * e2[0]) / det;
      const bb = (q1[1] * e2[1] - q2[1] * e1[1]) / det;
      const d = (q2[1] * e1[0] - q1[1] * e2[0]) / det;
      const e = P[0][0] - (a * L_PTS[0][0] + c * L_PTS[0][1]);
      const f2 = P[0][1] - (bb * L_PTS[0][0] + d * L_PTS[0][1]);
      x.save();
      x.setTransform(dpr * a, dpr * bb, dpr * c, dpr * d, dpr * e, dpr * f2);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const alpha = Math.min(1, (facing - 0.15) * 2.2);
      x.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      x.font = `800 30px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
      x.fillText(String(D20.num[i]), 0, -L_H * 0.33);
      x.font = '700 17px Inter, system-ui, sans-serif';
      x.fillStyle = `rgba(232,239,233,${alpha})`;
      const lines = wrapName(x, names[i], L_SIDE * 0.5, 3);
      lines.forEach((ln, k) => x.fillText(ln, 0, L_H * 0.04 + (k - (lines.length - 1) / 2) * 19 + 14));
      x.restore();
    });
    setFront(best);
  }

  new ResizeObserver(draw).observe(canvas);
  setFront(frontOf());
  requestAnimationFrame(draw);

  return {
    el: box,
    async spin(w) {
      win = -1;
      nameEl.classList.remove('win');
      const target = faceUpright(faceOfPool(w));
      const Rf = [target[0], target[1], target[2]];
      const R0 = R;
      const { axis, ang } = matToAxisAngle(mmul(Rf, mT(R0)));
      const spinAxis = v3.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5 + 0.2]);
      const turns = 3 + Math.floor(rnd() * 2);
      const dir = rnd() < 0.5 ? -1 : 1;
      let lastHop = -1;
      let lastFront = front;
      let lastClack = 0;
      await animate(DIE_MS, (t) => t, (t) => {
        const e = 1 - Math.pow(1 - t, 3.2);
        R = mmul(rotAxis(spinAxis, dir * Math.PI * 2 * turns * e), mmul(rotAxis(axis, ang * e), R0));
        // pulos: altura em tempo real, estalo a cada batida
        hop = 0;
        HOPS.forEach(([s0, dur, amp], k) => {
          if (t >= s0 && t < s0 + dur) hop = amp * Math.sin(Math.PI * (t - s0) / dur);
          if (t >= s0 + dur && lastHop < k) { lastHop = k; thump(0.08 + amp * 0.22); }
        });
        draw();
        const fr = front;
        const now = performance.now();
        if (fr !== lastFront && now - lastClack > 55) { clack(0.05 + 0.07 * (1 - t)); lastClack = now; }
        lastFront = fr;
      });
      R = Rf; hop = 0;
      win = faceOfPool(w);
      draw();
      nameEl.classList.add('win');
    },
    reset() { win = -1; nameEl.classList.remove('win'); draw(); },
  };
}
