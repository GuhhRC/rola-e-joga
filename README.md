# Rola e Joga!

Roleta de jogos da Steam. Escolha um gênero (ou cole o seu perfil da Steam), defina quantos jogos entram na roleta (10, 20, 30, 40, 50 ou 100) e jogue o que ela mandar.
Visual preto/verde neon, layout vertical 9:16 pensado para gravar tela (TikTok, Reels, Shorts).

## O que tem

- **Catálogo** por gênero/tag, com roda circular até 20 jogos e slot de capas acima disso.
- **Minha biblioteca:** o usuário cola o link do perfil (ou o nome, ou o ID) e sorteia entre os jogos dele, com filtros "nunca joguei" e "menos de 2h". Perfil privado ou lista oculta mostra uma mensagem com o passo a passo para liberar.
- **Roleta de gêneros** opcional ("Estou indeciso").
- **Modo gravação** (REC, `Esc` sai), card 1080x1920 para stories, histórico, "já joguei" e "aceitar desafio". Tudo salvo só no navegador.
- **Monetização opcional (desligada):** anúncios com consentimento de cookies, botão "Ver ofertas" com links de afiliado.
- **Páginas de conteúdo:** Sobre, Privacidade e um guia por gênero, geradas automaticamente.

## Estrutura

```
index.html  style.css  app.js  config.js     o app (config.js é o único arquivo que você edita no dia a dia)
data/       genres.json, curated.json (base inicial), games.json (gerado)
scripts/    update.mjs (atualização diária), build-pages.mjs, make-preview.mjs
worker/     index.js, wrangler.toml, test.mjs (API da busca por perfil, Cloudflare Worker)
.github/workflows/update-games.yml            roda todo dia às 03:00 (Brasília)
sobre.html privacidade.html guias/ ...        páginas geradas por scripts/build-pages.mjs
```

## Rodar no computador

```bash
npm run serve        # abre em http://localhost:8080
npm run test:worker  # testa o Worker com uma Steam simulada
npm run preview      # gera preview.html (arquivo único, abre com duplo clique)
```

Abrir o `index.html` direto com duplo clique não funciona (o navegador bloqueia a leitura dos JSONs). Use `npm run serve` ou o `preview.html`.

---

# Passo a passo para colocar no ar

## 1. Publicar o site (grátis)

1. Crie uma conta em github.com e um repositório **público** novo (ex.: `rola-e-joga`).
2. Envie todos os arquivos da pasta para o repositório (botão *Add file → Upload files*, ou `git push`). Mantenha a estrutura de pastas, inclusive a `.github`.
3. No repositório: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save*. Em 1 ou 2 minutos o site abre em `https://SEU-USUARIO.github.io/rola-e-joga/`.
4. *Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save*. Sem isso o robô diário não consegue salvar a lista.

## 2. Rodar a primeira atualização de jogos

1. Aba *Actions* → *Atualizar lista de jogos* → *Run workflow*. Leva de 30 a 60 minutos (a Steam limita as consultas de propósito).
2. Quando terminar, o commit "Atualiza lista de jogos e guias" aparece e o site passa a ter preços, notas e descrições. Se falhar, abra a execução e leia o log: o script não apaga a lista anterior.
3. Dali em diante roda sozinho todo dia.

## 3. Ativar a busca por perfil (Cloudflare Worker + chave da Steam)

1. **Chave da Steam:** entre em steamcommunity.com/dev/apikey com a sua conta (precisa ser uma conta não limitada, ou seja, que já gastou ao menos US$ 5). Em "Domain Name" escreva o endereço do seu site. Copie a chave e **não compartilhe nem coloque no código**.
2. **Conta Cloudflare:** crie uma em dash.cloudflare.com (grátis).
3. No computador, com o Node.js instalado, abra um terminal na pasta `worker/` e rode:
   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put STEAM_API_KEY     # cole a chave quando pedir
   ```
   O `deploy` mostra o endereço, algo como `https://rola-e-joga-api.SEU-NOME.workers.dev`.
