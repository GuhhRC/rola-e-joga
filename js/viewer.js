'use strict';
/* Rola e Joga! — Visualizador de prints em tela cheia
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   Visualizador de prints em tela cheia (setas, teclado, deslize, toque fora fecha)
   ========================================================================== */
const hiRes = (u) => String(u).replace(/\.\d+x\d+(\.[a-z]+)$/i, '.1920x1080$1');
let viewer = null;

function openViewer(urls, start = 0) {
  closeViewer();
  const list = urls.filter(Boolean);
  if (!list.length) return;
  let i = Math.max(0, Math.min(start, list.length - 1));

  const low = h('img', { class: 'vwr-low', alt: '', draggable: 'false' });
  const hi = h('img', { class: 'vwr-hi', alt: 'Print do jogo', draggable: 'false' });
  const count = h('div', { class: 'vwr-count', 'aria-live': 'polite' });
  const prev = h('button', { class: 'vwr-nav prev', type: 'button', 'aria-label': 'Anterior' }, '‹');
  const next = h('button', { class: 'vwr-nav next', type: 'button', 'aria-label': 'Próximo' }, '›');
  const close = h('button', { class: 'vwr-close', type: 'button', 'aria-label': 'Fechar' }, '✕');
  const fig = h('div', { class: 'vwr-fig' }, low, hi);
  const root = h('div', { class: 'vwr', role: 'dialog', 'aria-label': 'Prints do jogo', 'aria-modal': 'true' }, fig, count, close, prev, next);

  function show(n) {
    i = (n + list.length) % list.length;
    const thumb = list[i];
    count.textContent = `${i + 1}/${list.length}`;
    prev.hidden = next.hidden = list.length < 2;
    hi.classList.remove('ok');
    low.src = thumb; // miniatura aparece na hora, o print grande entra por cima
    let tried = false;
    hi.onload = () => hi.classList.add('ok');
    hi.onerror = () => { if (!tried) { tried = true; hi.src = thumb; } else hi.classList.add('ok'); };
    hi.src = hiRes(thumb);
    for (const d of [1, -1]) { const im = new Image(); im.src = hiRes(list[(i + d + list.length) % list.length]); } // pré-carrega vizinhos
  }
  const go = (d) => show(i + d);

  prev.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  close.addEventListener('click', (e) => { e.stopPropagation(); closeViewer(); });
  root.addEventListener('click', (e) => { if (e.target === root || e.target === fig) closeViewer(); }); // toque fora da imagem

  // deslize
  let sx = 0; let sy = 0; let tracking = false;
  root.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; tracking = true; sx = e.clientX; sy = e.clientY; });
  root.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { go(dx < 0 ? 1 : -1); root.dataset.swiped = '1'; setTimeout(() => delete root.dataset.swiped, 50); }
  });
  root.addEventListener('pointercancel', () => { tracking = false; });
  root.addEventListener('click', (e) => { if (root.dataset.swiped) e.stopImmediatePropagation(); }, true);

  viewer = { root, go };
  stage.append(root);
  show(i);
  close.focus({ preventScroll: true });
}

function closeViewer() {
  if (!viewer) return;
  viewer.root.remove();
  viewer = null;
}
