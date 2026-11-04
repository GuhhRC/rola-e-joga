/* Configurações do Rola e Joga!  Edite aqui, sem mexer no app.js. */
window.ROLA_CONFIG = {
  siteName: 'Rola e Joga!',

  // Endereço final do site, sem barra no final. Ex.: 'https://rolaejoga.com.br'
  // Usado no sitemap, nos links canônicos e nas páginas geradas.
  siteUrl: '',

  // Texto que aparece no rodapé do card de compartilhamento. Ex.: 'rolaejoga.com.br'
  siteLabel: 'Rola e Joga!',

  // E-mail de contato mostrado na política de privacidade. Ex.: 'contato@rolaejoga.com.br'
  contactEmail: '',

  // Endereço do Worker da Cloudflare (busca de biblioteca por perfil), sem barra no final.
  // Ex.: 'https://rola-e-joga-api.SEU-USUARIO.workers.dev'. Vazio = busca desativada.
  apiUrl: 'https://rola-e-joga-api.rola-e-joga.workers.dev/',

  // Anúncios. Ficam desligados até você ter a conta do AdSense aprovada.
  ads: {
    enabled: false,
    client: '', // ex.: 'ca-pub-1234567890123456'
    bottomSlot: '', // ID do bloco de anúncio do banner inferior
    sideSlot: '', // ID do bloco vertical das laterais (só aparece em telas largas). Pode ficar vazio.
  },

  // Bloco "parceiro" (equipamento gamer) na tela do sorteio de gênero. Sem url, não aparece.
  gear: { name: 'ASUS', url: 'https://click.linksynergy.com/fs-bin/click?id=A9fL1JWbtDI&offerid=1940053.7&type=3&subid=0' },

  // Lojas parceiras do botão "Ver ofertas". Só aparecem as que tiverem url.
  // Use {name} para o nome do jogo e {id} para o appid da Steam no seu link de afiliado.
  // O formato exato vem do painel de cada programa de afiliados.
  affiliates: [
    // Nuuvem (Rakuten, MID 46796) e Hype Games (Rakuten, MID 53304): abrem a busca da loja com o nome do jogo.
    // {name} = nome do jogo; {url} = destino, que o link de afiliado leva dentro de murl.
    { name: 'Nuuvem', search: 'https://www.nuuvem.com/br-pt/catalog/search/{name}', link: 'https://click.linksynergy.com/deeplink?id=A9fL1JWbtDI&mid=46796&murl={url}' },
    { name: 'Hype Games', search: 'https://hype.games/br/busca/{name}', link: 'https://click.linksynergy.com/deeplink?id=A9fL1JWbtDI&mid=53304&murl={url}' },
    { name: 'Instant Gaming', url: '' },
    { name: 'Green Man Gaming', url: '' },
    { name: 'Fanatical', url: '' },
    { name: 'Humble Bundle', url: '' },
  ],
};
