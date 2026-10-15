#!/usr/bin/env node
/**
 * Gera as páginas estáticas do site a partir de config.js, data/genres.json e data/games.json:
 *   sobre.html, privacidade.html, guias/index.html, guias/<gênero>.html,
 *   sitemap.xml, robots.txt e ads.txt.
 * Rodar:  node scripts/build-pages.mjs   (o workflow semanal também roda)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFile(path.join(ROOT, f), 'utf8');
const wr = async (f, s) => {
  await mkdir(path.dirname(path.join(ROOT, f)), { recursive: true });
  await writeFile(path.join(ROOT, f), s);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const cfgWin = {};
new Function('window', await rd('config.js'))(cfgWin);
const CFG = { siteName: 'Rola e Joga!', siteUrl: '', contactEmail: '', ads: {}, ...cfgWin.ROLA_CONFIG };
const SITE = String(process.env.SITE_URL || CFG.siteUrl || '').replace(/\/$/, '');
const genres = JSON.parse(await rd('data/genres.json'));
const data = JSON.parse(await rd('data/games.json'));
const games = data.games;
const updated = new Date(data.meta?.updatedAt || Date.now());
const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

/* ---------- molde das páginas ---------- */
function page({ file, title, desc, body }) {
  const depth = file.split('/').length - 1;
  const up = '../'.repeat(depth);
  const canonical = SITE ? `<link rel="canonical" href="${esc(SITE + '/' + file.replace(/index\.html$/, ''))}">` : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0a0a0a">
${CFG.ads?.client ? `<meta name="google-adsense-account" content="${esc(CFG.ads.client)}">\n` : ''}${canonical}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a0a0a'/%3E%3Cpath d='M16 17.6L16.00 6.00A11.6 11.6 0 0 1 21.80 7.55ZM16 17.6L26.05 11.80A11.6 11.6 0 0 1 27.60 17.60ZM16 17.6L26.05 23.40A11.6 11.6 0 0 1 21.80 27.65ZM16 17.6L16.00 29.20A11.6 11.6 0 0 1 10.20 27.65ZM16 17.6L5.95 23.40A11.6 11.6 0 0 1 4.40 17.60ZM16 17.6L5.95 11.80A11.6 11.6 0 0 1 10.20 7.55Z' fill='%232eea7a' opacity='.85'/%3E%3Ccircle cx='16' cy='17.6' r='11.6' fill='none' stroke='%232eea7a' stroke-width='2'/%3E%3Ccircle cx='16' cy='17.6' r='3.1' fill='%230a0a0a' stroke='%232eea7a' stroke-width='1.6'/%3E%3Cpath d='M11.4 1.2H20.6L16 9.6Z' fill='%232eea7a' stroke='%230a0a0a' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}pages.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${up || './'}" aria-label="${esc(CFG.siteName)}">
    <svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 13.2L12.00 4.40A8.8 8.8 0 0 1 16.40 5.58ZM12 13.2L19.62 8.80A8.8 8.8 0 0 1 20.80 13.20ZM12 13.2L19.62 17.60A8.8 8.8 0 0 1 16.40 20.82ZM12 13.2L12.00 22.00A8.8 8.8 0 0 1 7.60 20.82ZM12 13.2L4.38 17.60A8.8 8.8 0 0 1 3.20 13.20ZM12 13.2L4.38 8.80A8.8 8.8 0 0 1 7.60 5.58Z" fill="#2eea7a" opacity=".85"/><circle cx="12" cy="13.2" r="8.8" fill="none" stroke="#2eea7a" stroke-width="1.5"/><circle cx="12" cy="13.2" r="2.4" fill="#0a0a0a" stroke="#2eea7a" stroke-width="1.2"/><path d="M8.6 .9H15.4L12 7.2Z" fill="#2eea7a" stroke="#0a0a0a" stroke-width="1.2" stroke-linejoin="round"/></svg>
    <span>ROLA<i>e</i><b>JOGA!</b></span>
  </a>
  <nav>
    <a href="${up}guias/">Guias</a>
    <a href="${up}sobre.html">Sobre</a>
    <a class="cta" href="${up || './'}">Girar roleta</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <nav><a href="${up}sobre.html">Sobre</a> · <a href="${up}guias/">Guias</a> · <a href="${up}privacidade.html">Privacidade</a></nav>
  <p>Steam é marca da Valve Corporation. Este site não é afiliado nem endossado pela Valve.</p>
</footer>
</body>
</html>
`;
}

/* ---------- sobre ---------- */
const sobre = `
<h1>Sobre o ${esc(CFG.siteName)}</h1>
<p class="lead">Um app para quem tem jogo demais e vontade de menos: você escolhe um gênero, a roleta gira e a decisão deixa de ser sua.</p>

<h2>Como funciona</h2>
<ul>
  <li><b>Catálogo.</b> Escolha um gênero (Roguelike, Terror, RPG, Co-op e outros) e defina quantos jogos entram na roleta: 10, 20, 30, 40, 50 ou 100. Até 20 jogos a roleta é uma roda. Acima disso vira um slot de capas.</li>
  <li><b>Estou indeciso.</b> Se nem o gênero você sabe, uma segunda roleta sorteia por você.</li>
  <li><b>Minha biblioteca.</b> Cole o link do seu perfil da Steam e sorteie entre os jogos que você já tem, inclusive só os que nunca jogou. Para isso a lista de jogos do perfil precisa estar pública. Não pedimos login nem senha.</li>
  <li><b>Modo gravação.</b> Esconde menus e botões para você gravar o giro limpo e postar.</li>
</ul>

<h2>De onde vêm os jogos</h2>
<p>O catálogo é montado a partir de dados públicos da Steam e do SteamSpy. Só entram jogos com um mínimo de avaliações e boa aprovação, e a lista é atualizada todos os dias. Na última atualização havia ${games.length} jogos, em ${esc(updated.toLocaleDateString('pt-BR'))}.</p>

<h2>Quem fez</h2>
<p>${esc((CFG.creator && CFG.creator.role) || 'Idealizador')}: ${esc((CFG.creator && CFG.creator.name) || '@opropriogustavo')}.</p>

<h2>Sobre a Steam</h2>
<p>Steam é marca da Valve Corporation. O ${esc(CFG.siteName)} é um projeto independente, sem vínculo com a Valve. Nomes, capas e descrições dos jogos pertencem aos seus donos.</p>

<p class="actions"><a class="btn" href="./">Girar a roleta</a> <a class="btn ghost" href="privacidade.html">Política de privacidade</a></p>
`;

/* ---------- privacidade ---------- */
const mail = CFG.contactEmail ? `<a href="mailto:${esc(CFG.contactEmail)}">${esc(CFG.contactEmail)}</a>` : 'o e-mail de contato informado nesta página';
const privacidade = `
<h1>Política de privacidade</h1>
<p class="muted">Atualizada em ${esc(today)}.</p>

<h2>O que guardamos no seu aparelho</h2>
<p>O ${esc(CFG.siteName)} salva no próprio navegador (localStorage), sem enviar para nenhum servidor nosso: seu histórico de sorteios, os jogos marcados como "já joguei", os desafios aceitos, a preferência de som, o último perfil digitado e a sua resposta sobre cookies. Você pode apagar tudo limpando os dados do site no navegador.</p>

<h2>Busca de biblioteca da Steam</h2>
<p>Quando você usa "Minha biblioteca", o endereço de perfil que você digitou é enviado ao nosso servidor, que consulta a API pública da Steam e devolve a lista de jogos. Só funciona com perfis cuja lista de jogos é pública. Não pedimos login nem senha da Steam. A resposta fica em cache por poucos minutos para reduzir consultas e não guardamos a biblioteca depois disso.</p>

<h2>Anúncios e cookies</h2>
<p>O site pode exibir anúncios do Google AdSense. Nesse caso, o Google e seus parceiros podem usar cookies e identificadores para exibir e medir anúncios, inclusive personalizados. Os anúncios só são carregados depois que você clica em "Aceitar" no aviso de cookies. Se recusar, nenhum anúncio é carregado. Você também pode gerenciar a personalização em <a href="https://adssettings.google.com" rel="noopener">adssettings.google.com</a>.</p>

<h2>Links de afiliados</h2>
<p>O botão "Ver ofertas" pode levar a lojas parceiras por links de afiliado. Se você comprar, podemos receber uma comissão, sem custo extra para você. As lojas têm suas próprias políticas de privacidade.</p>

<h2>Serviços de terceiros</h2>
<p>As fontes (Google Fonts) e as capas dos jogos (CDN da Steam) são carregadas de servidores externos, que recebem o seu endereço IP como em qualquer site. A hospedagem do site e do servidor da busca de biblioteca pode registrar logs técnicos de acesso.</p>

<h2>Seus direitos (LGPD)</h2>
<p>Você pode pedir informações, correção ou exclusão de dados pessoais que tenhamos sobre você. Como quase tudo fica só no seu navegador, na maioria dos casos basta limpar os dados do site. Para qualquer pedido, fale com ${mail}.</p>

<p class="actions"><a class="btn" href="./">Voltar ao app</a></p>
`;

/* ---------- guias por gênero ---------- */
const byGenre = (id) => games.filter((g) => g.genres.includes(id)).sort((a, b) => (b.reviews || 0) - (a.reviews || 0) || a.name.localeCompare(b.name, 'pt-BR'));

function gameItem(g) {
  const bits = [];
  if (g.year) bits.push(g.year);
  if (g.approval != null) bits.push(`${g.approval}% positivas`);
  const price = g.free ? 'Grátis' : g.price;
  if (price) bits.push(price);
  return `<li><a href="https://store.steampowered.com/app/${g.id}" rel="noopener nofollow" target="_blank">${esc(g.name)}</a>${bits.length ? `<span>${esc(bits.join(' · '))}</span>` : ''}</li>`;
}

const written = [];
for (const gen of genres) {
  const list = byGenre(gen.id);
  if (!list.length) continue;
  const shown = list.slice(0, 80);
  const body = `
<p class="crumb"><a href="./">Guias</a> / ${esc(gen.label)}</p>
<h1>Jogos de ${esc(gen.label)} na Steam</h1>
<p class="lead">${esc(gen.intro)}</p>
<p class="actions"><a class="btn" href="../#g=${esc(gen.id)}">Girar a roleta de ${esc(gen.label)}</a></p>
<h2>${list.length} jogos para sortear${list.length > shown.length ? ` (mostrando ${shown.length})` : ''}</h2>
<ul class="games">
${shown.map(gameItem).join('\n')}
</ul>
<p class="muted">Lista atualizada em ${esc(updated.toLocaleDateString('pt-BR'))}. Preços e avaliações mudam com frequência, confira na Steam.</p>
`;
  const file = `guias/${gen.id}.html`;
  await wr(file, page({ file, title: `Jogos de ${gen.label} na Steam | ${CFG.siteName}`, desc: `${gen.intro} ${list.length} jogos para sortear na roleta.`, body }));
  written.push({ file, gen, count: list.length });
}

const indexBody = `
<h1>Guias por gênero</h1>
<p class="lead">Cada gênero tem uma lista dos jogos que entram na roleta. Escolha um para ver os títulos e girar.</p>
<ul class="cards">
${written.map(({ file, gen, count }) => `  <li><a href="${path.basename(file)}"><b>${esc(gen.label)}</b><span>${esc(gen.intro)}</span><small>${count} jogos</small></a></li>`).join('\n')}
</ul>
`;
await wr('guias/index.html', page({ file: 'guias/index.html', title: `Guias por gênero | ${CFG.siteName}`, desc: 'Listas de jogos da Steam por gênero para sortear na roleta.', body: indexBody }));
await wr('sobre.html', page({ file: 'sobre.html', title: `Sobre | ${CFG.siteName}`, desc: 'Como funciona o Rola e Joga!, a roleta de jogos da Steam.', body: sobre }));
await wr('privacidade.html', page({ file: 'privacidade.html', title: `Política de privacidade | ${CFG.siteName}`, desc: 'Como o Rola e Joga! trata dados, cookies, anúncios e links de afiliados.', body: privacidade }));

/* ---------- sitemap, robots, ads.txt ---------- */
const urls = ['', 'sobre.html', 'privacidade.html', 'guias/', ...written.map((w) => w.file)];
if (SITE) {
  await wr('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(SITE + '/' + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
}
await wr('robots.txt', `User-agent: *\nAllow: /\n${SITE ? `Sitemap: ${SITE}/sitemap.xml\n` : ''}`);
const pub = String(CFG.ads?.client || '').replace(/^ca-/, '');
await wr('ads.txt', pub
  ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`
  : '# Preencha ads.client em config.js e rode "npm run pages" para gerar a linha do AdSense.\n');

console.log(`Páginas geradas: ${written.length} guias + índice, sobre, privacidade${SITE ? ', sitemap' : ' (sem sitemap: defina siteUrl em config.js)'}.`);
