'use strict';
/* Rola e Joga! — Modo gravação, controles do topo e teclado
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   Modo gravação e controles do topo
   ========================================================================== */
function setRec(on) {
  state.rec = on;
  stage.classList.toggle('rec', on);
  document.body.classList.toggle('rec', on);
  $('#recExit').hidden = !on;
  $('#btnRec').classList.toggle('on', on);
  if (on) { closeModal(); closeLists(); }
  updateAds();
}
function renderSound() {
  const b = $('#btnSound');
  b.classList.toggle('muted', state.mute);
  b.setAttribute('aria-pressed', String(!state.mute));
}

$('#btnRec').addEventListener('click', () => setRec(!state.rec));
$('#recExit').addEventListener('click', () => setRec(false));
$('#btnLists').addEventListener('click', () => openLists());
$('#btnSound').addEventListener('click', () => {
  state.mute = !state.mute;
  store.set('mute', state.mute);
  renderSound();
  if (!state.mute) { unlockAudio(); tick(); }
});
$back.addEventListener('click', () => { if (!state.busy) showHome(); });

document.addEventListener('keydown', (e) => {
  if (viewer) { // visualizador de prints tem prioridade
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowRight') viewer.go(1);
    else if (e.key === 'ArrowLeft') viewer.go(-1);
    else return;
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (!modal.hidden) closeModal();
    else if (!drawer.hidden) closeLists();
    else if (state.rec) setRec(false);
    return;
  }
  if ((e.key === ' ' || e.key === 'Enter') && state.curSpin && modal.hidden && drawer.hidden) {
    if (e.target && /^(BUTTON|A|INPUT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    state.curSpin();
  }
});
