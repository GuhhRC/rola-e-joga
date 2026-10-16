#!/usr/bin/env node
/**
 * Atualiza a base de jogos (rodado pelo GitHub Actions, uma vez por dia).
 *
 * Saídas (pasta data/):
 *   games.json         índice enxuto, usado pela roleta (carrega rápido)
 *   details/NN.json    detalhes completos, em 100 arquivos (id % 100); o card carrega só o arquivo do jogo sorteado
 *   blocked.json       jogos que não entram (DLC, adulto, não lançado...), para não consultar de novo
 *
 * Etapas:
 *   1) Descoberta (SteamSpy, por tag): lista candidatos com avaliações. Roda se passou 7 dias (ou --discover).
 *   2) Detalhes (loja Steam, em português do Brasil): preço em R$, idiomas, devs, prints, etc.
 *      É incremental: cada execução busca no máximo MAX_DETAIL jogos novos ou desatualizados,
 *      então a base cresce ao longo dos dias sem estourar o limite da Steam.
 *   3) Tags (SteamSpy por jogo): tags principais e gêneros extras. Também incremental.
 *
 * Uso:
 *   node scripts/update.mjs              atualização normal
 *   node scripts/update.mjs --discover   força a descoberta
 *   node scripts/update.mjs --seed-only  só a lista curada, sem rede
 *
 * Variáveis de ambiente (todas opcionais): MIN_REVIEWS, MIN_APPROVAL, PER_GENRE, MAX_DETAIL, MAX_SPY,
 * DETAIL_MAX_AGE_DAYS, DISCOVER_EVERY_DAYS, DEADLINE_MIN, TAG_DELAY_MS, DETAIL_DELAY_MS, SPY_DELAY_MS,
 * RATE_PAUSE_MS, DATA_DIR.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHARDS = 100;

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(+v) ? +v : d);
function settings() {
  const e = process.env;
  return {
    data: e.DATA_DIR ? path.resolve(e.DATA_DIR) : path.join(ROOT, 'data'),
    minReviews: num(e.MIN_REVIEWS, 500),
    minApproval: num(e.MIN_APPROVAL, 70),
    perGenre: num(e.PER_GENRE, 600),
    maxDetail: num(e.MAX_DETAIL, 1500),
    maxSpy: num(e.MAX_SPY, 500),
    detailMaxAgeDays: num(e.DETAIL_MAX_AGE_DAYS, 30),
    discoverEveryDays: num(e.DISCOVER_EVERY_DAYS, 7),
    deadlineMin: num(e.DEADLINE_MIN, 150),
    tagDelayMs: num(e.TAG_DELAY_MS, 65000), // SteamSpy limita pedidos de lista a ~1 por minuto
    detailDelayMs: num(e.DETAIL_DELAY_MS, 1600), // ~200 pedidos a cada 5 min na loja
    spyDelayMs: num(e.SPY_DELAY_MS, 1100),
    ratePauseMs: num(e.RATE_PAUSE_MS, 330000),
    catalogAdult: e.CATALOG_ADULT !== '0', // catálogo +18 separado; nunca entra na roleta
    adultMinReviews: num(e.ADULT_MIN_REVIEWS, 100),
    adultPerTag: num(e.ADULT_PER_TAG, 800),
    maxAdult: num(e.MAX_ADULT, 500),
    smallGenreBelow: num(e.SMALL_GENRE_BELOW, 200), // gênero com menos jogos que isso ganha filtro de avaliações mais folgado
  };
}

/* ---------- mapeamentos ---------- */
// ids de gênero da loja Steam → nossos gêneros
const STORE_GENRE = { 1: 'acao', 2: 'estrategia', 3: 'rpg', 9: 'corrida', 23: 'indie', 25: 'aventura', 28: 'simulacao' };
const COOP_CATS = new Set([9, 38, 39]); // Co-op, Co-op online, Co-op em tela dividida
const SHOW_CATS = new Set([1, 2, 9, 24, 28, 36, 37, 38, 39]); // categorias mostradas no card (texto vem da própria Steam)
const ADULT_DESCRIPTORS = [3, 4]; // conteúdo sexual adulto / nudez frequente
const ADULT_GENRES = [71, 72]; // Sexual Content, Nudity
export const ADULT_TAGS = ['Sexual Content', 'Hentai', 'Nudity']; // tags do SteamSpy do catálogo +18

