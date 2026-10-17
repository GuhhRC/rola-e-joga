'use strict';

/* ==========================================================================
   Rola e Joga!
   - Dados: data/games.json (gerado por scripts/update.mjs) + data/genres.json
   - Configurações (site, Worker, anúncios, afiliados): config.js
   - Sem dependências. Tudo salvo só no aparelho (localStorage).
   ========================================================================== */

/* ---------- configuração ---------- */
const CFG = Object.assign(
  { siteName: 'Rola e Joga!', siteLabel: 'Rola e Joga!', siteUrl: '', apiUrl: '', ads: {}, affiliates: [] },
  window.ROLA_CONFIG || {},
);
const CREATOR = Object.assign({ name: '@opropriogustavo', role: 'Idealizador', url: 'https://www.instagram.com/opropriogustavo/' }, CFG.creator || {});
const API_URL = String(window.__API_URL__ || CFG.apiUrl || '').replace(/\/$/, '');
const ADS = CFG.ads || {};
const ADULT_BLUR_COVERS = CFG.adultBlurCovers === true; // capas do +18 borradas (padrão: livres)
const ADULT_BLUR_SHOTS = CFG.adultBlurShots !== false; // miniaturas dos prints no +18 borradas (padrão: sim)
const ADS_ON = !!(ADS.enabled && ADS.client);
const QUANTITIES = [10, 20, 30, 40, 50, 100]; // opções do pop-up
const WHEEL_MAX = 20; // até aqui: roda circular; acima: slot de capas
const SPIN_MS = 6800; // duração do giro
const REEL_ROW = 146; // altura de cada capa no slot (precisa bater com o CSS)

const TAU = Math.PI * 2;

/* ---------- utilidades ---------- */
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}

// aleatório de verdade (melhor que Math.random para sorteio)
function rnd() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}
function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('rs.' + k);
      return v ? JSON.parse(v) : d;
    } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('rs.' + k, JSON.stringify(v)); } catch { /* sem armazenamento: segue sem salvar */ }
  },
};

/* ---------- estado ---------- */
const state = {
  games: [], // catálogo
  genres: [], // gêneros do catálogo {id,label,steamTag,count}
  baseGenres: [], // genres.json
  meta: {},
  byId: new Map(),

  adult: false, // modo +18 (escondido)
  normal: null, // cópia do catálogo normal enquanto o +18 está ativo
  source: 'catalog', // 'catalog' | 'library'
  lib: null, // { profile, games, filter }
  libBusy: false,
  libInput: store.get('profile', ''),
  libError: null,

  genre: null,
  pool: [],
  played: new Map(store.get('played', [])), // id -> nome (só catálogo)
  history: store.get('history', []),
  challenges: store.get('challenges', []),
  mute: store.get('mute', false),
  busy: false,
  rec: false,
  view: 'home',
  resultShown: false,
  screenId: 0,
  curSec: null,
  curSpin: null,
  listTab: 'history',
};

const view = $('#view');
const stage = $('#stage');
const modal = $('#modal');
const drawer = $('#drawer');
const $back = $('#btnBack');

const coverUrl = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
const storeUrl = (id) => `https://store.steampowered.com/app/${id}`;
const labelOf = (id) => state.baseGenres.find((g) => g.id === id)?.label || null;
const nf = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const isLib = () => state.source === 'library';

function coverImg(game) {
  const img = h('img', { src: coverUrl(game.id), alt: game.name, decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'noimg' }, game.name)), { once: true });
  return img;
}

function fmtHours(min) {
  if (!min) return 'Nunca jogado';
  if (min < 60) return `${min} min jogados`;
  const hrs = min / 60;
  return `${hrs >= 10 ? Math.round(hrs) : hrs.toFixed(1).replace('.', ',')} h jogadas`;
}

/* ---------- fonte de jogos: catálogo ou biblioteca do usuário ---------- */
const LIB_FILTERS = [
  ['all', 'Todos', () => true],
  ['never', 'Nunca joguei', (g) => !g.minutes],
  ['low', 'Menos de 2h', (g) => g.minutes < 120],
];

function libFiltered() {
  if (!state.lib) return [];
  const f = LIB_FILTERS.find((x) => x[0] === state.lib.filter) || LIB_FILTERS[0];
  return state.lib.games.filter(f[2]);
}

function sourceGames() {
  return isLib() ? libFiltered() : state.games.filter((g) => !state.played.has(g.id));
}

function availableFor(genre) {
  const base = sourceGames();
  if (genre.id === 'todos') return base;
  if (genre.id === 'outros') return base.filter((g) => !g.genres.length);
  return base.filter((g) => g.genres.includes(genre.id));
}

// gêneros mostrados na home e usados pela roleta de gêneros
function homeGenres() {
  if (!isLib()) return state.genres;
  const base = libFiltered();
  const out = state.baseGenres
    .map((g) => ({ ...g, count: base.filter((x) => x.genres.includes(g.id)).length }))
    .filter((g) => g.count > 0);
  const others = base.filter((x) => !x.genres.length).length;
  if (others) out.push({ id: 'outros', label: 'Outros', count: others });
  return out;
}

function mount(node) {
  state.screenId++;
  state.curSpin = null;
  state.curSec = null;
  state.resultShown = false;
  view.replaceChildren(node);
  view.scrollTop = 0;
  updateAds();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- som ---------- */
let actx;
function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* sem áudio */ }
}
function beep(freq = 1000, dur = 0.03, vol = 0.04, type = 'square') {
  if (state.mute || !actx) return;
  try {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur + 0.01);
  } catch { /* ignora */ }
}
const tick = () => beep(980 + rnd() * 140, 0.025, 0.035, 'square');
function winSound() {
  beep(523, 0.18, 0.06, 'triangle');
  setTimeout(() => beep(659, 0.2, 0.06, 'triangle'), 90);
  setTimeout(() => beep(784, 0.4, 0.06, 'triangle'), 180);
}

/* ---------- animação ---------- */
const easeOut = (t) => 1 - Math.pow(1 - t, 4); // desacelera e "se arrasta" no final
function animate(ms, ease, onFrame) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function frame(now) {
      const t = Math.min(1, (now - t0) / ms);
      onFrame(ease(t));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    })(t0);
  });
}
function flick(el) {
  el.classList.remove('flick');
  void el.offsetWidth;
  el.classList.add('flick');
}

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

  const pickNot = (g) => {
    let p;
    do { p = pool[Math.floor(rnd() * n)]; } while (p === g && n > 1);
    return p;
  };
  const setPos = (p) => { strip.style.transform = `translateY(${(REEL_ROW * (1 - p)).toFixed(2)}px)`; };
  const build = (seq) => strip.replaceChildren(...seq.map((g) => h('div', { class: 'reel-item' }, coverImg(g))));
  const rest = () => { build([pickNot(current), current, pickNot(current)]); setPos(1); };
  rest();

  return {
    el,
    async spin(w) {
      frame.classList.remove('win');
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
          const t = performance.now();
          if (t - lastTick > 32) { tick(); lastTick = t; }
        }
      });
      setPos(win);
      current = winner;
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

/* ==========================================================================
   Home
   ========================================================================== */
function setSource(s) {
  if (state.source === s) return;
  state.source = s;
  store.set('source', s); // lembra a última aba
  showHome();
}

