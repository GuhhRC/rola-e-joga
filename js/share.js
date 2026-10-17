'use strict';
/* Rola e Joga! — Card de compartilhamento 1080x1920, texto e link do resultado
   Scripts clássicos compartilham o mesmo escopo; a ordem está no index.html. */

/* ==========================================================================
   Card de compartilhamento 1080x1920 (stories / reels / tiktok)
   ========================================================================== */
function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
function roundRect(x, px, py, w, hgt, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + hgt, r);
  x.arcTo(px + w, py + hgt, px, py + hgt, r);
  x.arcTo(px, py + hgt, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
function wrapLines(x, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (x.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

// logo: anel, raios, miolo e ponteiro (mesmo desenho do cabeçalho)
function drawLogo(x, cx, cy, r) {
  x.save();
  x.lineJoin = 'round';
  x.fillStyle = ACC();
  x.strokeStyle = ACC();
  // fatias alternadas (12 fatias, as pares preenchidas)
  x.globalAlpha = 0.85;
  for (let i = 0; i < 12; i += 2) {
    const a0 = -Math.PI / 2 + (i * TAU) / 12;
    x.beginPath();
    x.moveTo(cx, cy);
    x.arc(cx, cy, r, a0, a0 + TAU / 12);
    x.closePath();
    x.fill();
  }
  x.globalAlpha = 1;
  // anel com brilho
  x.shadowColor = ACCA(0.6);
  x.shadowBlur = r * 0.5;
  x.lineWidth = r * 0.17;
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.stroke();
  x.shadowBlur = 0;
  // miolo
  x.fillStyle = '#0a0a0a';
  x.lineWidth = r * 0.13;
  x.beginPath();
  x.arc(cx, cy, r * 0.27, 0, TAU);
  x.fill();
  x.stroke();
  // ponteiro apontando para dentro da roda, com contorno escuro
  x.fillStyle = ACC();
  x.strokeStyle = '#0a0a0a';
  x.lineWidth = r * 0.14;
  x.beginPath();
  x.moveTo(cx - r * 0.39, cy - r * 1.32);
  x.lineTo(cx + r * 0.39, cy - r * 1.32);
  x.lineTo(cx, cy - r * 0.5);
  x.closePath();
  x.stroke();
  x.fill();
  x.restore();
}

async function makeCard(g) {
  const W = 1080;
  const H = 1920;
  const cv = h('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  const sans = '"Inter", system-ui, sans-serif';
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  x.textAlign = 'center';

  x.fillStyle = '#0a0a0a';
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 760, 40, W / 2, 760, 780);
  glow.addColorStop(0, ACCA(0.22));
  glow.addColorStop(1, ACCA(0));
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = ACCA(0.05);
  x.lineWidth = 2;
  for (let i = 0; i <= W; i += 90) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  for (let j = 0; j <= H; j += 90) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }

  // marca: logo + ROLA e JOGA!
  const parts = [['ROLA', '#e8efe9', 58], ['e', '#7d8c83', 36], ['JOGA', ACC(), 58], ['!', ACC(), 58]];
  if ('letterSpacing' in x) x.letterSpacing = '4px';
  const widths = parts.map(([t, , size]) => { x.font = `700 ${size}px ${mono}`; return x.measureText(t).width; });
  const logoR = 38;
  const gap = 30;
  const textW = widths.reduce((a, b) => a + b, 0) + 14;
  let px = (W - (logoR * 2 + gap + textW)) / 2;
  drawLogo(x, px + logoR, 196, logoR);
  px += logoR * 2 + gap;
  x.textAlign = 'left';
  parts.forEach(([t, color, size], i) => {
    x.font = `700 ${size}px ${mono}`;
    x.fillStyle = color;
    x.fillText(t, px, 214);
    px += widths[i] + (i === 0 ? 7 : i === 1 ? 7 : 0);
  });
  x.textAlign = 'center';

  x.font = `700 44px ${mono}`;
  x.fillStyle = ACC();
  x.fillText('A ROLETA MANDOU:', W / 2, 430);
  if ('letterSpacing' in x) x.letterSpacing = '0px';

  // capa
  const cx = 80, cy = 500, cw = 920, ch = 430;
  const img = await loadImg(coverUrl(g.id));
  x.save();
  x.shadowColor = ACCA(0.55);
  x.shadowBlur = 60;
  roundRect(x, cx, cy, cw, ch, 22);
  x.fillStyle = '#0c110e';
  x.fill();
  x.restore();
  if (img) {
    x.save();
    roundRect(x, cx, cy, cw, ch, 22);
    x.clip();
    x.drawImage(img, cx, cy, cw, ch);
    x.restore();
  }
  roundRect(x, cx, cy, cw, ch, 22);
  x.lineWidth = 4;
  x.strokeStyle = ACC();
  x.stroke();

  // nome
  x.fillStyle = '#e8efe9';
  x.font = `700 96px ${sans}`;
  const lines = wrapLines(x, g.name, 920, 3);
  let y = 1090;
  for (const l of lines) { x.fillText(l, W / 2, y); y += 112; }

  // números
  const bits = [];
  if (g.approval != null) bits.push(g.approval + '% positivas');
  const price = g.free ? 'Grátis' : isLib() ? null : g.price;
  if (price) bits.push(price);
  if (g.year) bits.push(String(g.year));
  x.font = `500 40px ${mono}`;
  x.fillStyle = '#7d8c83';
  y += 14;
  if (bits.length) { x.fillText(bits.join('  ·  '), W / 2, y); y += 66; }
  const gl = (g.genres || []).map(labelOf).filter(Boolean).slice(0, 3).join('  /  ');
  if (gl) { x.fillStyle = ACC(); x.fillText(gl, W / 2, y); }

  // rodapé
  x.fillStyle = '#7d8c83';
  x.font = `500 38px ${mono}`;
  x.fillText('Gire a sua em', W / 2, 1750);
  x.fillStyle = '#e8efe9';
  x.font = `700 46px ${mono}`;
  x.fillText(CFG.siteLabel || CFG.siteName, W / 2, 1812);
  return cv;
}

const ACCA = (a) => (document.body.classList.contains('adult') ? `rgba(255,59,78,${a})` : `rgba(46,234,122,${a})`);

/* Link do resultado: abre o site direto no jogo sorteado (#j=<id>) */
function siteBase() {
  const fixed = String(CFG.siteUrl || '').replace(/\/$/, '');
  if (fixed) return fixed + '/';
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
function shareUrl(g) {
  return siteBase() + (state.byId.has(g.id) && !state.adult ? `#j=${g.id}` : '');
}
const SHARE_TEXTS = [
  'A roleta decidiu: eu vou jogar {name}. Sem volta! Gira a sua: {url}',
  'Tirei {name} na roleta do Rola e Joga! Agora eu tenho que jogar. Gira a sua: {url}',
  'Pedi um jogo de {genre} e a roleta mandou {name}. Gira a sua: {url}',
  'Indeciso demais para escolher, então a roleta escolheu: {name}. Tenta a sua: {url}',
];
function shareText(g) {
  const list = Array.isArray(CFG.shareTexts) && CFG.shareTexts.length ? CFG.shareTexts : SHARE_TEXTS;
  const genre = (g.genres || []).map(labelOf).find(Boolean);
  // textos com {genre} só quando o jogo tem gênero
  const ok = list.filter((t) => (genre && !state.adult) || !t.includes('{genre}'));
  const t = (ok.length ? ok : SHARE_TEXTS.filter((x) => !x.includes('{genre}')))[Math.floor(Math.random() * (ok.length || 1))];
  return String(t).replaceAll('{name}', g.name).replaceAll('{genre}', genre || 'jogo').replaceAll('{url}', shareUrl(g));
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sem permissão de área de transferência */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

async function shareCard(g, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  const text = shareText(g);
  try {
    const cv = await makeCard(g);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('sem imagem');
    const file = new File([blob], `rola-e-joga-${g.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // alguns apps ignoram o texto quando há imagem: por isso o texto também vai para a área de transferência
      await copyText(text);
      await navigator.share({ files: [file], text });
      toast('Texto com link copiado também.');
    } else {
      const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      toast((await copyText(text)) ? 'Card salvo e texto com link copiado.' : 'Card salvo (1080x1920).');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('Não consegui gerar o card.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