/**
 * Decide se um jogo é "+18" pelos votos de tags do SteamSpy ({tag: votos}).
 * Jogos comuns costumam ter "Nudity" ou "Sexual Content" com votos, mas bem abaixo das tags principais
 * (ex.: The Witcher 3 tem Nudity em 9º lugar). Jogo adulto tem essas tags no topo (ex.: Celesphonia: Sexual Content em 1º).
 * Aceita se Hentai ou Sexual Content estão entre as 5 mais votadas, ou se 2 ou mais tags sexuais estão entre as 8 mais votadas.
 */
const SEX_TAGS = ['sexual content', 'hentai', 'nudity', 'nsfw'];
const CANON = { 'sexual content': 'Sexual Content', hentai: 'Hentai', nudity: 'Nudity' };
export function adultByTags(votes, minVotes = 30) {
  if (!votes || Array.isArray(votes)) return { ok: false, tags: [] };
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([n, v]) => [String(n).toLowerCase(), v | 0]);
  const top8 = ranked.slice(0, 8).filter(([n, v]) => SEX_TAGS.includes(n) && v >= minVotes);
  const top5 = ranked.slice(0, 5).filter(([n, v]) => (n === 'hentai' || n === 'sexual content') && v >= minVotes);
  const ok = top5.length > 0 || top8.length >= 2;
  const tags = top8.map(([n]) => CANON[n]).filter(Boolean);
  return { ok, tags: tags.length ? [...new Set(tags)] : ok ? ['Sexual Content'] : [] };
}

class RateLimited extends Error {}
const tagsOf = (g) => (Array.isArray(g.steamTags) && g.steamTags.length ? g.steamTags : [g.steamTag]).filter(Boolean);
const parseSpyList = (data, minReviews, minApproval) => Object.values(data || {}).map((x) => {
  const pos = x.positive | 0;
  const total = pos + (x.negative | 0);
  return { id: +x.appid, name: x.name, total, approval: total ? Math.round((100 * pos) / total) : 0, med: x.median_forever | 0 };
}).filter((x) => x.id && x.name && x.total >= minReviews && x.approval >= minApproval).sort((a, b) => b.total - a.total);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; }
};
const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'rola-e-joga-updater/2.0' } });
    } catch (e) {
      if (i === tries) throw e;
      await sleep(2000 * i);
      continue;
    }
    if (res.status === 429 || res.status === 403) throw new RateLimited(url);
    if (!res.ok) {
      if (i === tries) throw new Error('HTTP ' + res.status);
      await sleep(2000 * i);
      continue;
    }
    return res.json();
  }
}

