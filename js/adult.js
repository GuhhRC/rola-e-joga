'use strict';
/* Rola e Joga! — Modo +18 escondido
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

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
  state.format = state.adultFmt;
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
