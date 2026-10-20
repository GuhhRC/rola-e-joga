'use strict';
/* Rola e Joga! — Anúncios (desligados por padrão)
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   Anúncios (desligados por padrão: config.js → ads.enabled)
   Regras: só com consentimento, nunca no modo gravação, durante o giro
   ou colados em botões.
   ========================================================================== */
let adsLoaded = false;
let bottomAd;
let sideAds = [];

function adUnit(slot, format) {
  return h('ins', {
    class: 'adsbygoogle',
    style: 'display:block',
    'data-ad-client': ADS.client,
    'data-ad-slot': slot,
    'data-ad-format': format,
    'data-full-width-responsive': 'true',
  });
}

function initAds() {
  // etiqueta de verificação do site no AdSense (não carrega nenhum anúncio nem cookie)
  if (ADS.client) document.head.append(h('meta', { name: 'google-adsense-account', content: ADS.client }));
  if (!ADS_ON) return;
  if (ADS.bottomSlot) {
    bottomAd = h('div', { class: 'ad-slot', hidden: true }, h('small', {}, 'publicidade'), adUnit(ADS.bottomSlot, 'auto'));
    stage.insertBefore(bottomAd, modal);
  }
  if (ADS.sideSlot) {
    sideAds = ['left', 'right'].map((side) => {
      const el = h('div', { class: 'ad-side ' + side, hidden: true }, h('small', {}, 'publicidade'), adUnit(ADS.sideSlot, 'vertical'));
      document.body.append(el);
      return el;
    });
  }
  const c = store.get('consent', null);
  if (c === 'yes') loadAds();
  else if (c == null) showConsent();
  updateAds();
}

function showConsent() {
  const bar = h('div', { class: 'consent', role: 'dialog', 'aria-label': 'Cookies e anúncios' },
    h('p', {}, 'Usamos cookies para mostrar anúncios. ', h('a', { href: 'privacidade.html', target: '_blank', rel: 'noopener' }, 'Saiba mais')),
    h('div', { class: 'consent-btns' },
      h('button', { class: 'btn ghost', onclick: () => answer('no') }, 'Recusar'),
      h('button', { class: 'btn primary', onclick: () => answer('yes') }, 'Aceitar'),
    ),
  );
  function answer(v) {
    store.set('consent', v);
    bar.remove();
    if (v === 'yes') loadAds();
    updateAds();
  }
  stage.append(bar);
}

function loadAds() {
  if (adsLoaded || !ADS_ON) return;
  adsLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.client)}`;
  document.head.append(s);
  updateAds();
}

function updateAds() {
  if (!ADS_ON) return;
  const ok = !state.rec && !state.busy && (state.view === 'home' || state.resultShown) && store.get('consent', null) === 'yes';
  for (const el of [bottomAd, ...sideAds]) {
    if (!el) continue;
    el.hidden = !ok;
    if (ok && adsLoaded && !el.dataset.pushed && el.offsetWidth > 0) {
      el.dataset.pushed = '1';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* bloqueador de anúncios */ }
    }
  }
}

/* ---------- bloco de parceiro (equipamento gamer) ----------
   Config em config.js → gear: { name, url, genres: [ids dos gêneros pesados] }. Sem url, não aparece.
   Fica fora do +18, fora do modo gravação e nunca é colado em botões. */
function gearCard(genre) {
  const gear = CFG.gear;
  if (!gear || !gear.url || state.adult || isLib()) return null;
  if (genre && gear.genres && !gear.genres.includes(genre.id)) return null; // sem 'genres' no config = aparece em qualquer gênero
  const line = 'Bom jogo pede máquina à altura.';
  return h('aside', { class: 'gear hide-rec' },
    h('span', { class: 'gear-tag' }, 'parceiro'),
    h('div', { class: 'gear-txt' },
      h('b', {}, line),
      h('span', {}, `Notebooks, monitores e periféricos gamer ${gear.name || ''}.`.replace(' .', '.')),
    ),
    h('a', { class: 'gear-btn', href: gear.url, target: '_blank', rel: 'sponsored noopener' }, 'Ver ofertas'),
  );
}