/* ---------- interpretação da resposta da loja ---------- */
export function parseDetail(d, today) {
  if (!d || d.type !== 'game') return { block: 'not_game' };
  if (d.release_date?.coming_soon) return { block: 'unreleased', until: addDays(today, 14) };
  const gids = (d.genres || []).map((g) => +g.id);
  const cds = (d.content_descriptors?.ids || []).map(Number);
  const slimBase = { name: d.name || undefined, year: ((String(d.release_date?.date || '').match(/(?:19|20)\d{2}/) || [])[0]) ? +String(d.release_date.date).match(/(?:19|20)\d{2}/)[0] : undefined, free: d.is_free ? 1 : undefined, price: d.price_overview?.final_formatted };
  const isAdult = ADULT_DESCRIPTORS.some((x) => cds.includes(x)) || ADULT_GENRES.some((x) => gids.includes(x));
  if (isAdult) return { block: 'adult', adult: slimBase, windows: d.platforms?.windows !== false };
  if (d.platforms && d.platforms.windows === false) return { block: 'no_windows' };

  const cats = d.categories || [];
  const catIds = cats.map((c) => +c.id);
  const genres = new Set();
  for (const id of gids) if (STORE_GENRE[id]) genres.add(STORE_GENRE[id]);
  if (COOP_CATS.size && catIds.some((i) => COOP_CATS.has(i))) genres.add('coop');

  // idioma português do Brasil; o asterisco logo depois do nome indica narração completa
  const sl = String(d.supported_languages || '');
  const m = sl.match(/(Portugu[eê]s[^,<]*Brasil|Portuguese[^,<]*Brazil)(\s*<strong>\s*\*\s*<\/strong>)?/i);
  const pt = m ? (m[2] ? 2 : 1) : 0;

  const year = (String(d.release_date?.date || '').match(/(?:19|20)\d{2}/) || [])[0];
  const po = d.price_overview;
  const price = po && po.final_formatted
    ? { f: po.final_formatted, i: po.discount_percent > 0 ? po.initial_formatted || null : null, d: po.discount_percent || 0 }
    : null;

  const detail = {
    at: today,
    desc: String(d.short_description || '').replace(/\s+/g, ' ').trim().slice(0, 400) || undefined,
    dev: (d.developers || []).slice(0, 3),
    pub: (d.publishers || []).slice(0, 3),
    rel: d.release_date?.date || undefined,
    sg: (d.genres || []).map((g) => g.description).filter(Boolean).slice(0, 6),
    cats: cats.filter((c) => SHOW_CATS.has(+c.id)).map((c) => c.description).slice(0, 6),
    pt,
    plat: ['windows', 'mac', 'linux'].filter((p) => d.platforms?.[p]).map((p) => p.slice(0, 3)),
    shots: (d.screenshots || []).slice(0, 4).map((s) => String(s.path_thumbnail || '').split('?')[0]).filter(Boolean),
    mc: d.metacritic?.score || undefined,
    recs: d.recommendations?.total || undefined,
    price: price || undefined,
    free: d.is_free ? 1 : undefined,
    age: +d.required_age > 0 ? +d.required_age : undefined,
    ctrl: d.controller_support || undefined,
    dlc: Array.isArray(d.dlc) && d.dlc.length ? d.dlc.length : undefined,
  };
  for (const k of Object.keys(detail)) {
    const v = detail[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) delete detail[k];
  }
  return {
    detail,
    genres,
    adultSlim: slimBase,
    slim: { name: d.name || undefined, year: year ? +year : undefined, free: d.is_free ? 1 : undefined, price: price?.f, pt },
  };
}

