'use strict';
/* Rola e Joga! — Modal, gaveta de listas e persistência (histórico, já joguei, desafios)
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   Modal e gaveta de listas
   ========================================================================== */
function openModal(node) {
  modal.replaceChildren(node);
  modal.hidden = false;
  modal.onclick = closeModal;
}
function closeModal() {
  modal.hidden = true;
  modal.replaceChildren();
}

function openLists(tab) {
  state.listTab = tab || state.listTab;
  drawer.hidden = false;
  renderLists();
}
function closeLists() { drawer.hidden = true; }

function renderLists() {
  const tabs = [
    ['history', 'Histórico', state.history.length],
    ['played', 'Já joguei', state.played.size],
    ['challenges', 'Desafios', state.challenges.length],
  ];
  const fmt = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const thumb = (id) => {
    const i = h('img', { src: coverUrl(id), alt: '', loading: 'lazy' });
    i.addEventListener('error', () => { i.style.visibility = 'hidden'; }, { once: true });
    return i;
  };
  const row = (id, name, sub, ...btns) =>
    h('div', { class: 'row' }, thumb(id), h('div', { class: 'info' }, h('b', {}, name), h('small', {}, sub)), btns);
  const steam = (id) => h('a', { class: 'mini', href: storeUrl(id), target: '_blank', rel: 'noopener' }, 'Steam');

  let rows = [];
  let empty = '';
  if (state.listTab === 'history') {
    empty = 'Nada sorteado ainda. Gire a roleta!';
    rows = state.history.map((x) => row(x.id, x.name, fmt(x.t), steam(x.id)));
    if (rows.length) rows.push(h('button', { class: 'link', style: 'align-self:center;margin-top:8px', onclick: () => { state.history = []; store.set('history', []); renderLists(); } }, 'limpar histórico'));
  } else if (state.listTab === 'played') {
    empty = 'Os jogos que você marcar como "já joguei" ficam aqui e saem das roletas.';
    rows = [...state.played].map(([id, name]) =>
      row(id, name, 'fora das roletas', h('button', { class: 'mini x', onclick: () => { state.played.delete(id); savePlayed(); renderLists(); if (state.view === 'home') showHome(); } }, 'voltar')),
    );
  } else {
    empty = 'Aceite o desafio de um jogo sorteado e ele fica aqui até você jogar.';
    rows = state.challenges.map((c) =>
      row(c.id, c.name, 'desde ' + fmt(c.t),
        h('button', { class: 'mini', onclick: () => { markPlayed(c); state.challenges = state.challenges.filter((x) => x.id !== c.id); store.set('challenges', state.challenges); renderLists(); toast('Desafio concluído!'); } }, 'concluí'),
        h('button', { class: 'mini x', onclick: () => { state.challenges = state.challenges.filter((x) => x.id !== c.id); store.set('challenges', state.challenges); renderLists(); } }, 'x'),
      ),
    );
  }

  drawer.replaceChildren(
    h('div', { class: 'drawer-head' }, h('h3', {}, 'LISTAS'), h('button', { class: 'icon-btn', onclick: closeLists }, 'FECHAR')),
    h('div', { class: 'tabs' }, tabs.map(([k, l, c]) => h('button', { class: 'tab' + (k === state.listTab ? ' on' : ''), onclick: () => { state.listTab = k; renderLists(); } }, `${l} (${c})`))),
    h('div', { class: 'list' }, rows.length ? rows : h('div', { class: 'empty' }, empty)),
  );
}

/* ---------- persistência ---------- */
function savePlayed() { store.set('played', [...state.played]); }
function markPlayed(g) { state.played.set(g.id, g.name); savePlayed(); }
function addChallenge(g) {
  if (state.challenges.some((c) => c.id === g.id)) return;
  state.challenges.unshift({ id: g.id, name: g.name, t: Date.now() });
  store.set('challenges', state.challenges);
}
function pushHistory(g) {
  state.history.unshift({ id: g.id, name: g.name, t: Date.now() });
  state.history = state.history.slice(0, 50);
  store.set('history', state.history);
}
