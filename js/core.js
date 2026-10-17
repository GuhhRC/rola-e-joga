'use strict';
/* Rola e Joga! — Base: configuração, utilidades, estado, fontes de jogos, som e animação
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ---------- configuração ---------- */
const CFG = Object.assign(
  { siteName: 'Rola e Joga!', siteLabel: 'Rola e Joga!', siteUrl: '', apiUrl: '', ads: {}, affiliates: [] },
  window.ROLA_CONFIG || {},
);
const CREATOR = Object.assign({ name: '@opropriogustavo', role: 'Idealizador', url: 'https://www.instagram.com/opropriogustavo/' }, CFG.creator || {});
const API_URL = String(window.__API_URL__ || CFG.apiUrl || '').replace(/\/$/, '');
const ADS = CFG.ads || {};
const ADULT_BLUR_COVERS = CFG.adultBlurCovers === true; // capas do +18 borradas (padrão: livres)
const ADULT_BLUR_SHOTS = CFG.adultBlurShots === true; // miniaturas dos prints no +18 borradas (padrão: livres)
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