/* ---------- gravação ---------- */
function slimOf(rec) {
  const o = {
    id: rec.id,
    name: rec.name,
    genres: [...rec.genres].sort(),
    approval: rec.approval,
    reviews: rec.reviews,
    year: rec.year,
    free: rec.free,
    price: rec.price,
    pt: rec.pt,
    med: rec.med,
  };
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

async function writeAll(S, records, details, blocked, meta, pending = new Map(), adult = new Map(), rejected = {}) {
  await mkdir(path.join(S.data, 'details'), { recursive: true });
  const slim = [...records.values()].map(slimOf).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const genreCounts = {};
  for (const g of slim) for (const id of g.genres) genreCounts[id] = (genreCounts[id] || 0) + 1;
  const fullMeta = { ...meta, updatedAt: new Date().toISOString(), count: slim.length, genreCounts, detailed: details.size };
  // um jogo por linha: diffs legíveis no git
  await writeFile(path.join(S.data, 'games.json'), `{"meta":${JSON.stringify(fullMeta)},"games":[\n${slim.map((g) => JSON.stringify(g)).join(',\n')}\n]}\n`);

  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const [id, d] of details) if (records.has(id)) shards[id % SHARDS][id] = d;
  await Promise.all(shards.map((sh, n) => {
    const keys = Object.keys(sh).sort((a, b) => +a - +b);
    const body = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(sh[k])}`).join(',\n');
    return writeFile(path.join(S.data, 'details', String(n).padStart(2, '0') + '.json'), `{\n${body}\n}\n`);
  }));
  await writeFile(path.join(S.data, 'blocked.json'), JSON.stringify(blocked, null, 0) + '\n');
  // catálogo +18: separado da roleta, só ids e números
  const adl = [...adult.values()].sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  await writeFile(path.join(S.data, 'adult.json'), `{"meta":${JSON.stringify({ updatedAt: new Date().toISOString(), count: adl.length, confirmed: adl.filter((g) => g.v).length })},"rejected":${JSON.stringify(rejected)},"games":[\n${adl.map((g) => JSON.stringify(g)).join(',\n')}\n]}\n`);
  // candidatos ainda sem detalhes: ficam guardados para as próximas execuções (não aparecem na roleta)
  const pend = [...pending.values()].map(slimOf).sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  await writeFile(path.join(S.data, 'pending.json'), `[\n${pend.map((g) => JSON.stringify(g)).join(',\n')}\n]\n`);
  log(`gravado: ${slim.length} jogos no índice, ${details.size} com detalhes`);
}

async function loadDetails(S) {
  const map = new Map();
  for (let n = 0; n < SHARDS; n++) {
    const sh = await readJson(path.join(S.data, 'details', String(n).padStart(2, '0') + '.json'), {});
    for (const [id, d] of Object.entries(sh)) map.set(+id, d);
  }
  return map;
}

/* ---------- principal ---------- */
export async function main(argv = process.argv.slice(2)) {
  const S = settings();
  const today = new Date().toISOString().slice(0, 10);
  const deadline = Date.now() + S.deadlineMin * 60000;
  const timeUp = () => Date.now() > deadline;

  const genres = await readJson(path.join(S.data, 'genres.json'), []);
  const curated = await readJson(path.join(S.data, 'curated.json'), []);
  const prev = await readJson(path.join(S.data, 'games.json'), { meta: {}, games: [] });
  const details = await loadDetails(S);
  const blocked = await readJson(path.join(S.data, 'blocked.json'), {});
  const prevPending = await readJson(path.join(S.data, 'pending.json'), []);
  const adultFile = await readJson(path.join(S.data, 'adult.json'), { games: [] });
  const adult = new Map((adultFile.games || []).filter((g) => g?.id && g.name).map((g) => [g.id, g]));
  // entradas antigas, confirmadas só pela tag (sem o selo da própria Steam), voltam para a fila de conferência
  for (const e of adult.values()) if (!e.f) delete e.v;
  const rejected = { ...(adultFile.rejected || {}) };
  const isRejected = (id) => rejected[id] && (Date.now() - new Date(rejected[id])) / 864e5 < 90;

  // registros em memória, a partir do índice anterior (descarta campos do formato antigo)
  const records = new Map();
  for (const g of [...(prev.games || []), ...prevPending]) {
    if (!g?.id || !g.name || !Array.isArray(g.genres)) continue;
    records.set(g.id, {
      id: g.id, name: g.name, genres: new Set(g.genres),
      approval: g.approval, reviews: g.reviews, year: g.year, free: g.free, price: g.price, pt: g.pt, med: g.med,
    });
  }
  const touch = (id, name) => {
    let r = records.get(id);
    if (!r) { r = { id, name: name || String(id), genres: new Set() }; records.set(id, r); }
    return r;
  };
  const curatedIds = new Set();
  for (const c of curated) {
    const r = touch(c.id, c.n);
    c.g.forEach((x) => r.genres.add(x));
    curatedIds.add(c.id);
  }

  if (argv.includes('--seed-only')) {
    const pend = new Map();
    for (const r of [...records.values()]) if (!curatedIds.has(r.id) && !details.has(r.id)) { pend.set(r.id, r); records.delete(r.id); }
    await writeAll(S, records, details, blocked, { source: 'seed' }, pend, adult, rejected);
    return;
  }

  const meta = { ...(prev.meta || {}), source: 'steamspy+steam' };

  /* 1) descoberta (por gênero: quem falhou é tentado de novo na próxima execução) */
  const force = argv.includes('--discover');
  const weekOld = (iso) => !iso || (Date.now() - new Date(iso)) / 864e5 >= S.discoverEveryDays;
  meta.genreAt = { ...(meta.genreAt || {}) };
  meta.adultAt = { ...(meta.adultAt || {}) };
  const dueGenres = genres.filter((g) => force || weekOld(meta.genreAt[g.id]));
  const dueAdult = S.catalogAdult ? ADULT_TAGS.filter((t) => force || weekOld(meta.adultAt[t])) : [];
  let spyCalls = 0;
  const spyList = async (tag) => {
    if (spyCalls++ > 0) await sleep(S.tagDelayMs);
    return getJson(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(tag)}`);
  };
  if (dueGenres.length || dueAdult.length) {
    log(`== descoberta (SteamSpy): ${dueGenres.length} gêneros, ${dueAdult.length} tags +18 ==`);
    for (const genre of dueGenres) {
      if (timeUp()) { log('tempo esgotado na descoberta'); break; }
      const merged = new Map();
      for (const tag of tagsOf(genre)) {
        if (timeUp()) break;
        try {
          const data = await spyList(tag);
          for (const x of parseSpyList(data, S.minReviews, S.minApproval)) merged.set(x.id, x);
          // gênero pequeno: afrouxa o mínimo de avaliações para a lista não ficar minúscula
          if (merged.size < S.smallGenreBelow) {
            const soft = Math.max(100, Math.round(S.minReviews / 3));
            for (const x of parseSpyList(data, soft, S.minApproval)) if (!merged.has(x.id)) merged.set(x.id, x);
          }
        } catch (e) {
          log(`[${genre.id}] tag "${tag}" falhou (${e.message})`);
        }
      }
      const list = [...merged.values()].sort((a, b) => b.total - a.total).slice(0, S.perGenre);
      if (!list.length) { log(`[${genre.id}] sem resultado; tenta de novo na próxima execução`); continue; }
      for (const x of list) {
        const r = touch(x.id, x.name);
        r.genres.add(genre.id);
        r.reviews = x.total;
        r.approval = x.approval;
        if (x.med) r.med = x.med;
      }
      meta.genreAt[genre.id] = new Date().toISOString();
      log(`[${genre.id}] ${list.length} jogos`);
    }
    // catálogo +18: só guarda ids e números; não entra na roleta
    for (const tag of dueAdult) {
      if (timeUp()) break;
      try {
        const data = await spyList(tag);
        const list = parseSpyList(data, S.adultMinReviews, S.minApproval).slice(0, S.adultPerTag);
        if (!list.length) throw new Error('lista vazia');
        for (const x of list) {
          if (isRejected(x.id)) continue;
          const e = adult.get(x.id) || { id: x.id, name: x.name };
          e.tags = [...new Set([...(e.tags || []), tag])];
          e.reviews = x.total;
          e.approval = x.approval;
          adult.set(x.id, e);
        }
        meta.adultAt[tag] = new Date().toISOString();
        log(`[+18 ${tag}] ${list.length} jogos`);
      } catch (e) {
        log(`[+18 ${tag}] falhou (${e.message})`);
      }
    }
    meta.discoveredAt = new Date().toISOString();
  } else {
    log('descoberta pulada (tudo em dia)');
  }

  /* 2) detalhes da loja */
  log('== detalhes (loja Steam) ==');
  const isBlocked = (id) => blocked[id] && (!blocked[id].until || blocked[id].until > today);
  const stale = (d) => !d || (Date.now() - new Date(d.at)) / 864e5 > S.detailMaxAgeDays;
  const queue = [...records.values()]
    .filter((r) => !isBlocked(r.id) && stale(details.get(r.id)))
    .sort((a, b) => {
      const da = details.get(a.id);
      const db = details.get(b.id);
      if (!da !== !db) return da ? 1 : -1; // quem não tem detalhe vem primeiro
      const wa = curatedIds.has(a.id) ? 1e12 : a.reviews || 0;
      const wb = curatedIds.has(b.id) ? 1e12 : b.reviews || 0;
      return wb - wa;
    })
    .slice(0, S.maxDetail);
  log(`${queue.length} jogos na fila de hoje`);

  let fetched = 0;
  let rateStrikes = 0;
  for (let k = 0; k < queue.length; k++) {
    if (timeUp()) { log('tempo esgotado nos detalhes'); break; }
    const rec = queue[k];
    if (k > 0) await sleep(S.detailDelayMs);
    let abort = false;
    for (;;) {
      try {
        const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${rec.id}&cc=br&l=brazilian`);
        rateStrikes = 0;
        const r = j?.[rec.id];
        if (!r) throw new Error('resposta vazia');
        if (!r.success) { blocked[rec.id] = { r: 'no_store_page', until: addDays(today, 30) }; records.delete(rec.id); details.delete(rec.id); break; }
        const p = parseDetail(r.data, today);
        if (p.block) {
          blocked[rec.id] = { r: p.block, ...(p.until ? { until: p.until } : {}) };
          if (p.block === 'adult' && S.catalogAdult && p.windows) {
            const old = adult.get(rec.id) || {};
            adult.set(rec.id, { ...old, id: rec.id, name: p.adult.name || rec.name, reviews: rec.reviews ?? old.reviews, approval: rec.approval ?? old.approval, year: p.adult.year, free: p.adult.free, price: p.adult.price, v: today, f: 1 });
            delete rejected[rec.id];
          }
          if (!curatedIds.has(rec.id) || p.block === 'adult') { records.delete(rec.id); details.delete(rec.id); }
          break;
        }
        const oldTags = details.get(rec.id)?.tags;
        details.set(rec.id, { ...p.detail, ...(oldTags ? { tags: oldTags } : {}) });
        for (const g of p.genres) rec.genres.add(g);
        Object.assign(rec, Object.fromEntries(Object.entries(p.slim).filter(([, v]) => v !== undefined)));
        fetched++;
        break;
      } catch (e) {
        if (e instanceof RateLimited) {
          rateStrikes++;
          if (rateStrikes >= 3) { log('a Steam bloqueou 3 vezes seguidas; encerrando esta etapa'); abort = true; break; }
          log(`limite da Steam; pausa de ${Math.round(S.ratePauseMs / 1000)}s`);
          await sleep(S.ratePauseMs);
          continue;
        }
        log(`detalhes falharam para ${rec.id} ${rec.name}: ${e.message}`);
        break;
      }
    }
    if (abort) break;
  }
  log(`detalhes buscados: ${fetched}`);

  /* 2b) confirma os candidatos do catálogo +18 na loja (só nome, ano e preço; sem descrição nem imagens) */
  if (S.catalogAdult) {
    const aq = [...adult.values()]
      .filter((e) => !e.v && !isRejected(e.id) && !(blocked[e.id] && blocked[e.id].r !== 'adult' && isBlocked(e.id)))
      .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
      .slice(0, S.maxAdult);
    log(`== catálogo +18: ${aq.length} para confirmar ==`);
    let strikes = 0;
    let okAdult = 0;
    for (const [k, e] of aq.entries()) {
      if (timeUp()) break;
      if (k > 0) await sleep(S.detailDelayMs);
      let r;
      for (;;) {
        try {
          const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${e.id}&cc=br&l=brazilian`);
          strikes = 0;
          r = j?.[e.id];
          break;
        } catch (err) {
          if (err instanceof RateLimited) {
            if (++strikes >= 3) { log('a Steam bloqueou 3 vezes seguidas; encerrando o catálogo +18'); r = 'abort'; break; }
            await sleep(S.ratePauseMs);
            continue;
          }
          r = null;
          break;
        }
      }
      if (r === 'abort') break;
      if (!r) continue;
      if (!r.success) { adult.delete(e.id); blocked[e.id] = { r: 'no_store_page', until: addDays(today, 30) }; continue; }
      const p = parseDetail(r.data, today);
      if (p.block && p.block !== 'adult') {
        adult.delete(e.id);
        blocked[e.id] = { r: p.block, ...(p.until ? { until: p.until } : {}) };
        continue;
      }
      if (p.block === 'adult' && !p.windows) { adult.delete(e.id); continue; }
      // só entra quem a própria Steam marca como conteúdo sexual/nudez frequente.
      // Estar nas listas de tags do SteamSpy não basta (jogos comuns recebem votos de brincadeira).
      let flag = 1;
      if (!p.block) {
        // sem selo da Steam: só entra se os votos de tags mostram conteúdo sexual como característica principal
        let tg = null;
        try {
          await sleep(S.spyDelayMs);
          const sp = await getJson(`https://steamspy.com/api.php?request=appdetails&appid=${e.id}`);
          tg = adultByTags(sp.tags);
        } catch (err) {
          if (err instanceof RateLimited) { log('SteamSpy pediu pausa; encerrando o catálogo +18'); break; }
          continue; // tenta de novo amanhã
        }
        if (!tg.ok) { adult.delete(e.id); rejected[e.id] = today; continue; }
        flag = 2;
        e.tags = tg.tags;
      }
      Object.assign(e, { name: (p.block ? p.adult : p.adultSlim).name || e.name, year: (p.block ? p.adult : p.adultSlim).year, free: (p.block ? p.adult : p.adultSlim).free, price: (p.block ? p.adult : p.adultSlim).price, v: today, f: flag });
      for (const key of Object.keys(e)) if (e[key] === undefined) delete e[key];
      okAdult++;
    }
    log(`+18 confirmados: ${okAdult}`);
  }

  /* 2c) jogos que já tinham tags guardadas (sem votos): aplica a mesma regra pela ordem das tags */
  if (S.catalogAdult) {
    let moved = 0;
    for (const rec of [...records.values()]) {
      const tg = details.get(rec.id)?.tags;
      if (!tg?.length || curatedIds.has(rec.id)) continue;
      const at = adultByTags(Object.fromEntries(tg.map((n, i) => [n, 1000 - i])));
      if (!at.ok) continue;
      adult.set(rec.id, { ...(adult.get(rec.id) || {}), id: rec.id, name: rec.name, tags: at.tags, reviews: rec.reviews, approval: rec.approval, year: rec.year, free: rec.free, price: rec.price, v: today, f: 2 });
      delete rejected[rec.id];
      blocked[rec.id] = { r: 'adult' };
      records.delete(rec.id);
      details.delete(rec.id);
      moved++;
    }
    if (moved) log(`movidos da roleta normal para o +18 pelas tags: ${moved}`);
  }

  /* 3) tags e avaliações por jogo (SteamSpy) */
  log('== tags (SteamSpy) ==');
  const tagToGenre = new Map(genres.flatMap((g) => tagsOf(g).map((t) => [t.toLowerCase(), g.id])));
  const needSpy = [...records.values()]
    .filter((r) => details.has(r.id) && (!details.get(r.id).tags || r.reviews == null))
    .sort((a, b) => (a.reviews == null ? 0 : 1) - (b.reviews == null ? 0 : 1) || (b.reviews || 0) - (a.reviews || 0))
    .slice(0, S.maxSpy);
  let spied = 0;
  for (const [k, rec] of needSpy.entries()) {
    if (timeUp()) { log('tempo esgotado nas tags'); break; }
    if (k > 0) await sleep(S.spyDelayMs);
    try {
      const s = await getJson(`https://steamspy.com/api.php?request=appdetails&appid=${rec.id}`);
      const pos = s.positive | 0;
      const total = pos + (s.negative | 0);
      if (total > 0) { rec.reviews = total; rec.approval = Math.round((100 * pos) / total); }
      if (s.median_forever) rec.med = s.median_forever | 0;
      const names = s.tags && !Array.isArray(s.tags)
        ? Object.entries(s.tags).sort((a, b) => b[1] - a[1]).map(([n]) => n)
        : [];
      // jogo da roleta normal cujas tags principais são sexuais: vai para o catálogo +18
      const at = S.catalogAdult && !curatedIds.has(rec.id) ? adultByTags(s.tags) : null;
      if (at?.ok) {
        adult.set(rec.id, { ...(adult.get(rec.id) || {}), id: rec.id, name: rec.name, tags: at.tags, reviews: rec.reviews, approval: rec.approval, year: rec.year, free: rec.free, price: rec.price, v: today, f: 2 });
        delete rejected[rec.id];
        blocked[rec.id] = { r: 'adult' };
        records.delete(rec.id);
        details.delete(rec.id);
        spied++;
        continue;
      }
      const d = details.get(rec.id);
      d.tags = names.slice(0, 8);
      for (const n of names.slice(0, 12)) {
        const gid = tagToGenre.get(n.toLowerCase());
        if (gid) rec.genres.add(gid);
      }
      spied++;
    } catch (e) {
      if (e instanceof RateLimited) { log('SteamSpy pediu pausa; encerrando esta etapa'); break; }
      /* tenta de novo amanhã */
    }
  }
  log(`tags buscadas: ${spied}`);

  /* 4) só entram na roleta jogos curados ou com detalhes confirmados (filtra DLC, software etc.) */
  const pending = new Map();
  for (const r of [...records.values()]) {
    if (adult.get(r.id)?.v && adult.get(r.id).f === 2 && !curatedIds.has(r.id)) records.delete(r.id);
    else if (isBlocked(r.id) && !curatedIds.has(r.id)) records.delete(r.id);
    else if (!curatedIds.has(r.id) && !details.has(r.id)) { pending.set(r.id, r); records.delete(r.id); }
    else if (!r.genres.size) records.delete(r.id);
  }
  const prevCount = (prev.games || []).length;
  if (prevCount && records.size < prevCount * 0.5) {
    console.error(`Abortado: ${records.size} jogos contra ${prevCount} antes. Mantendo os arquivos anteriores.`);
    process.exit(1);
  }
  await writeAll(S, records, details, blocked, meta, pending, adult, rejected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
