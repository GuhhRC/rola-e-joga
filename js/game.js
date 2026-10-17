'use strict';
/* Rola e Joga! — Quantidade, giro, afiliados, detalhes, card do resultado e roleta de gêneros
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

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
