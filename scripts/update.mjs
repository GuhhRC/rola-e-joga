#!/usr/bin/env node
/**
 * Atualiza data/games.json.
 *
 *  1) SteamSpy  -> lista de jogos por tag (filtra por nº de avaliações e % positiva)
 *  2) Loja Steam (appdetails) -> descrição, preço em R$, ano e Metacritic.
 *     Só busca jogos novos ou com dados antigos, respeitando o limite da Steam.
 *
 * Uso:
 *   node scripts/update.mjs              atualização completa (rede)
 *   node scripts/update.mjs --seed-only  gera games.json só com data/curated.json (sem rede)
 *
 * Ajustes por variável de ambiente: MIN_REVIEWS, MIN_APPROVAL, PER_GENRE,
 * MAX_DETAIL_FETCH, DETAIL_MAX_AGE_DAYS, TAG_DELAY_MS, DETAIL_DELAY_MS.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = {
  genres: path.join(ROOT, 'data/genres.json'),
  curated: path.join(ROOT, 'data/curated.json'),
  games: path.join(ROOT, 'data/games.json'),
};

const CFG = {
  minReviews: +process.env.MIN_REVIEWS || 500,
  minApproval: +process.env.MIN_APPROVAL || 70,
  perGenre: +process.env.PER_GENRE || 300,
  maxDetailFetch: +process.env.MAX_DETAIL_FETCH || 300,
  detailMaxAgeDays: +process.env.DETAIL_MAX_AGE_DAYS || 21,
  tagDelayMs: +process.env.TAG_DELAY_MS || 65000, // conservador: SteamSpy limita pedidos de tag
  detailDelayMs: +process.env.DETAIL_DELAY_MS || 1600, // ~200 pedidos a cada 5 min na loja
};
const SEED_ONLY = process.argv.includes('--seed-only');

const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'roleta-steam-updater/1.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(3000 * i);
    }
  }
}

async function writeGames(games, extraMeta = {}) {
  const sorted = [...games].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const genreCounts = {};
  for (const g of sorted) for (const id of g.genres) genreCounts[id] = (genreCounts[id] || 0) + 1;
  const meta = { updatedAt: new Date().toISOString(), count: sorted.length, genreCounts, ...extraMeta };
  // um jogo por linha: diffs legíveis no git
  const body = sorted.map((g) => JSON.stringify(g)).join(',\n');
  await writeFile(FILE.games, `{"meta":${JSON.stringify(meta)},"games":[\n${body}\n]}\n`);
  console.log(`games.json escrito: ${sorted.length} jogos`);
}

const clean = (g) => {
  const out = { ...g, genres: [...g.genres].sort() };
  delete out.curated;
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null) delete out[k];
  return out;
};

async function main() {
  const genres = await readJson(FILE.genres, []);
  const curated = await readJson(FILE.curated, []);
  const prev = await readJson(FILE.games, { games: [] });
  const prevGames = prev.games || [];
  const prevById = new Map(prevGames.map((g) => [g.id, g]));
  const byId = new Map();

  // cria/recupera o registro de um jogo, herdando dados do cache anterior (menos os gêneros)
  const touch = (id, name) => {
    let g = byId.get(id);
    if (!g) {
      const old = prevById.get(id) || {};
      g = { ...old, id, name: name || old.name || String(id), genres: new Set() };
      byId.set(id, g);
    }
    return g;
  };

  for (const c of curated) {
    const g = touch(c.id, c.n);
    c.g.forEach((x) => g.genres.add(x));
    g.curated = true;
  }

  if (SEED_ONLY) {
    await writeGames([...byId.values()].map(clean), { source: 'seed' });
    return;
  }

  // --- 1) SteamSpy por tag ------------------------------------------------
  const failed = new Set();
  for (const [i, genre] of genres.entries()) {
    try {
      const data = await getJson(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(genre.steamTag)}`);
      const list = Object.values(data || {})
        .map((x) => {
          const pos = x.positive | 0;
          const neg = x.negative | 0;
          const total = pos + neg;
          return { id: +x.appid, name: x.name, total, approval: total ? Math.round((100 * pos) / total) : 0 };
        })
        .filter((x) => x.id && x.total >= CFG.minReviews && x.approval >= CFG.minApproval)
        .sort((a, b) => b.total - a.total)
        .slice(0, CFG.perGenre);
      if (!list.length) throw new Error('lista vazia');
      for (const x of list) {
        const g = touch(x.id, x.name);
        g.genres.add(genre.id);
        g.reviews = x.total;
        g.approval = x.approval;
      }
      console.log(`[${genre.id}] ${list.length} jogos`);
    } catch (e) {
      failed.add(genre.id);
      console.warn(`[${genre.id}] falhou (${e.message}); mantendo lista anterior`);
    }
    if (i < genres.length - 1) await sleep(CFG.tagDelayMs);
  }
  // se um gênero falhou, não perde o que já tinha
  for (const gid of failed) {
    for (const old of prevGames) if (old.genres?.includes(gid)) touch(old.id, old.name).genres.add(gid);
  }

  // --- 2) Detalhes da loja (só quem é novo ou está velho) -------------------
  const now = new Date();
  const maxAge = CFG.detailMaxAgeDays * 864e5;
  const stale = (g) => !g.detailsAt || now - new Date(g.detailsAt) > maxAge;
  const queue = [...byId.values()]
    .filter(stale)
    .sort((a, b) => (a.detailsAt ? 1 : 0) - (b.detailsAt ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0))
    .slice(0, CFG.maxDetailFetch);

  const drop = new Set();
  let first = true;
  for (const g of queue) {
    if (!first) await sleep(CFG.detailDelayMs);
    first = false;
    try {
      const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${g.id}&cc=br&l=portuguese`);
      const r = j?.[g.id];
      if (!r) throw new Error('resposta vazia');
      if (!r.success) {
        drop.add(g.id);
        console.warn(`descartado (sem página na loja): ${g.id} ${g.name}`);
        continue;
      }
      const d = r.data;
      if (d.type !== 'game' || d.platforms?.windows === false || d.release_date?.coming_soon) {
        drop.add(g.id);
        continue;
      }
      g.name = d.name || g.name;
      g.desc = (d.short_description || '').replace(/\s+/g, ' ').trim().slice(0, 320);
      g.free = !!d.is_free;
      g.price = d.price_overview?.final_formatted || null;
      const year = (d.release_date?.date || '').match(/(?:19|20)\d{2}/);
      g.year = year ? +year[0] : null;
      g.metacritic = d.metacritic?.score ?? null;
      g.detailsAt = now.toISOString().slice(0, 10);
    } catch (e) {
      console.warn(`detalhes falharam para ${g.id} ${g.name}: ${e.message}`);
    }
  }

  // --- 3) Avaliações para a lista curada que ainda não tem ------------------
  const needSpy = [...byId.values()].filter((g) => g.reviews == null && !drop.has(g.id)).slice(0, 150);
  for (const g of needSpy) {
    try {
      const s = await getJson(`https://steamspy.com/api.php?request=appdetails&appid=${g.id}`);
      const pos = s.positive | 0;
      const neg = s.negative | 0;
      if (pos + neg > 0) {
        g.reviews = pos + neg;
        g.approval = Math.round((100 * pos) / (pos + neg));
      }
    } catch { /* tenta de novo na próxima semana */ }
    await sleep(1100);
  }

  // --- 4) Segurança antes de gravar -----------------------------------------
  const games = [...byId.values()].filter((g) => !drop.has(g.id) && g.genres.size > 0).map(clean);
  if (prevGames.length && games.length < prevGames.length * 0.5) {
    console.error(`Abortado: ${games.length} jogos contra ${prevGames.length} antes. Mantendo o arquivo anterior.`);
    process.exit(1);
  }
  await writeGames(games, { source: 'steamspy+steam' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
