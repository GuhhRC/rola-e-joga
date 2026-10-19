# NOTAS DO PROJETO (leia isto primeiro; evita reler o código todo)

Rola e Joga! — roleta de jogos da Steam. Site estático (GitHub Pages), sem build. JS puro, vários scripts clássicos
que compartilham o mesmo escopo; a ORDEM está em `index.html` (`main.js` é sempre o último).

## Onde mexer para cada assunto
| Assunto | Arquivo | Funções principais |
|---|---|---|
| Configurações, utilidades (`h()`, `rnd`, `store`), estado, som, animação | `js/core.js` | `state`, `availableFor`, `mount`, `toast` |
| Roda (canvas), slot de capas, tela de giro | `js/wheel.js` | `drawWheel`, `createWheel`, `createReel`, `spinScreen` |
| Home (gêneros), biblioteca por perfil | `js/home.js` | `showHome`, `catalogPanel`, `libraryPanel`, `loadLibrary` |
| Quantidade, giro, afiliados, detalhes, card do resultado, roleta de gêneros | `js/game.js` | `openQty`, `showSpin`, `offerLinks`, `detailNodes`, `gameResult`, `showGenreWheel` |
| Modal, listas (histórico/já joguei/desafios) | `js/lists.js` | `openModal`, `renderLists` |
| Card 1080x1920, texto e link de compartilhar | `js/share.js` | `makeCard`, `shareText`, `shareCard` |
| Anúncios (desligados) | `js/ads.js` | `initAds`, `updateAds` |
| Modo gravação, teclado | `js/controls.js` | `setRec`, listener `keydown` |
| Modo +18 escondido | `js/adult.js` | `arm`, `onSecretTap`, `enterAdult`, `exitAdult`, `showAdultRoulette`, `adultHead` |
| Visualizador de prints em tela cheia | `js/viewer.js` | `openViewer`, `closeViewer` |
| Boas-vindas, link do resultado (#j=), início | `js/main.js` | `showWelcome`, `showShared`, `boot` |
| Visual (cores no começo do arquivo; +18 no final) | `style.css` | variáveis `--green`..., `body.adult` |
| Robô diário | `scripts/update.mjs` (testes: `scripts/test-update.mjs`) | `parseDetail`, `adultByTags`, `shotTokens`, `main` |
| Páginas Sobre/Privacidade/Guias/sitemap | `scripts/build-pages.mjs` | — |
| API da biblioteca (Cloudflare Worker) | `worker/index.js` | — |
| Preview num arquivo só | `scripts/make-preview.mjs` | lê os scripts do `index.html` |

## Dados (gerados pelo robô, NÃO editar à mão)
`data/games.json` (índice), `data/details/NN.json` (detalhes por id%100), `data/adult.json` (+18; `f:1` selo da Steam, `f:2` tags,
`s` prints), `data/blocked.json`, `data/pending.json`, `data/genres.json` e `data/curated.json` (estes dois são editáveis).

## Cache do navegador
O `index.html` chama `style.css?v=N` e `js/*.js?v=N`. Ao entregar mudança de CSS/JS, aumente o N (todos de uma vez, ex.: `sed -i 's/?v=3/?v=4/g' index.html`), senão o usuário vê o site antigo misturado com o novo.

## Regras que não podem quebrar
- NUNCA sobrescrever `config.js` do usuário (tem `apiUrl` preenchido). Mudanças de config vão como instrução, não como arquivo.
- Entregar ao usuário um zip só com os arquivos alterados (ele sobe no GitHub à mão). Nunca incluir `config.js` nem `data/`.
- O +18: botão `.secret` invisível sobre o @ do rodapé, só recebe toque depois do toque duplo no logo (`body.armed`); antes disso o toque vai para o Instagram.
  No +18: sem histórico, listas, compartilhar nem afiliados. Sem borrão em capas e prints por padrão (`adultBlurCovers: true` / `adultBlurShots: true` no config ligam).
- Instagram padrão em `CREATOR.url` (`js/core.js`); pode ser trocado em `config.js → creator`.
- Políticas: GitHub Pages proíbe pornografia (o +18 só lista nomes/capas da Steam); termos da API da Steam para uso comercial não verificados.

## Como testar
`npm run serve` (localhost:8080) · `node scripts/test-update.mjs` · `node worker/test.mjs` · `npm run preview`.
Teste de navegador: Playwright + chromium em /opt/pw-browsers/chromium (rotear `steamstatic` para imagens locais).

## Robô: horários e limites
Roda 2x/dia (cron 06:00 e 18:00 UTC = 03:00 e 15:00 em Brasília). Por execução: até `MAX_DETAIL`=3000 consultas à loja, com cota de `PER_GENRE_DETAIL`=300 por gênero na fila; prazo `DEADLINE_MIN`=160 min (job tem 180). Gênero com menos de `SMALL_GENRE_BELOW`=300 jogos é redescoberto todo dia e ganha filtros de avaliação mais folgados.

## Pendências do usuário
Aprovação de afiliados (Nuuvem via Rakuten, Hype via Afilio) e depois informar o formato do deeplink para `config.js → affiliates[].link`;
conferir a lista +18 após o robô; acompanhar a execução diária das 03:00.

## Histórico curto
Gêneros + roleta + biblioteca + gravação + card · afiliados BR · base ampliada e cards detalhados · boas-vindas e crédito ·
link do resultado · +18 escondido e catálogo +18 · Instagram, +18 com roleta direta, prints em tela cheia · app dividido em `js/`.

## Formatos de roleta (dado d20)
- `js/formats.js`: registro `FORMATS` (wheel/die/reel) e `QTY_OPTIONS` (botões da tela de quantidade, com o formato escrito em cada um). Formato novo = motor `createXxx(pool)→{el,spin(w),reset()}` + entrada nos dois registros.
- `js/die.js`: d20 em canvas (3D calculado à mão), nomes + número nas faces (opostas somam 21), som de dado sintetizado (respeita SOM). Só aceita 20 jogos. Funciona no +18 (`state.adultFmt` guarda o formato).
- `game.js`: `startSpin(q, fmt)`, `showSpin` usa `resolveFormat(state.format, n)`.
- Cache: `?v=8` em todos os scripts/estilo do index.html.
