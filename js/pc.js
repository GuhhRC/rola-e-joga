'use strict';
/* Rola e Joga! — Filtro "Meu PC"
   O robô guarda em cada jogo `pcl` (exigência estimada dos requisitos mínimos): 1 leve, 2 médio, 3 pesado; 0/ausente = não sei.
   O jogador escolhe o nível do PC dele; o sorteio só usa jogos com exigência igual ou menor (jogo sem informação sempre entra).
   Tudo roda no navegador; nada é enviado a servidor. */

const PC_LEVELS = [
  { id: 1, label: 'Leve', hint: 'notebook simples ou vídeo integrado' },
  { id: 2, label: 'Médio', hint: 'ROG Ally, Steam Deck ou placa de entrada' },
  { id: 3, label: 'Forte', hint: 'PC gamer: todos os jogos' },
];
const PC_REQ_LABEL = { 1: 'leve', 2: 'médio', 3: 'pesado' };

// 0 = sem filtro
state.pc = (() => { const v = +store.get('pc', 0); return v >= 1 && v <= 3 ? v : 0; })();

function pcOk(g) {
  return !state.pc || state.pc >= 3 || !g.pcl || g.pcl <= state.pc;
}

function setPc(level) {
  state.pc = state.pc === level ? 0 : level; // tocar de novo no nível ativo desliga o filtro
  store.set('pc', state.pc);
  showHome();
}

// quantos jogos do catálogo já têm a exigência estimada (o robô vai preenchendo aos poucos)
function pcCoverage() {
  const g = state.games;
  if (!g.length) return 0;
  return g.filter((x) => x.pcl).length / g.length;
}

/* Sugere um nível pelo nome da placa de vídeo que o navegador informa. Só uma estimativa. */
function guessPcLevel() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return { mobile: true };
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
  } catch { /* sem WebGL */ }
  const t = gpu.toLowerCase();
  if (!t || /swiftshader|llvmpipe|basic render|software/.test(t)) return { gpu: '' };
  const nameOf = (s) => (s.match(/apple m\d\w*/i) || [])[0] || s.replace(/^ANGLE \(/i, '').replace(/\)$/, '').replace(/,?\s*(Direct3D|OpenGL|Metal|vs_|ps_).*$/i, '').replace(/^[A-Za-z]+,\s*/, '').trim() || s;
  if (/rtx|arc\s?a[57]|rx\s?(5[5-9]\d|[6-9]\d{3})|gtx\s?(10[6-8]0|1660|9[78]0)|radeon\s?(vii|pro w)/.test(t)) return { level: 3, gpu: nameOf(gpu) };
  if (/intel/.test(t) && !/arc/.test(t)) return { level: 1, gpu: nameOf(gpu) };
  if (/mali|adreno|powervr|microsoft/.test(t)) return { level: 1, gpu: nameOf(gpu) };
  return { level: 2, gpu: nameOf(gpu) };
}

function detectPc() {
  const r = guessPcLevel();
  if (r.mobile) { toast('No celular não dá para saber a placa do seu PC. Escolha o nível abaixo.'); return; }
  if (!r.level) { toast('O navegador não informou sua placa de vídeo. Escolha o nível abaixo.'); return; }
  state.pc = r.level;
  store.set('pc', state.pc);
  showHome();
  toast(`Detectei ${r.gpu || 'sua placa'}: nível ${PC_LEVELS[r.level - 1].label}. Ajuste se não for isso.`);
}

function pcPanel() {
  const cur = PC_LEVELS.find((l) => l.id === state.pc);
  const cov = pcCoverage();
  return h('div', { class: 'pc hide-rec' },
    h('div', { class: 'pc-head' },
      h('span', { class: 'pc-title' }, '💻 Meu PC'),
      h('button', { class: 'pc-detect', onclick: detectPc }, 'Detectar'),
    ),
    h('div', { class: 'pc-seg', role: 'group', 'aria-label': 'Nível do seu PC' },
      PC_LEVELS.map((l) => h('button', { class: 'pc-btn' + (state.pc === l.id ? ' on' : ''), 'aria-pressed': String(state.pc === l.id), onclick: () => setPc(l.id) }, l.label))),
    h('div', { class: 'pc-note' },
      cur ? `${cur.label}: ${cur.hint}.` : 'Escolha para sortear só jogos que o seu PC aguenta.',
      cur && cur.id < 3 && cov < 0.5 ? ' O filtro ainda está sendo preenchido pelo robô, então por enquanto vale pouco.' : '',
      cur && cur.id < 3 && cov >= 0.5 ? ' Estimativa pelos requisitos mínimos da Steam.' : '',
    ),
  );
}

// no catálogo o painel fica na aba "Minha biblioteca"; aqui só um aviso quando o filtro está ligado
function pcNote() {
  const cur = PC_LEVELS.find((l) => l.id === state.pc);
  if (!cur || cur.id >= 3) return null;
  return h('div', { class: 'pc-note-line hide-rec' },
    `💻 Só jogos que rodam no PC ${cur.label.toLowerCase()} · `,
    h('button', { class: 'link', onclick: () => setSource('library') }, 'mudar'));
}
