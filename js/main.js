'use strict';
/* Rola e Joga! — Jogo compartilhado, boas-vindas e início (boot). Tem que ser o ÚLTIMO script.
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   Início
   ========================================================================== */
async function loadJson(inline, url) {
  if (inline) return inline;
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r.json();
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