function showHome() {
  if (state.adult) { showAdultRoulette(); return; }
  state.view = 'home';
  state.busy = false;
  $back.hidden = true;
  closeModal();

  const total = state.games.length;
  const when = state.meta.updatedAt
    ? new Date(state.meta.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  const seg = h('div', { class: 'seg hide-rec', role: 'tablist' },
    h('button', { class: 'seg-btn' + (!isLib() ? ' on' : ''), role: 'tab', 'aria-selected': String(!isLib()), onclick: () => setSource('catalog') }, 'Catálogo'),
    h('button', { class: 'seg-btn' + (isLib() ? ' on' : ''), role: 'tab', 'aria-selected': String(isLib()), onclick: () => setSource('library') }, 'Minha biblioteca'),
  );

  const foot = h('div', { class: 'foot hide-rec' },
    isLib() ? 'Os dados da sua biblioteca não são guardados.' : `${total} jogos` + (when ? ` · atualizado em ${when}` : ''),
    !window.__PREVIEW__ && h('div', { class: 'foot-links' },
      h('a', { href: 'sobre.html' }, 'Sobre'), ' · ',
      h('a', { href: 'guias/' }, 'Guias'), ' · ',
      h('a', { href: 'privacidade.html' }, 'Privacidade'),
    ),
    h('div', { class: 'foot-note' }, 'Steam é marca da Valve Corporation. Este site não é afiliado à Valve.'),
    h('div', { class: 'foot-note credit' }, `${CREATOR.role}: `,
        h('span', { class: 'at-wrap' },
          CREATOR.url ? h('a', { class: 'at-link', href: CREATOR.url, target: '_blank', rel: 'noopener' }, CREATOR.name) : CREATOR.name,
          h('button', { class: 'secret', 'aria-hidden': 'true', tabindex: '-1', onclick: onSecretTap }))),
  );

  mount(
    h('section', {},
      h('div', { class: 'hero hide-rec' },
        h('h1', {}, 'O que vamos jogar ', h('em', {}, 'hoje?')),
        h('p', {}, isLib()
          ? 'Cole o perfil da Steam e sorteie entre os jogos da biblioteca, inclusive só os que você nunca jogou.'
          : 'Escolha um gênero, defina quantos jogos entram na roleta e jogue o que ela mandar.'),
      ),
      seg,
      isLib() ? libraryPanel() : catalogPanel(),
      foot,
    ),
  );
}

function genreGrid(genres, extra) {
  return h('div', { class: 'genre-grid' },
    extra,
    genres.map((g) => h('button', { class: 'genre-btn', onclick: () => pickGenre(g) }, g.label, h('small', {}, String(g.count)))),
  );
}

function catalogPanel() {
  return h('div', {},
    genreGrid(state.genres),
    h('button', { class: 'undecided', onclick: showGenreWheel }, 'Estou indeciso · girar gêneros'),
  );
}

/* ---------- biblioteca por perfil ---------- */
const LIB_ERRORS = {
  bad_input: { text: 'Não entendi esse perfil. Cole o link do perfil, o nome personalizado ou o ID de 17 dígitos.' },
  not_found: { text: 'Perfil não encontrado. Confira o link ou o nome e tente de novo.' },
  private_profile: {
    text: 'Este perfil é privado. O dono precisa deixar o perfil público para a roleta enxergar os jogos.',
    help: true,
  },
  games_hidden: { text: 'Este usuário tem a lista de jogos oculta.', help: true },
  no_games: { text: 'Este perfil é público, mas não tem jogos na biblioteca.' },
  rate_limited: { text: 'A Steam pediu uma pausa. Tente de novo em instantes.' },
  unconfigured: { text: 'A busca por perfil ainda não foi ativada neste site.' },
  fallback: { text: 'Não consegui falar com a Steam agora. Tente de novo em instantes.' },
};

async function fetchLibrary(input) {
  try {
    const r = await fetch(`${API_URL}/api/library?profile=${encodeURIComponent(input)}`);
    const data = await r.json();
    return data && typeof data === 'object' ? data : { ok: false, error: 'upstream' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

async function loadLibrary(input) {
  input = String(input || '').trim();
  state.libInput = input;
  state.libError = null;
  if (!input) { state.libError = { code: 'bad_input' }; showHome(); return; }
  if (!API_URL) { state.libError = { code: 'unconfigured' }; showHome(); return; }
  store.set('profile', input);
  state.libBusy = true;
  showHome();
  const data = await fetchLibrary(input);
  state.libBusy = false;
  if (data.ok && Array.isArray(data.games) && data.games.length) {
    const games = data.games.map((g) => {
      const base = state.byId.get(g.id);
      return { ...(base || {}), id: g.id, name: g.name, genres: base ? base.genres : [], minutes: g.min || 0 };
    });
    state.lib = { profile: data.profile || { name: 'Jogador' }, games, filter: 'all' };
    state.libError = null;
  } else {
    state.lib = null;
    state.libError = { code: data.error || 'fallback', name: data.profile?.name };
  }
  showHome();
}

function libraryPanel() {
  if (state.libBusy) {
    return h('div', { class: 'state-msg' }, h('div', { class: 'loader' }), 'Buscando a biblioteca…');
  }
  if (!state.lib) return libraryForm();

  const lib = state.lib;
  const counts = Object.fromEntries(LIB_FILTERS.map(([k, , fn]) => [k, lib.games.filter(fn).length]));
  const avail = libFiltered().length;
  const genres = homeGenres();

  return h('div', {},
    h('div', { class: 'lib-head' },
      h('div', { class: 'lib-name' }, h('b', {}, lib.profile.name), h('small', {}, `${lib.games.length} jogos`)),
      h('button', { class: 'link', onclick: () => { state.lib = null; showHome(); } }, 'trocar perfil'),
    ),
    h('div', { class: 'filters' },
      LIB_FILTERS.map(([k, label]) =>
        h('button', { class: 'chipbtn' + (lib.filter === k ? ' on' : ''), onclick: () => { lib.filter = k; showHome(); } }, `${label} (${counts[k]})`),
      ),
    ),
    avail
      ? h('div', {},
        genreGrid(genres, h('button', { class: 'genre-btn all', onclick: () => pickGenre({ id: 'todos', label: 'Toda a biblioteca', count: avail }) }, 'Toda a biblioteca', h('small', {}, String(avail)))),
        genres.length > 1 && h('button', { class: 'undecided', onclick: showGenreWheel }, 'Estou indeciso · girar gêneros'),
        state.baseGenres.length && genres.length === 1 && genres[0].id === 'outros'
          ? h('p', { class: 'hint' }, 'Os jogos desta biblioteca ainda não têm gênero na nossa base. A lista cresce a cada atualização.')
          : null,
      )
      : h('p', { class: 'hint' }, 'Nenhum jogo nesse filtro. Experimente outro.'),
  );
}

function libraryForm() {
  const err = state.libError;
  const info = err ? LIB_ERRORS[err.code] || LIB_ERRORS.fallback : null;
  const input = h('input', {
    id: 'profileInput',
    class: 'field',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Link do perfil, nome ou ID da Steam',
    value: state.libInput || '',
  });
  const submit = () => loadLibrary(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); } });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  return h('div', { class: 'lib-form' },
    h('label', { class: 'lib-label', for: 'profileInput' }, 'Perfil da Steam'),
    h('div', { class: 'lib-row' }, input, h('button', { class: 'btn primary', onclick: submit }, 'Carregar')),
    h('p', { class: 'hint' }, 'Sem login e sem senha. Funciona com perfis que deixam a lista de jogos pública.'),
    info && h('div', { class: 'err-box', role: 'alert' },
      h('b', {}, info.text),
      info.help && h('div', { class: 'err-help' },
        h('p', {}, 'Se o perfil é seu, para liberar:'),
        h('ol', {},
          h('li', {}, 'Steam → seu perfil → Editar perfil → Configurações de privacidade.'),
          h('li', {}, 'Deixe "Perfil" e "Detalhes do jogo" como Público.'),
          h('li', {}, 'Espere uns 5 minutos e tente de novo. Depois pode voltar para privado.'),
        ),
      ),
    ),
  );
}

/* ---------- escolha de gênero e quantidade ---------- */
function pickGenre(g) {
  state.genre = g;
  openQty();
}

function openQty() {
  const genre = state.genre;
  const avail = availableFor(genre);
  if (!avail.length) {
    toast(isLib() ? 'Nenhum jogo nessa seleção.' : 'Você já marcou todos os jogos desse gênero como jogados.');
    return;
  }
  const n = avail.length;
  const buttons = QUANTITIES.map((q) => h('button', { class: 'qty', disabled: n < q, onclick: () => startSpin(q) }, String(q)));
  const showAll = n < 100 && !QUANTITIES.includes(n);

  const sheet = h('div', { class: 'sheet', onclick: (e) => e.stopPropagation() },
    h('h3', {}, 'Quantos jogos na roleta?'),
    h('p', {}, `${genre.label} · ${n} jogos disponíveis`),
    h('div', { class: 'qty-grid' }, buttons),
    showAll && h('button', { class: 'btn big', style: 'margin-top:8px', onclick: () => startSpin(n) }, `Todos (${n})`),
    n < 30 && h('p', { style: 'margin-top:10px' }, isLib()
      ? 'Poucos jogos nessa seleção. Troque o filtro ou o gênero para ter mais opções.'
      : 'Poucos jogos nesse gênero por enquanto. A lista cresce a cada atualização diária.'),
    h('button', { class: 'link cancel', onclick: closeModal }, 'cancelar'),
  );
  openModal(sheet);
}

function startSpin(q) {
  closeModal();
  if (state.adult) state.adultQty = q;
  state.pool = sample(availableFor(state.genre), q);
  showSpin();
}

function showSpin() {
  state.view = 'spin';
  state.busy = false;
  $back.hidden = false;
  const pool = state.pool;
  const n = pool.length;
  const useWheel = n <= WHEEL_MAX;
  const engine = useWheel ? createWheel(pool.map((g) => g.name)) : createReel(pool);

  const head = state.adult
    ? adultHead(n)
    : h('div', { class: 'spin-head hide-rec' },
      h('div', {}, h('span', { class: 'chip' }, state.genre.label), ' ', h('span', { class: 'chip soft' }, `${n} jogos`)),
      h('button', { class: 'link', onclick: () => openQty() }, 'alterar'),
    );
  if (state.adult) $back.hidden = true; // no +18 a saída é o botão "Sair do +18"

  mount(
    spinScreen({
      head,
      n,
      engine,
      isReel: !useWheel,
      ctaText: 'Girar',
      renderResult: (idx, again) => gameResult(pool[idx], again),
    }),
  );
}

function statNodes(g) {
  const out = [];
  if (g.minutes != null) out.push(h('span', {}, h('b', {}, fmtHours(g.minutes))));
  if (g.approval != null) out.push(h('span', {}, h('b', {}, g.approval + '%'), ' avaliações positivas' + (g.reviews ? ` (${nf.format(g.reviews)})` : '')));
  const price = g.free ? 'Grátis' : g.price;
  if (price && !isLib()) out.push(h('span', { class: 'price', 'data-price': '1' }, price));
  if (g.year) out.push(h('span', {}, String(g.year)));
  if (g.metacritic) out.push(h('span', {}, 'Metacritic ', h('b', {}, g.metacritic)));
  if (!out.length) out.push(h('span', { class: 'ph' }, 'Mais detalhes chegam na próxima atualização'));
  return out;
}

/* Afiliados: cada loja tem `search` (busca no site da loja, com {name}) e, opcionalmente, `link`
   (deeplink de afiliado gerado no painel da Rakuten/Afilio, com {url} no lugar do destino).
   Sem `link`, abre a busca simples (sem comissão). O formato antigo `url` continua valendo. */
function offerLinks(g) {
  const name = encodeURIComponent(g.name);
  return (CFG.affiliates || [])
    .map((a) => {
      if (!a) return null;
      const fill = (t) => String(t).replaceAll('{name}', name).replaceAll('{id}', String(g.id));
      if (a.search) {
        const dest = fill(a.search);
        return { name: a.name, tracked: !!a.link, href: a.link ? String(a.link).replaceAll('{url}', encodeURIComponent(dest)).replaceAll('{name}', name) : dest };
      }
      if (a.url) return { name: a.name, tracked: true, href: fill(a.url) };
      return null;
    })
    .filter(Boolean);
}

function openOffers(g) {
  const links = offerLinks(g);
  const sheet = h('div', { class: 'sheet', onclick: (e) => e.stopPropagation() },
    h('h3', {}, 'Onde comprar'),
    h('p', {}, g.name),
    h('div', { class: 'offers' },
      links.map((l) => h('a', { class: 'btn', href: l.href, target: '_blank', rel: (l.tracked ? 'sponsored ' : '') + 'noopener' }, l.name)),
    ),
    links.some((l) => l.tracked) && h('p', { class: 'fine' }, 'Alguns links são de afiliados: podemos receber uma comissão se você comprar, sem custo extra para você.'),
    h('button', { class: 'link cancel', onclick: closeModal }, 'fechar'),
  );
  openModal(sheet);
}

/* ---------- detalhes do jogo (carregados sob demanda, 1 arquivo por 100 ids) ---------- */
const shardCache = new Map();
function loadDetail(id) {
  if (state.adult) { // +18: sem descrição; só os prints que o robô guardou
    const s = state.byId.get(id)?.shots;
    return Promise.resolve(s && s.length ? { shots: s } : null);
  }
  if (window.__DETAILS__) return Promise.resolve(window.__DETAILS__[id] || null);
  const n = String(id % 100).padStart(2, '0');
  if (!shardCache.has(n)) {
    shardCache.set(n, fetch(`data/details/${n}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return shardCache.get(n).then((sh) => sh[id] || null);
}

const PT_LABEL = { 1: 'Legendado em português', 2: 'Dublado/narrado em português' };
const PLAT_LABEL = { win: 'Windows', mac: 'Mac', lin: 'Linux' };

function detailNodes(d, g) {
  const out = [];
  const badges = [];
  if (d.pt) badges.push(h('span', { class: 'badge pt' }, 'PT-BR · ' + (d.pt === 2 ? 'narrado' : 'legendado')));
  if (d.mc) badges.push(h('span', { class: 'badge' }, 'Metacritic ' + d.mc));
  if (badges.length) out.push(h('div', { class: 'badges' }, badges));

  if (d.shots?.length) {
    const blur = state.adult && ADULT_BLUR_SHOTS;
    out.push(h('div', { class: 'shots' + (blur ? ' blurred' : '') },
      d.shots.map((u, i) => {
        const b = h('button', { class: 'shot', type: 'button', 'aria-label': `Print ${i + 1} de ${d.shots.length}` },
          h('img', { src: u, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => { b.remove(); } }));
        b.addEventListener('click', () => {
          if (blur && !b.classList.contains('rev')) { b.classList.add('rev'); return; } // 1º toque revela, 2º amplia
          openViewer(d.shots, i);
        });
        return b;
      }),
    ));
    if (blur) out.push(h('p', { class: 'shots-hint' }, 'Toque num print para ver; toque de novo para ampliar.'));
  }

  // o resto fica recolhido, para o card não ficar enorme
  const rows = [];
  if (d.dev?.length) rows.push(['Desenvolvedor', d.dev.join(', ')]);
  if (d.pub?.length && d.pub.join() !== (d.dev || []).join()) rows.push(['Publicadora', d.pub.join(', ')]);
  if (d.rel) rows.push(['Lançamento', d.rel]);
  if (d.plat?.length) rows.push(['Plataformas', d.plat.map((p) => PLAT_LABEL[p] || p).join(', ')]);
  if (g.med) rows.push(['Tempo típico', `${g.med >= 600 ? Math.round(g.med / 60) : (g.med / 60).toFixed(1).replace('.', ',')} h (mediana)`]);
  if (d.recs) rows.push(['Recomendações', nf.format(d.recs)]);
  if (d.age) rows.push(['Idade', d.age + '+']);
  if (d.ctrl) rows.push(['Controle', d.ctrl === 'full' ? 'Suporte total' : 'Suporte parcial']);

  const modes = (d.cats || []).filter((c) => !/coop|cooperativ/i.test(c) || /on-?line/i.test(c) || (d.cats || []).length < 3);
  const tags = [...new Set([...(d.tags || []), ...(d.sg || [])])].slice(0, 8);
  const more = [];
  if (rows.length) more.push(h('dl', { class: 'facts' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
  if (modes.length) more.push(h('div', { class: 'badges' }, modes.slice(0, 4).map((c) => h('span', { class: 'badge' }, c))));
  if (tags.length) more.push(h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'chip soft' }, t))));
  if (more.length) out.push(h('details', { class: 'more' }, h('summary', {}, 'Mais detalhes'), ...more));
  return out;
}

function gameResult(g, again, opts = {}) {
  if (!opts.shared && !state.adult) pushHistory(g);
  const tags = (g.genres || []).map(labelOf).filter(Boolean).slice(0, 4);
  const lib = isLib();
  const offers = !lib && !state.adult && offerLinks(g).length > 0;
  const extra = h('div', { class: 'extra hide-rec' });
  loadDetail(g.id).then((d) => {
    if (!d) return;
    extra.parentNode?.querySelectorAll('.stats .ph').forEach((n) => n.remove());
    if (d.desc && !g.desc) {
      const body = extra.parentNode;
      body?.insertBefore(h('p', { class: 'desc' }, d.desc), extra);
    }
    const pr = d.price && !d.free ? d.price : null;
    if (pr && !lib) {
      const root = extra.parentNode;
      let el = root?.querySelector('[data-price]');
      if (!el && root?.querySelector('.stats')) { el = h('span', { class: 'price', 'data-price': '1' }); root.querySelector('.stats').append(el); }
      if (el) {
        el.replaceChildren(...(pr.d ? [h('s', { class: 'old' }, pr.i || ''), ' ', h('b', {}, pr.f), ' ', h('span', { class: 'off' }, `-${pr.d}%`)] : [pr.f]));
      }
    }
    extra.append(...detailNodes(d, g));
  });

  const btnPlayed = h('button', { class: 'btn ghost' }, lib ? 'Tirar da roleta' : 'Já joguei · tirar');
  const btnChallenge = h('button', { class: 'btn ghost' }, 'Aceitar desafio');
  const btnShare = h('button', { class: 'btn ghost' }, 'Compartilhar card');
  const btnAgain = h('button', { class: 'btn' }, opts.shared ? 'Girar a minha roleta' : 'Girar de novo');
  if (state.adult) { btnAgain.classList.add('hot-ghost'); btnAgain.style.gridColumn = '1 / -1'; }
  const btnCopy = h('button', { class: 'link copy-link' }, 'Copiar texto com link');
  btnCopy.addEventListener('click', async () => { toast((await copyText(shareText(g))) ? 'Texto com link copiado.' : 'Não consegui copiar.'); });

  if (state.challenges.some((c) => c.id === g.id)) { btnChallenge.disabled = true; btnChallenge.textContent = 'Desafio aceito'; }

  btnPlayed.addEventListener('click', () => {
    if (!lib) markPlayed(g);
    state.pool = state.pool.filter((x) => x.id !== g.id);
    btnPlayed.disabled = true;
    btnPlayed.textContent = lib ? 'Tirado desta roleta' : 'Marcado como jogado';
    toast(lib ? 'Tirado desta roleta.' : 'Tirado das próximas roletas.');
  });
  btnChallenge.addEventListener('click', () => {
    addChallenge(g);
    btnChallenge.disabled = true;
    btnChallenge.textContent = 'Desafio aceito';
    toast('Desafio salvo em Listas.');
  });
  btnShare.addEventListener('click', () => shareCard(g, btnShare));
  const lastPoolSize = state.pool.length; // se mudar (tirou um jogo), reconstrói a roleta
  btnAgain.addEventListener('click', () => {
    if (opts.shared) { showHome(); return; }
    if (!state.pool.length) { toast('A roleta ficou vazia. Escolha outro gênero.'); showHome(); return; }
    if (state.pool.length !== lastPoolSize) showSpin();
    else again();
  });

  return [
    h('article', { class: 'card' + (state.adult ? ' adult-card' : '') },
      h('div', { class: 'cover', onclick: (e) => e.currentTarget.classList.toggle('show') }, coverImg(g), state.adult && h('span', { class: 'age-badge' }, '+18')),
      h('div', { class: 'card-body' },
        h('h2', {}, g.name),
        h('div', { class: 'stats' }, statNodes(g)),
        state.adult
          ? (g.tags || []).length > 0 && h('div', { class: 'tags' }, g.tags.map((t) => h('span', { class: 'chip hot' }, ADULT_TAG_PT[t] || t)))
          : tags.length > 0 && h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'chip soft' }, t))),
        g.desc && h('p', { class: 'desc' }, g.desc),
        extra,
      ),
    ),
    h('div', { class: 'actions hide-rec' },
      h('a', { class: 'btn primary' + (state.adult ? ' steam-hot' : ''), href: storeUrl(g.id), target: '_blank', rel: 'noopener' }, state.adult ? 'Abrir na Steam ↗' : 'Abrir na Steam'),
      btnAgain,
      offers && h('button', { class: 'btn', onclick: () => openOffers(g) }, 'Ver ofertas'),
      !opts.shared && !state.adult && btnPlayed,
      !opts.shared && !state.adult && btnChallenge,
      !state.adult && btnShare,
      !state.adult && btnCopy,
    ),
  ];
}

/* ---------- roleta de gêneros (opcional) ---------- */
function showGenreWheel() {
  state.view = 'genrewheel';
  state.busy = false;
  $back.hidden = false;
  const gs = homeGenres();
  const engine = createWheel(gs.map((g) => g.label));
  const head = h('div', { class: 'spin-head hide-rec' }, h('span', { class: 'chip' }, 'Sorteio de gênero'), h('span', { class: 'chip soft' }, `${gs.length} gêneros`));

  mount(
    spinScreen({
      head,
      n: gs.length,
      engine,
      isReel: false,
      ctaText: 'Girar gêneros',
      renderResult: (idx, again) => {
        const g = gs[idx];
        return [
          h('article', { class: 'card' },
            h('div', { class: 'card-body' },
              h('div', { class: 'mono muted', style: 'font-size:11px;letter-spacing:.14em' }, 'O GÊNERO DA VEZ É'),
              h('h2', { style: 'font-size:30px;margin-top:6px;color:var(--green)' }, g.label),
              h('p', { class: 'desc' }, `${g.count} jogos ${isLib() ? 'na seleção' : 'na lista'}.`),
            ),
          ),
          h('div', { class: 'actions hide-rec' },
            h('button', { class: 'btn primary', onclick: () => pickGenre(g) }, 'Escolher quantos jogos'),
            h('button', { class: 'btn', style: 'grid-column:1/-1', onclick: again }, 'Girar de novo'),
          ),
        ];
      },
    }),
  );
}

/* ==========================================================================
   Modal e gaveta de listas
   ========================================================================== */
function openModal(node) {
  modal.replaceChildren(node);
  modal.hidden = false;
  modal.onclick = closeModal;
}
function closeModal() {
  modal.hidden = true;
  modal.replaceChildren();
}

function openLists(tab) {
  state.listTab = tab || state.listTab;
  drawer.hidden = false;
  renderLists();
}
function closeLists() { drawer.hidden = true; }

function renderLists() {
  const tabs = [
    ['history', 'Histórico', state.history.length],
    ['played', 'Já joguei', state.played.size],
    ['challenges', 'Desafios', state.challenges.length],
  ];
  const fmt = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const thumb = (id) => {
    const i = h('img', { src: coverUrl(id), alt: '', loading: 'lazy' });
    i.addEventListener('error', () => { i.style.visibility = 'hidden'; }, { once: true });
    return i;
  };
  const row = (id, name, sub, ...btns) =>
    h('div', { class: 'row' }, thumb(id), h('div', { class: 'info' }, h('b', {}, name), h('small', {}, sub)), btns);
  const steam = (id) => h('a', { class: 'mini', href: storeUrl(id), target: '_blank', rel: 'noopener' }, 'Steam');

  let rows = [];
  let empty = '';
  if (state.listTab === 'history') {
    empty = 'Nada sorteado ainda. Gire a roleta!';
    rows = state.history.map((x) => row(x.id, x.name, fmt(x.t), steam(x.id)));
    if (rows.length) rows.push(h('button', { class: 'link', style: 'align-self:center;margin-top:8px', onclick: () => { state.history = []; store.set('history', []); renderLists(); } }, 'limpar histórico'));
  } else if (state.listTab === 'played') {
    empty = 'Os jogos que você marcar como "já joguei" ficam aqui e saem das roletas.';
    rows = [...state.played].map(([id, name]) =>
      row(id, name, 'fora das roletas', h('button', { class: 'mini x', onclick: () => { state.played.delete(id); savePlayed(); renderLists(); if (state.view === 'home') showHome(); } }, 'voltar')),
    );
  } else {
    empty = 'Aceite o desafio de um jogo sorteado e ele fica aqui até você jogar.';
    rows = state.challenges.map((c) =>
      row(c.id, c.name, 'desde ' + fmt(c.t),
        h('button', { class: 'mini', onclick: () => { markPlayed(c); state.challenges = state.challenges.filter((x) => x.id !== c.id); store.set('challenges', state.challenges); renderLists(); toast('Desafio concluído!'); } }, 'concluí'),
        h('button', { class: 'mini x', onclick: () => { state.challenges = state.challenges.filter((x) => x.id !== c.id); store.set('challenges', state.challenges); renderLists(); } }, 'x'),
      ),
    );
  }

  drawer.replaceChildren(
    h('div', { class: 'drawer-head' }, h('h3', {}, 'LISTAS'), h('button', { class: 'icon-btn', onclick: closeLists }, 'FECHAR')),
    h('div', { class: 'tabs' }, tabs.map(([k, l, c]) => h('button', { class: 'tab' + (k === state.listTab ? ' on' : ''), onclick: () => { state.listTab = k; renderLists(); } }, `${l} (${c})`))),
    h('div', { class: 'list' }, rows.length ? rows : h('div', { class: 'empty' }, empty)),
  );
}

/* ---------- persistência ---------- */
function savePlayed() { store.set('played', [...state.played]); }
function markPlayed(g) { state.played.set(g.id, g.name); savePlayed(); }
function addChallenge(g) {
  if (state.challenges.some((c) => c.id === g.id)) return;
  state.challenges.unshift({ id: g.id, name: g.name, t: Date.now() });
  store.set('challenges', state.challenges);
}
function pushHistory(g) {
  state.history.unshift({ id: g.id, name: g.name, t: Date.now() });
  state.history = state.history.slice(0, 50);
  store.set('history', state.history);
}

/* ==========================================================================
   Card de compartilhamento 1080x1920 (stories / reels / tiktok)
   ========================================================================== */
function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
function roundRect(x, px, py, w, hgt, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + hgt, r);
  x.arcTo(px + w, py + hgt, px, py + hgt, r);
  x.arcTo(px, py + hgt, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
function wrapLines(x, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (x.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

// logo: anel, raios, miolo e ponteiro (mesmo desenho do cabeçalho)
function drawLogo(x, cx, cy, r) {
  x.save();
  x.lineJoin = 'round';
  x.fillStyle = '#2eea7a';
  x.strokeStyle = '#2eea7a';
  // fatias alternadas (12 fatias, as pares preenchidas)
  x.globalAlpha = 0.85;
  for (let i = 0; i < 12; i += 2) {
    const a0 = -Math.PI / 2 + (i * TAU) / 12;
    x.beginPath();
    x.moveTo(cx, cy);
    x.arc(cx, cy, r, a0, a0 + TAU / 12);
    x.closePath();
    x.fill();
  }
  x.globalAlpha = 1;
  // anel com brilho
  x.shadowColor = 'rgba(46,234,122,0.6)';
  x.shadowBlur = r * 0.5;
  x.lineWidth = r * 0.17;
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.stroke();
  x.shadowBlur = 0;
  // miolo
  x.fillStyle = '#0a0a0a';
  x.lineWidth = r * 0.13;
  x.beginPath();
  x.arc(cx, cy, r * 0.27, 0, TAU);
  x.fill();
  x.stroke();
  // ponteiro apontando para dentro da roda, com contorno escuro
  x.fillStyle = '#2eea7a';
  x.strokeStyle = '#0a0a0a';
  x.lineWidth = r * 0.14;
  x.beginPath();
  x.moveTo(cx - r * 0.39, cy - r * 1.32);
  x.lineTo(cx + r * 0.39, cy - r * 1.32);
  x.lineTo(cx, cy - r * 0.5);
  x.closePath();
  x.stroke();
  x.fill();
  x.restore();
}

async function makeCard(g) {
  const W = 1080;
  const H = 1920;
  const cv = h('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  const sans = '"Inter", system-ui, sans-serif';
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  x.textAlign = 'center';

  x.fillStyle = '#0a0a0a';
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 760, 40, W / 2, 760, 780);
  glow.addColorStop(0, 'rgba(46,234,122,0.22)');
  glow.addColorStop(1, 'rgba(46,234,122,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(46,234,122,0.05)';
  x.lineWidth = 2;
  for (let i = 0; i <= W; i += 90) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  for (let j = 0; j <= H; j += 90) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }

  // marca: logo + ROLA e JOGA!
  const parts = [['ROLA', '#e8efe9', 58], ['e', '#7d8c83', 36], ['JOGA', '#2eea7a', 58], ['!', '#2eea7a', 58]];
  if ('letterSpacing' in x) x.letterSpacing = '4px';
  const widths = parts.map(([t, , size]) => { x.font = `700 ${size}px ${mono}`; return x.measureText(t).width; });
  const logoR = 38;
  const gap = 30;
  const textW = widths.reduce((a, b) => a + b, 0) + 14;
  let px = (W - (logoR * 2 + gap + textW)) / 2;
  drawLogo(x, px + logoR, 196, logoR);
  px += logoR * 2 + gap;
  x.textAlign = 'left';
  parts.forEach(([t, color, size], i) => {
    x.font = `700 ${size}px ${mono}`;
    x.fillStyle = color;
    x.fillText(t, px, 214);
    px += widths[i] + (i === 0 ? 7 : i === 1 ? 7 : 0);
  });
  x.textAlign = 'center';

  x.font = `700 44px ${mono}`;
  x.fillStyle = '#2eea7a';
  x.fillText('A ROLETA MANDOU:', W / 2, 430);
  if ('letterSpacing' in x) x.letterSpacing = '0px';

  // capa
  const cx = 80, cy = 500, cw = 920, ch = 430;
  const img = await loadImg(coverUrl(g.id));
  x.save();
  x.shadowColor = 'rgba(46,234,122,0.55)';
  x.shadowBlur = 60;
  roundRect(x, cx, cy, cw, ch, 22);
  x.fillStyle = '#0c110e';
  x.fill();
  x.restore();
  if (img) {
    x.save();
    roundRect(x, cx, cy, cw, ch, 22);
    x.clip();
    x.drawImage(img, cx, cy, cw, ch);
    x.restore();
  }
  roundRect(x, cx, cy, cw, ch, 22);
  x.lineWidth = 4;
  x.strokeStyle = '#2eea7a';
  x.stroke();

  // nome
  x.fillStyle = '#e8efe9';
  x.font = `700 96px ${sans}`;
  const lines = wrapLines(x, g.name, 920, 3);
  let y = 1090;
  for (const l of lines) { x.fillText(l, W / 2, y); y += 112; }

  // números
  const bits = [];
  if (g.approval != null) bits.push(g.approval + '% positivas');
  const price = g.free ? 'Grátis' : isLib() ? null : g.price;
  if (price) bits.push(price);
  if (g.year) bits.push(String(g.year));
  x.font = `500 40px ${mono}`;
  x.fillStyle = '#7d8c83';
  y += 14;
  if (bits.length) { x.fillText(bits.join('  ·  '), W / 2, y); y += 66; }
  const gl = (g.genres || []).map(labelOf).filter(Boolean).slice(0, 3).join('  /  ');
  if (gl) { x.fillStyle = '#2eea7a'; x.fillText(gl, W / 2, y); }

  // rodapé
  x.fillStyle = '#7d8c83';
  x.font = `500 38px ${mono}`;
  x.fillText('Gire a sua em', W / 2, 1750);
  x.fillStyle = '#e8efe9';
  x.font = `700 46px ${mono}`;
  x.fillText(CFG.siteLabel || CFG.siteName, W / 2, 1812);
  return cv;
}

/* Link do resultado: abre o site direto no jogo sorteado (#j=<id>) */
function siteBase() {
  const fixed = String(CFG.siteUrl || '').replace(/\/$/, '');
  if (fixed) return fixed + '/';
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
function shareUrl(g) {
  return siteBase() + (state.byId.has(g.id) ? `#j=${g.id}` : '');
}
const SHARE_TEXTS = [
  'A roleta decidiu: eu vou jogar {name}. Sem volta! Gira a sua: {url}',
  'Tirei {name} na roleta do Rola e Joga! Agora eu tenho que jogar. Gira a sua: {url}',
  'Pedi um jogo de {genre} e a roleta mandou {name}. Gira a sua: {url}',
  'Indeciso demais para escolher, então a roleta escolheu: {name}. Tenta a sua: {url}',
];
function shareText(g) {
  const list = Array.isArray(CFG.shareTexts) && CFG.shareTexts.length ? CFG.shareTexts : SHARE_TEXTS;
  const genre = (g.genres || []).map(labelOf).find(Boolean);
  // textos com {genre} só quando o jogo tem gênero
  const ok = list.filter((t) => genre || !t.includes('{genre}'));
  const t = (ok.length ? ok : SHARE_TEXTS.filter((x) => !x.includes('{genre}')))[Math.floor(Math.random() * (ok.length || 1))];
  return String(t).replaceAll('{name}', g.name).replaceAll('{genre}', genre || 'jogo').replaceAll('{url}', shareUrl(g));
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sem permissão de área de transferência */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

async function shareCard(g, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  const text = shareText(g);
  try {
    const cv = await makeCard(g);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('sem imagem');
    const file = new File([blob], `rola-e-joga-${g.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // alguns apps ignoram o texto quando há imagem: por isso o texto também vai para a área de transferência
      await copyText(text);
      await navigator.share({ files: [file], text });
      toast('Texto com link copiado também.');
    } else {
      const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      toast((await copyText(text)) ? 'Card salvo e texto com link copiado.' : 'Card salvo (1080x1920).');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('Não consegui gerar o card.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ==========================================================================
   Anúncios (desligados por padrão: config.js → ads.enabled)
   Regras: só com consentimento, nunca no modo gravação, durante o giro
   ou colados em botões.
   ========================================================================== */
let adsLoaded = false;
let bottomAd;
let sideAds = [];

function adUnit(slot, format) {
  return h('ins', {
    class: 'adsbygoogle',
    style: 'display:block',
    'data-ad-client': ADS.client,
    'data-ad-slot': slot,
    'data-ad-format': format,
    'data-full-width-responsive': 'true',
  });
}

function initAds() {
  // etiqueta de verificação do site no AdSense (não carrega nenhum anúncio nem cookie)
  if (ADS.client) document.head.append(h('meta', { name: 'google-adsense-account', content: ADS.client }));
  if (!ADS_ON) return;
  if (ADS.bottomSlot) {
    bottomAd = h('div', { class: 'ad-slot', hidden: true }, h('small', {}, 'publicidade'), adUnit(ADS.bottomSlot, 'auto'));
    stage.insertBefore(bottomAd, modal);
  }
  if (ADS.sideSlot) {
    sideAds = ['left', 'right'].map((side) => {
      const el = h('div', { class: 'ad-side ' + side, hidden: true }, h('small', {}, 'publicidade'), adUnit(ADS.sideSlot, 'vertical'));
      document.body.append(el);
      return el;
    });
  }
  const c = store.get('consent', null);
  if (c === 'yes') loadAds();
  else if (c == null) showConsent();
  updateAds();
}

function showConsent() {
  const bar = h('div', { class: 'consent', role: 'dialog', 'aria-label': 'Cookies e anúncios' },
    h('p', {}, 'Usamos cookies para mostrar anúncios. ', h('a', { href: 'privacidade.html', target: '_blank', rel: 'noopener' }, 'Saiba mais')),
    h('div', { class: 'consent-btns' },
      h('button', { class: 'btn ghost', onclick: () => answer('no') }, 'Recusar'),
      h('button', { class: 'btn primary', onclick: () => answer('yes') }, 'Aceitar'),
    ),
  );
  function answer(v) {
    store.set('consent', v);
    bar.remove();
    if (v === 'yes') loadAds();
    updateAds();
  }
  stage.append(bar);
}

function loadAds() {
  if (adsLoaded || !ADS_ON) return;
  adsLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.client)}`;
  document.head.append(s);
  updateAds();
}

function updateAds() {
  if (!ADS_ON) return;
  const ok = !state.rec && !state.busy && (state.view === 'home' || state.resultShown) && store.get('consent', null) === 'yes';
  for (const el of [bottomAd, ...sideAds]) {
    if (!el) continue;
    el.hidden = !ok;
    if (ok && adsLoaded && !el.dataset.pushed && el.offsetWidth > 0) {
      el.dataset.pushed = '1';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* bloqueador de anúncios */ }
    }
  }
}

/* ==========================================================================
   Modo gravação e controles do topo
   ========================================================================== */
function setRec(on) {
  state.rec = on;
  stage.classList.toggle('rec', on);
  document.body.classList.toggle('rec', on);
  $('#recExit').hidden = !on;
  $('#btnRec').classList.toggle('on', on);
  if (on) { closeModal(); closeLists(); }
  updateAds();
}
function renderSound() {
  const b = $('#btnSound');
  b.classList.toggle('muted', state.mute);
  b.setAttribute('aria-pressed', String(!state.mute));
}

$('#btnRec').addEventListener('click', () => setRec(!state.rec));
$('#recExit').addEventListener('click', () => setRec(false));
$('#btnLists').addEventListener('click', () => openLists());
$('#btnSound').addEventListener('click', () => {
  state.mute = !state.mute;
  store.set('mute', state.mute);
  renderSound();
  if (!state.mute) { unlockAudio(); tick(); }
});
$back.addEventListener('click', () => { if (!state.busy) showHome(); });

document.addEventListener('keydown', (e) => {
  if (viewer) { // visualizador de prints tem prioridade
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowRight') viewer.go(1);
    else if (e.key === 'ArrowLeft') viewer.go(-1);
    else return;
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (!modal.hidden) closeModal();
    else if (!drawer.hidden) closeLists();
    else if (state.rec) setRec(false);
    return;
  }
  if ((e.key === ' ' || e.key === 'Enter') && state.curSpin && modal.hidden && drawer.hidden) {
    if (e.target && /^(BUTTON|A|INPUT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    state.curSpin();
  }
});

/* ==========================================================================
   Início
   ========================================================================== */
async function loadJson(inline, url) {
  if (inline) return inline;
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r.json();
}

/* ==========================================================================
   Modo +18 (escondido): toque duplo no ícone da roleta + toque no @ do rodapé
   Fica separado do catálogo normal e nunca grava histórico, listas nem compartilha.
   ========================================================================== */
const ADULT_GENRES = [
  { id: 'sexual', label: 'Conteúdo sexual', tag: 'Sexual Content' },
  { id: 'hentai', label: 'Hentai', tag: 'Hentai' },
  { id: 'nudez', label: 'Nudez', tag: 'Nudity' },
];
const ADULT_TAG_PT = { 'Sexual Content': 'Conteúdo sexual', Hentai: 'Hentai', Nudity: 'Nudez', NSFW: 'NSFW' };
const ADULT_DEFAULT_QTY = 20;
let armTimer = 0;
let lastLogoTap = 0;

function arm() {
  document.body.classList.add('armed');
  try { navigator.vibrate?.(25); } catch { /* sem vibração */ }
  clearTimeout(armTimer);
  armTimer = setTimeout(disarm, 20000);
}
function disarm() {
  clearTimeout(armTimer);
  document.body.classList.remove('armed');
}
// o botão escondido só recebe o toque depois do toque duplo no ícone; antes disso o toque cai no link do Instagram
function onSecretTap(e) {
  e.stopPropagation();
  if (!document.body.classList.contains('armed') || state.adult) return;
  e.preventDefault();
  disarm();
  openAdultGate();
}
$('.brand .logo')?.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastLogoTap < 450) { lastLogoTap = 0; if (!state.adult) arm(); } else lastLogoTap = now;
});

function openAdultGate() {
  const sheet = h('div', { class: 'sheet gate', onclick: (e) => e.stopPropagation() },
    h('h3', {}, 'Conteúdo +18'),
    h('p', {}, 'Esta área lista jogos com conteúdo sexual e nudez. Só entre se você tem 18 anos ou mais.'),
    h('button', { class: 'btn primary big', style: 'margin-top:16px', onclick: enterAdult }, 'Tenho 18 anos ou mais'),
    h('button', { class: 'link cancel', onclick: closeModal }, 'sair'),
  );
  openModal(sheet);
}

const shotThumb = (id, t) => (/^https?:/.test(t) ? t : `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/${t}.116x65.jpg`);

async function enterAdult() {
  closeModal();
  let list = [];
  try {
    const r = window.__ADULT__ ? window.__ADULT__ : await fetch('data/adult.json', { cache: 'no-cache' }).then((x) => (x.ok ? x.json() : { games: [] }));
    list = (r.games || []).filter((g) => g && g.id && g.name && g.v && g.f); // só os confirmados
  } catch { list = []; }
  const tagId = new Map(ADULT_GENRES.map((g) => [g.tag, g.id]));
  const games = list.map((g) => {
    const ids = (g.tags || []).map((t) => tagId.get(t)).filter(Boolean);
    return {
      id: g.id, name: g.name, approval: g.approval, reviews: g.reviews, year: g.year, free: g.free, price: g.price,
      tags: g.tags || [],
      shots: (g.s || []).map((t) => shotThumb(g.id, t)),
      genres: ids.length ? ids : ['sexual'],
    };
  });
  state.normal = { games: state.games, byId: state.byId, genres: state.genres, baseGenres: state.baseGenres, source: state.source };
  state.games = games;
  state.byId = new Map(games.map((g) => [g.id, g]));
  state.baseGenres = ADULT_GENRES;
  state.genres = ADULT_GENRES.map((g) => ({ ...g, count: games.filter((x) => x.genres.includes(g.id)).length })).filter((g) => g.count > 0);
  state.source = 'catalog';
  state.adult = true;
  state.adultQty = ADULT_DEFAULT_QTY;
  state.genre = null;
  document.body.classList.add('adult');
  document.body.classList.toggle('blur-covers', ADULT_BLUR_COVERS);
  showHome(); // no +18 isso abre a roleta direto
}

function exitAdult() {
  if (!state.normal || state.busy) return;
  closeViewer();
  Object.assign(state, state.normal, { adult: false, normal: null, genre: null, pool: [] });
  document.body.classList.remove('adult', 'armed', 'blur-covers');
  showHome();
}

// +18: a home já é a roleta, com todos os jogos (ou só os do filtro escolhido)
function adultAll() { return { id: 'todos', label: 'Todos', count: state.games.length }; }
function showAdultRoulette(genre) {
  if (!state.games.length) {
    state.view = 'home';
    $back.hidden = true;
    mount(h('section', {},
      h('div', { class: 'state-msg' }, 'Ainda não há jogos +18 catalogados.', h('br'), h('small', {}, 'A lista é montada pelo robô diário. Volte depois da próxima atualização.')),
      h('button', { class: 'exit-adult', style: 'display:block;margin:0 auto', onclick: exitAdult }, 'Sair do +18'),
    ));
    return;
  }
  state.genre = genre || state.genre || adultAll();
  const avail = availableFor(state.genre);
  state.pool = sample(avail, Math.min(state.adultQty || ADULT_DEFAULT_QTY, avail.length));
  showSpin();
}

function adultHead(n) {
  const chips = [adultAll(), ...state.genres];
  return h('div', { class: 'spin-head adult-head hide-rec' },
    h('div', { class: 'filters' },
      chips.map((g) => h('button', {
        class: 'chipbtn' + (state.genre?.id === g.id ? ' on' : ''),
        onclick: () => { if (!state.busy && state.genre?.id !== g.id) showAdultRoulette(g); },
      }, `${g.label} (${availableFor(g).length})`)),
    ),
    h('div', { class: 'adult-row' },
      h('span', { class: 'chip soft' }, `${n} na roleta`),
      h('button', { class: 'link', onclick: () => { if (!state.busy) openQty(); } }, 'alterar'),
      h('button', { class: 'exit-adult', onclick: exitAdult }, 'Sair do +18'),
    ),
  );
}

/* ==========================================================================
   Visualizador de prints em tela cheia (setas, teclado, deslize, toque fora fecha)
   ========================================================================== */
const hiRes = (u) => String(u).replace(/\.\d+x\d+(\.[a-z]+)$/i, '.1920x1080$1');
let viewer = null;

function openViewer(urls, start = 0) {
  closeViewer();
  const list = urls.filter(Boolean);
  if (!list.length) return;
  let i = Math.max(0, Math.min(start, list.length - 1));

  const low = h('img', { class: 'vwr-low', alt: '', draggable: 'false' });
  const hi = h('img', { class: 'vwr-hi', alt: 'Print do jogo', draggable: 'false' });
  const count = h('div', { class: 'vwr-count', 'aria-live': 'polite' });
  const prev = h('button', { class: 'vwr-nav prev', type: 'button', 'aria-label': 'Anterior' }, '‹');
  const next = h('button', { class: 'vwr-nav next', type: 'button', 'aria-label': 'Próximo' }, '›');
  const close = h('button', { class: 'vwr-close', type: 'button', 'aria-label': 'Fechar' }, '✕');
  const fig = h('div', { class: 'vwr-fig' }, low, hi);
  const root = h('div', { class: 'vwr', role: 'dialog', 'aria-label': 'Prints do jogo', 'aria-modal': 'true' }, fig, count, close, prev, next);

  function show(n) {
    i = (n + list.length) % list.length;
    const thumb = list[i];
    count.textContent = `${i + 1}/${list.length}`;
    prev.hidden = next.hidden = list.length < 2;
    hi.classList.remove('ok');
    low.src = thumb; // miniatura aparece na hora, o print grande entra por cima
    let tried = false;
    hi.onload = () => hi.classList.add('ok');
    hi.onerror = () => { if (!tried) { tried = true; hi.src = thumb; } else hi.classList.add('ok'); };
    hi.src = hiRes(thumb);
    for (const d of [1, -1]) { const im = new Image(); im.src = hiRes(list[(i + d + list.length) % list.length]); } // pré-carrega vizinhos
  }
  const go = (d) => show(i + d);

  prev.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  close.addEventListener('click', (e) => { e.stopPropagation(); closeViewer(); });
  root.addEventListener('click', (e) => { if (e.target === root || e.target === fig) closeViewer(); }); // toque fora da imagem

  // deslize
  let sx = 0; let sy = 0; let tracking = false;
  root.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; tracking = true; sx = e.clientX; sy = e.clientY; });
  root.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { go(dx < 0 ? 1 : -1); root.dataset.swiped = '1'; setTimeout(() => delete root.dataset.swiped, 50); }
  });
  root.addEventListener('pointercancel', () => { tracking = false; });
  root.addEventListener('click', (e) => { if (root.dataset.swiped) e.stopImmediatePropagation(); }, true);

  viewer = { root, go };
  stage.append(root);
  show(i);
  close.focus({ preventScroll: true });
}

function closeViewer() {
  if (!viewer) return;
  viewer.root.remove();
  viewer = null;
}

/* ---------- jogo compartilhado (#j=<id>) ---------- */
function showShared(g) {
  state.view = 'shared';
  state.busy = false;
  $back.hidden = false;
  mount(
    h('section', {},
      h('p', { class: 'shared-note hide-rec' }, 'Alguém sorteou este jogo na roleta:'),
      ...gameResult(g, null, { shared: true }),
    ),
  );
}

/* ---------- boas-vindas (só na primeira visita) ---------- */
function showWelcome() {
  if (store.get('welcomed', false)) return;
  const close = () => { store.set('welcomed', true); box.remove(); };
  const who = CREATOR.url
    ? h('a', { href: CREATOR.url, target: '_blank', rel: 'noopener' }, CREATOR.name)
    : h('b', {}, CREATOR.name);
  const box = h('div', { class: 'welcome', role: 'dialog', 'aria-label': 'Boas-vindas' },
    h('div', { class: 'welcome-card' },
      h('div', { class: 'welcome-title' }, 'Rola ', h('em', {}, 'e'), ' ', h('span', {}, 'Joga!')),
      h('p', { class: 'welcome-lead' }, 'Tem jogo demais e vontade de menos? A roleta decide por você.'),
      h('ol', { class: 'welcome-steps' },
        h('li', {}, h('b', {}, '1'), ' Escolha um gênero'),
        h('li', {}, h('b', {}, '2'), ' Gire a roleta'),
        h('li', {}, h('b', {}, '3'), ' Jogue o que sair'),
      ),
      h('button', { class: 'btn primary big', onclick: close }, 'Bora jogar'),
      h('p', { class: 'welcome-by' }, `${CREATOR.role}: `, who),
    ),
  );
  (modal.parentNode || document.body).append(box);
}

async function boot() {
  renderSound();
  mount(h('div', { class: 'state-msg' }, h('div', { class: 'loader' }), 'Carregando jogos…'));
  try {
    const [data, genres] = await Promise.all([
      loadJson(window.__GAMES__, 'data/games.json'),
      loadJson(window.__GENRES__, 'data/genres.json'),
    ]);
    state.meta = data.meta || {};
    state.games = (data.games || []).filter((g) => g && g.id && g.name && Array.isArray(g.genres));
    state.byId = new Map(state.games.map((g) => [g.id, g]));
    state.baseGenres = genres;
    state.genres = genres
      .map((g) => ({ ...g, count: state.games.filter((x) => x.genres.includes(g.id)).length }))
      .filter((g) => g.count > 0);
    if (!state.games.length) throw new Error('lista vazia');
    state.source = store.get('source', 'catalog') === 'library' && API_URL ? 'library' : 'catalog';
    showHome();
    initAds();
    // atalho dos guias: /#g=terror abre o sorteio do gênero
    const m = location.hash.match(/^#g=([a-z-]+)$/);
    const target = m && state.genres.find((g) => g.id === m[1]);
    if (target) { state.source = 'catalog'; showHome(); pickGenre(target); }
    // link do resultado: /#j=<id> abre o card do jogo sorteado
    const mj = location.hash.match(/^#j=(\d+)$/);
    const shared = mj && state.byId.get(+mj[1]);
    if (shared) { state.source = 'catalog'; showShared(shared); }
    showWelcome();
  } catch (e) {
    console.error(e);
    mount(
      h('div', { class: 'state-msg' },
        'Não consegui carregar a lista de jogos.',
        h('br'),
        h('small', {}, 'Se você abriu o arquivo direto do computador, rode "npm run serve" e acesse http://localhost:8080.'),
        h('br'),
        h('button', { class: 'btn', onclick: boot }, 'Tentar de novo'),
      ),
    );
  }
}

boot();
