// Teste do atualizador com a rede simulada (nada vai para a Steam de verdade).
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(os.tmpdir(), 'rej-'));
Object.assign(process.env, { DATA_DIR: dir, TAG_DELAY_MS: '0', DETAIL_DELAY_MS: '0', SPY_DELAY_MS: '0', RATE_PAUSE_MS: '0', MAX_DETAIL: '6', MIN_REVIEWS: '500' });
const { main, parseDetail } = await import('./update.mjs');

/* ---- parseDetail ---- */
const base = { type: 'game', name: 'G', release_date: { coming_soon: false, date: '10 de mar. de 2020' }, genres: [{ id: '1', description: 'Ação' }], categories: [{ id: 38, description: 'Co-op online' }, { id: 2, description: 'Um jogador' }], platforms: { windows: true, mac: false, linux: true }, is_free: false, short_description: 'Oi  mundo', screenshots: [{ path_thumbnail: 'http://x/a.jpg?t=1' }], price_overview: { final_formatted: 'R$ 50,00', initial_formatted: 'R$ 100,00', discount_percent: 50 } };
assert.equal(parseDetail({ ...base, type: 'dlc' }, '2026-01-01').block, 'not_game');
assert.equal(parseDetail({ ...base, release_date: { coming_soon: true } }, '2026-01-01').block, 'unreleased');
assert.equal(parseDetail({ ...base, content_descriptors: { ids: [3] } }, '2026-01-01').block, 'adult');
assert.equal(parseDetail({ ...base, platforms: { windows: false } }, '2026-01-01').block, 'no_windows');
let p = parseDetail({ ...base, supported_languages: 'Inglês, Português do Brasil<strong>*</strong>, Francês' }, '2026-01-01');
assert.equal(p.detail.pt, 2);
p = parseDetail({ ...base, supported_languages: 'English, Portuguese - Brazil' }, '2026-01-01');
assert.equal(p.detail.pt, 1);
p = parseDetail({ ...base, supported_languages: 'English' }, '2026-01-01');
assert.equal(p.detail.pt, 0);
assert.ok(p.genres.has('acao') && p.genres.has('coop'));
assert.equal(p.slim.year, 2020);
assert.equal(p.detail.price.d, 50);
assert.equal(p.detail.shots[0], 'http://x/a.jpg');
assert.deepEqual(p.detail.plat, ['win', 'lin']);

/* ---- fluxo completo com fetch falso ---- */
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'genres.json'), JSON.stringify([{ id: 'acao', label: 'Ação', steamTag: 'Action' }, { id: 'terror', label: 'Terror', steamTag: 'Horror' }]));
await writeFile(path.join(dir, 'curated.json'), JSON.stringify([{ id: 1, n: 'Curado', g: ['acao'] }]));

const calls = { store: 0 };
let limitOnce = true;
const store = {
  10: { success: true, data: { ...base, name: 'Bom', supported_languages: 'Português do Brasil' } },
  11: { success: true, data: { ...base, type: 'dlc', name: 'Pacote' } },
  12: { success: true, data: { ...base, name: 'Adulto', content_descriptors: { ids: [4] } } },
  13: { success: false },
  14: { success: true, data: { ...base, name: 'Em breve', release_date: { coming_soon: true } } },
  1: { success: true, data: { ...base, name: 'Curado', genres: [{ id: '25', description: 'Aventura' }] } },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  const ok = (o) => ({ ok: true, status: 200, json: async () => o });
  if (u.includes('request=tag&tag=Action')) {
    const o = {};
    for (const id of [10, 11, 12, 13, 14, 15]) o[id] = { appid: id, name: 'App' + id, positive: 900, negative: 100, median_forever: 120 };
    o[99] = { appid: 99, name: 'Poucas', positive: 5, negative: 0 };
    return ok(o);
  }
  if (u.includes('request=tag')) return ok({ 10: { appid: 10, name: 'App10', positive: 900, negative: 100 } });
  if (u.includes('request=appdetails')) return ok({ positive: 90, negative: 10, median_forever: 300, tags: { Terror: 100, Indie: 50 } });
  if (u.includes('appdetails?appids=')) {
    calls.store++;
    assert.ok(u.includes('l=brazilian'), 'idioma pt-BR');
    const id = +u.match(/appids=(\d+)/)[1];
    if (limitOnce && id === 10) { limitOnce = false; return { ok: false, status: 429, json: async () => ({}) }; }
    return ok({ [id]: store[id] || { success: false } });
  }
  throw new Error('url inesperada ' + u);
};

await main([]);
const games = JSON.parse(await readFile(path.join(dir, 'games.json'), 'utf8'));
const ids = games.games.map((g) => g.id).sort((a, b) => a - b);
assert.deepEqual(ids, [1, 10], 'só curado e jogo válido entram');
const g10 = games.games.find((g) => g.id === 10);
assert.equal(g10.pt, 1);
assert.ok(g10.genres.includes('terror') && g10.genres.includes('acao'), 'gênero extra via tag');
assert.equal(g10.med, 300);
const blocked = JSON.parse(await readFile(path.join(dir, 'blocked.json'), 'utf8'));
assert.equal(blocked[11].r, 'not_game');
assert.equal(blocked[12].r, 'adult');
assert.equal(blocked[13].r, 'no_store_page');
assert.equal(blocked[14].r, 'unreleased');
const sh = JSON.parse(await readFile(path.join(dir, 'details', '10.json'), 'utf8'));
assert.ok(sh['10'].tags.includes('Terror'));
const pend = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8'));
assert.deepEqual(pend.map((x) => x.id), [15], 'candidato não buscado fica pendente');

/* ---- segunda execução: incremental, não repete ---- */
const before = calls.store;
await main([]);
assert.equal(calls.store - before, 1, 'só o pendente 15 é consultado');
/* ---- trava de segurança: índice encolhendo ---- */
process.env.MAX_DETAIL = '500';
const fake = Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i, name: 'x' + i, genres: ['acao'] }));
await writeFile(path.join(dir, 'curated.json'), JSON.stringify(fake.map((f) => ({ id: f.id, n: f.name, g: f.genres }))));
await writeFile(path.join(dir, 'games.json'), JSON.stringify({ meta: { discoveredAt: new Date().toISOString() }, games: fake }));
await writeFile(path.join(dir, 'pending.json'), '[]');
const prevExit = process.exit;
process.exit = (c) => { throw new Error('exit ' + c); };
await assert.rejects(() => main([]), /exit 1/);
process.exit = prevExit;
console.log('update: ok');
