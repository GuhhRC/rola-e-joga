/**
 * Rola e Joga! — API da busca de biblioteca (Cloudflare Worker).
 *
 * GET /api/library?profile=<link do perfil | nome personalizado | SteamID64>
 *
 * Resposta: { ok: true, profile: {id, name}, count, games: [{id, name, min}] }
 *       ou: { ok: false, error: <código> }
 *
 * Códigos de erro: bad_input, not_found, private_profile, games_hidden,
 *                  no_games, rate_limited, upstream, server_config.
 *
 * Segredo necessário: STEAM_API_KEY (wrangler secret put STEAM_API_KEY).
 * Variável opcional: ALLOWED_ORIGIN (sites autorizados, separados por vírgula; vazio ou * = qualquer um).
 */

const STEAM = 'https://api.steampowered.com';
const ID64 = /^7656119\d{10}$/;
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;
const CACHE_SECONDS = 300;

export function parseProfile(input) {
  const s = String(input ?? '').trim();
  if (!s || s.length > 200) return null;
  if (ID64.test(s)) return { type: 'id', value: s };

  const m = s.match(/steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i);
  if (m) {
    let v;
    try { v = decodeURIComponent(m[2]); } catch { return null; }
    if (m[1].toLowerCase() === 'profiles') return ID64.test(v) ? { type: 'id', value: v } : null;
    return VANITY.test(v) ? { type: 'vanity', value: v } : null;
  }
  if (VANITY.test(s)) return { type: 'vanity', value: s };
  return null;
}

class SteamError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function steamGet(path, params, key) {
  const u = new URL(STEAM + path);
  u.search = new URLSearchParams({ ...params, key }).toString();
  let res;
  try { res = await fetch(u.toString()); } catch { throw new SteamError('upstream'); }
  if (res.status === 429) throw new SteamError('rate_limited');
  if (res.status === 401 || res.status === 403) throw new SteamError('server_config'); // chave inválida
  if (!res.ok) throw new SteamError('upstream');
  try { return await res.json(); } catch { throw new SteamError('upstream'); }
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGIN ?? '*').split(',').map((x) => x.trim()).filter(Boolean);
  let origin = '*';
  if (allowed.length && !allowed.includes('*')) {
    const o = request.headers.get('Origin');
    origin = allowed.includes(o) ? o : allowed[0];
  }
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' };
}

function reply(request, env, data, status = 200, cacheable = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheable ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
    },
  });
}

const ERROR_STATUS = { bad_input: 400, not_found: 404, rate_limited: 429, upstream: 502, server_config: 500 };

async function lookup(parsed, key) {
  let steamid = parsed.value;
  if (parsed.type === 'vanity') {
    const r = await steamGet('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: parsed.value }, key);
    if (r?.response?.success !== 1 || !r.response.steamid) return { ok: false, error: 'not_found' };
    steamid = r.response.steamid;
  }

  const sum = await steamGet('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamid }, key);
  const player = sum?.response?.players?.[0];
  if (!player) return { ok: false, error: 'not_found' };
  const profile = { id: steamid, name: player.personaname || 'Jogador' };

  // 3 = público. Perfil privado ou só para amigos nunca expõe a biblioteca.
  if (player.communityvisibilitystate !== 3) return { ok: false, error: 'private_profile', profile };

  const owned = await steamGet(
    '/IPlayerService/GetOwnedGames/v1/',
    { steamid, include_appinfo: '1', include_played_free_games: '1', format: 'json' },
    key,
  );
  const resp = owned?.response ?? {};
  // Perfil público com "Detalhes do jogo" oculto devolve um objeto vazio.
  if (resp.game_count === undefined && !Array.isArray(resp.games)) return { ok: false, error: 'games_hidden', profile };
  const list = Array.isArray(resp.games) ? resp.games : [];
  if (!list.length) return { ok: false, error: 'no_games', profile };

  const games = list
    .filter((g) => g && g.appid && g.name)
    .map((g) => ({ id: g.appid, name: g.name, min: g.playtime_forever || 0 }));
  return { ok: true, profile, count: games.length, games };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (url.pathname !== '/api/library') return reply(request, env, { ok: false, error: 'not_found' }, 404);
    if (request.method !== 'GET') return reply(request, env, { ok: false, error: 'bad_input' }, 405);
    if (!env.STEAM_API_KEY) return reply(request, env, { ok: false, error: 'server_config' }, 500);

    const parsed = parseProfile(url.searchParams.get('profile'));
    if (!parsed) return reply(request, env, { ok: false, error: 'bad_input' }, 400);

    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(`${url.origin}/api/library?p=${parsed.type}:${parsed.value.toLowerCase()}`);
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return reply(request, env, await hit.json(), 200, true);
    }

    let result;
    try {
      result = await lookup(parsed, env.STEAM_API_KEY);
    } catch (e) {
      const code = e instanceof SteamError ? e.code : 'upstream';
      return reply(request, env, { ok: false, error: code }, ERROR_STATUS[code] || 502);
    }

    const status = result.ok ? 200 : (result.error === 'not_found' ? 404 : 200);
    if (cache) {
      const store = new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_SECONDS}` } });
      ctx?.waitUntil?.(cache.put(cacheKey, store));
    }
    return reply(request, env, result, status, true);
  },
};
