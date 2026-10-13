// Testa o Worker com uma Steam simulada (sem rede). Rodar: node worker/test.mjs
import assert from 'node:assert/strict';
import worker, { parseProfile } from './index.js';

const ID = '76561198000000001';
let steam; // cenário atual
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  assert.ok(url.searchParams.get('key') === 'KEY', 'a chave deve ir em todas as chamadas');
  const p = url.pathname;
  const j = (o, status = 200) => new Response(JSON.stringify(o), { status });
  if (steam.status) return j({}, steam.status);
  if (p.includes('ResolveVanityURL')) return j({ response: steam.vanity ?? { success: 42 } });
  if (p.includes('GetPlayerSummaries')) return j({ response: { players: steam.player ? [steam.player] : [] } });
  if (p.includes('GetOwnedGames')) return j({ response: steam.owned ?? {} });
  throw new Error('chamada inesperada ' + p);
};

const call = async (qs, env = { STEAM_API_KEY: 'KEY' }, method = 'GET', headers = {}) => {
  const res = await worker.fetch(new Request('https://api.test/api/library' + qs, { method, headers }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};
const pub = { personaname: 'Fulano', communityvisibilitystate: 3 };

// parseProfile
assert.deepEqual(parseProfile(ID), { type: 'id', value: ID });
assert.deepEqual(parseProfile(`https://steamcommunity.com/profiles/${ID}/`), { type: 'id', value: ID });
assert.deepEqual(parseProfile('https://steamcommunity.com/id/meu_nome/games/?tab=all'), { type: 'vanity', value: 'meu_nome' });
assert.deepEqual(parseProfile('steamcommunity.com/id/abc-1'), { type: 'vanity', value: 'abc-1' });
assert.deepEqual(parseProfile('  fulano123 '), { type: 'vanity', value: 'fulano123' });
for (const bad of ['', 'a', 'x'.repeat(40), 'ola mundo', 'https://exemplo.com/id/fulano', 'https://steamcommunity.com/profiles/123', '<script>']) {
  assert.equal(parseProfile(bad), null, 'deveria rejeitar: ' + bad);
}

// biblioteca pública via nome personalizado
steam = {
  vanity: { success: 1, steamid: ID },
  player: pub,
  owned: { game_count: 3, games: [{ appid: 10, name: 'Hades', playtime_forever: 0 }, { appid: 20, name: 'Celeste', playtime_forever: 95 }, { appid: 30 }] },
};
let r = await call('?profile=fulano');
assert.equal(r.status, 200);
assert.equal(r.body.ok, true);
assert.equal(r.body.profile.name, 'Fulano');
assert.deepEqual(r.body.games, [{ id: 10, name: 'Hades', min: 0 }, { id: 20, name: 'Celeste', min: 95 }]);
assert.equal(r.body.count, 2);
assert.equal(r.headers.get('access-control-allow-origin'), '*');

// por ID direto (não chama o ResolveVanityURL)
r = await call('?profile=' + ID);
assert.equal(r.body.ok, true);

// perfil privado
steam = { player: { personaname: 'Reservado', communityvisibilitystate: 1 } };
r = await call('?profile=' + ID);
assert.equal(r.body.ok, false);
assert.equal(r.body.error, 'private_profile');
assert.equal(r.body.profile.name, 'Reservado');

// perfil público, lista de jogos oculta
steam = { player: pub, owned: {} };
r = await call('?profile=' + ID);
assert.equal(r.body.error, 'games_hidden');

// perfil público sem jogos
steam = { player: pub, owned: { game_count: 0 } };
r = await call('?profile=' + ID);
assert.equal(r.body.error, 'no_games');

// nome não existe
steam = { vanity: { success: 42 } };
r = await call('?profile=naoexiste');
assert.equal(r.status, 404);
assert.equal(r.body.error, 'not_found');

// ID sem jogador
steam = { player: null };
r = await call('?profile=' + ID);
assert.equal(r.body.error, 'not_found');

// entrada inválida, rota errada, sem chave, método errado
r = await call('?profile=' + encodeURIComponent('ola mundo'));
assert.equal(r.status, 400);
assert.equal(r.body.error, 'bad_input');
r = await call('');
assert.equal(r.body.error, 'bad_input');
r = await call('?profile=' + ID, {});
assert.equal(r.status, 500);
assert.equal(r.body.error, 'server_config');
r = await call('?profile=' + ID, { STEAM_API_KEY: 'KEY' }, 'POST');
assert.equal(r.status, 405);

// erros da Steam
steam = { status: 429 };
r = await call('?profile=' + ID);
assert.equal(r.status, 429);
assert.equal(r.body.error, 'rate_limited');
steam = { status: 500 };
r = await call('?profile=' + ID);
assert.equal(r.body.error, 'upstream');
steam = { status: 403 };
r = await call('?profile=' + ID);
assert.equal(r.body.error, 'server_config');

// CORS restrito
steam = { player: pub, owned: { game_count: 1, games: [{ appid: 1, name: 'A', playtime_forever: 1 }] } };
r = await call('?profile=' + ID, { STEAM_API_KEY: 'KEY', ALLOWED_ORIGIN: 'https://meusite.com,https://outro.com' }, 'GET', { Origin: 'https://outro.com' });
assert.equal(r.headers.get('access-control-allow-origin'), 'https://outro.com');
r = await call('?profile=' + ID, { STEAM_API_KEY: 'KEY', ALLOWED_ORIGIN: 'https://meusite.com' }, 'GET', { Origin: 'https://invasor.com' });
assert.equal(r.headers.get('access-control-allow-origin'), 'https://meusite.com');

// preflight
const pre = await worker.fetch(new Request('https://api.test/api/library', { method: 'OPTIONS' }), { STEAM_API_KEY: 'KEY' }, {});
assert.equal(pre.status, 204);

globalThis.fetch = realFetch;
console.log('Worker: todos os testes passaram');