4. Teste no navegador: `https://rola-e-joga-api.SEU-NOME.workers.dev/api/library?profile=SEU_NOME_DE_PERFIL`. Deve voltar um JSON com `"ok":true` e seus jogos.
5. Em `config.js`, preencha `apiUrl` com esse endereço e envie o arquivo para o GitHub.
6. Em `worker/wrangler.toml`, troque `ALLOWED_ORIGIN = "*"` pelo endereço do seu site (ex.: `"https://rolaejoga.com.br"`) e rode `npx wrangler deploy` de novo. Assim só o seu site usa a API.

## 4. Links de afiliado (Nuuvem e Hype Games)

O botão **Onde comprar** abre as lojas que estiverem em `affiliates` no `config.js`. Cada loja tem:
- `search`: endereço da busca no site da loja, com `{name}` no lugar do nome do jogo. Abra o site, busque um jogo e copie o endereço, trocando o nome por `{name}`.
- `link`: o deeplink de afiliado gerado no painel, com `{url}` no lugar do destino. Vazio = abre a busca normal, sem comissão.

Exemplo: `{ name: 'Nuuvem', search: 'https://www.nuuvem.com/catalog/search/{name}', link: 'https://.../deeplink?...&murl={url}' }`

Cadastro: Nuuvem Co-op (via Rakuten Advertising, grátis, aprovação pode levar semanas) e Hype Games (via Afilio, grátis). Os formatos de busca e de deeplink dependem de cada programa: confirme no painel.

## 5. Base de jogos e cards detalhados

O robô diário (`scripts/update.mjs`) descobre jogos pelas tags da Steam, busca os detalhes na loja em português do Brasil (preço em R$, idiomas, desenvolvedora, prints, plataformas) e guarda em `data/details/NN.json`. Cada execução busca até 1500 jogos, então a base cresce ao longo dos dias (rode **Run workflow** algumas vezes no começo). Candidatos ainda sem detalhes ficam em `data/pending.json`; DLCs, conteúdo adulto e jogos não lançados ficam em `data/blocked.json`. `npm run test:update` testa o script sem usar a rede.

O robô também monta um **catálogo +18 separado** em `data/adult.json` (tags "Sexual Content", "Hentai" e "Nudity" do SteamSpy, confirmadas na loja). Só guarda nome, ano, preço e avaliações, sem descrição nem imagens. Ele **não é lido pelo site**: a roleta não usa esse arquivo. Para desligar a coleta, defina `CATALOG_ADULT=0` no workflow.

## Antes de monetizar

- Leia os termos de uso da API da Steam e do SteamSpy para uso comercial. Não consegui verificar isso daqui.
- Nomes, capas e descrições dos jogos pertencem aos donos. A Valve é rígida com o uso da marca Steam; por isso o nome do projeto não a contém e o rodapé traz o aviso de que não há vínculo.
- O texto da política de privacidade é um modelo básico baseado no que o app faz. Revise e, se o projeto crescer, consulte um profissional de direito digital.

## Ajustes rápidos

`app.js`: `QUANTITIES` (opções do pop-up), `WHEEL_MAX` (limite da roda), `SPIN_MS` (duração do giro).
`config.js`: nome, site, Worker, anúncios e afiliados.
`data/genres.json`: gêneros e tags (`steamTag` é a tag da Steam usada na busca; `intro` vira o texto do guia).
`scripts/update.mjs`: filtros de qualidade por variável de ambiente (`MIN_REVIEWS`, `MIN_APPROVAL`, `PER_GENRE`).

## Limites conhecidos

- A lista começa com 314 jogos escolhidos à mão; o resto vem do script diário (cresce todo dia; veja a seção 5).
- Na biblioteca, jogos fora da nossa base entram em "Outros" (sem gênero), mas funcionam normalmente. A base cresce a cada atualização.
- O Worker, o script de atualização e as capas foram validados com Steam simulada ou só no código. O primeiro teste real é o seu.

## Próximos passos possíveis

Cache de gêneros no Worker para classificar qualquer biblioteca, filtros de plataforma/nota/preço, PWA instalável, versões para celular e consoles.
