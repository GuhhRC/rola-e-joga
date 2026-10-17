#!/usr/bin/env node
// Junta index.html + style.css + config.js + js/*.js + dados em UM arquivo (preview.html) que abre com duplo clique.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (f) => readFile(path.join(ROOT, f), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const [html, css, cfg, games, genres] = await Promise.all([
  r('index.html'), r('style.css'), r('config.js'), r('data/games.json'), r('data/genres.json'),
]);
// os scripts do app, na ordem em que aparecem no index.html
const files = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map((m) => m[1]);
const js = (await Promise.all(files.map(r))).join('\n');

const out = html
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace(/<script src="js\/[^"]+"><\/script>\n?/g, '')
  .replace('<script src="config.js"></script>', () =>
    `<script>window.__PREVIEW__=true;window.__GAMES__=${safe(games)};window.__GENRES__=${safe(genres)};</script>\n<script>\n${safe(cfg)}\n</script>\n<script>\n${safe(js)}\n</script>`);

if (!out.includes('__PREVIEW__')) throw new Error('make-preview: não achei os scripts no index.html');
await writeFile(path.join(ROOT, 'preview.html'), out);
console.log('preview.html gerado (' + Math.round(out.length / 1024) + ' KB)');
