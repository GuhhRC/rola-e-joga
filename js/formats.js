'use strict';
/* Rola e Joga! — Formatos de roleta e opções da tela "Quantos jogos?".
   Para criar um formato novo: crie o motor (createXxx(pool) → { el, spin(w), reset() }), registre em FORMATS
   e acrescente as quantidades em QTY_OPTIONS. O resto do app (resultado, gravação, +18) funciona sozinho. */

const FORMATS = {
  wheel: { label: 'roleta', accepts: (n) => n >= 2 && n <= WHEEL_MAX, make: (pool) => createWheel(pool.map((g) => g.name)) },
  die: { label: 'dado d20', accepts: (n) => n === 20, make: (pool) => createDie(pool) },
  reel: { label: 'slot', accepts: (n) => n > WHEEL_MAX, make: (pool) => createReel(pool) },
};

// botões da tela de quantidade, na ordem em que aparecem
const QTY_OPTIONS = [
  { q: 10, fmt: 'wheel' },
  { q: 20, fmt: 'wheel' },
  { q: 20, fmt: 'die' },
  { q: 30, fmt: 'reel' },
  { q: 40, fmt: 'reel' },
  { q: 50, fmt: 'reel' },
  { q: 100, fmt: 'reel' },
];

// formato pedido → formato que realmente serve para esta quantidade (ex.: sobraram só 12 jogos → roleta)
function resolveFormat(fmt, n) {
  if (FORMATS[fmt] && FORMATS[fmt].accepts(n)) return fmt;
  return n > WHEEL_MAX ? 'reel' : 'wheel';
}
