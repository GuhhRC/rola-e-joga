'use strict';
/* Rola e Joga! — Home, catálogo e biblioteca por perfil
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

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
