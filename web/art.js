/* Verre — pochettes générées pour les albums sans image, et outils de couleur. */
(() => {
'use strict';
/* ---------- Couleurs & hasard reproductible ---------- */
const hexRgb = h => { h = h.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
const mix = (h1, h2, k) => { const a = hexRgb(h1), b = hexRgb(h2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; };
function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- Pochettes générées (styles choisis par autoArt) ---------- */
const painters = {
  mesh(g, s, R, [a, b, c, d]) {
    g.fillStyle = d; g.fillRect(0, 0, s, s);
    [a, b, c, a, b, c].forEach(col => {
      const x = s * (.1 + R() * .8), y = s * (.1 + R() * .8), r = s * (.4 + R() * .45);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(col, .9)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
  },
  bauhaus(g, s, R, [a, b, c, d]) {
    g.fillStyle = d; g.fillRect(0, 0, s, s);
    const u = s / 3;
    g.save(); g.translate(s / 2, s / 2); g.rotate(Math.floor(R() * 4) * Math.PI / 2); g.translate(-s / 2, -s / 2);
    g.fillStyle = a; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, u * 2, 0, Math.PI / 2); g.fill();
    g.fillStyle = b; g.beginPath(); g.arc(u * 2.15, u * 2.05, u * .95, Math.PI, 0); g.fill();
    g.fillStyle = c; g.fillRect(u * 1.2, u * 2.05, u * 1.9, u * .62);
    g.beginPath(); g.arc(u * 2.35, u * .72, u * .32, 0, 7); g.fill();
    g.lineWidth = s / 80; g.strokeStyle = c; g.beginPath(); g.moveTo(u * .3, u * 2.62); g.lineTo(u * .95, u * 2.62); g.stroke();
    g.restore();
  },
  rings(g, s, R, [a, b, c, d]) {
    const bg = g.createLinearGradient(0, 0, s, s); bg.addColorStop(0, a); bg.addColorStop(1, d);
    g.fillStyle = bg; g.fillRect(0, 0, s, s);
    const cx = s * (.4 + R() * .2), cy = s * (.45 + R() * .2);
    for (let i = 16; i > 0; i--) {
      g.beginPath(); g.arc(cx, cy, i * s * .05, 0, 7);
      g.strokeStyle = mix(b, c, i / 16); g.globalAlpha = .25 + .6 * (1 - i / 16); g.lineWidth = s * .01; g.stroke();
    }
    g.globalAlpha = 1;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, s * .3);
    glow.addColorStop(0, rgba(c, .75)); glow.addColorStop(1, rgba(c, 0));
    g.fillStyle = glow; g.fillRect(0, 0, s, s);
  },
  waves(g, s, R, [a, b, c, d]) {
    g.fillStyle = a; g.fillRect(0, 0, s, s);
    const cols = [b, c, d];
    for (let i = 0; i < 8; i++) {
      const base = s * (.22 + i * .1), amp = s * (.02 + R() * .05), f = (1 + R() * 2) * Math.PI * 2 / s, ph = R() * 6;
      g.beginPath(); g.moveTo(0, s);
      for (let x = 0; x <= s; x += s / 120) g.lineTo(x, base + Math.sin(x * f + ph) * amp);
      g.lineTo(s, s); g.closePath();
      g.fillStyle = rgba(cols[i % 3], .35 + i * .07); g.fill();
    }
  },
  grid(g, s, R, [a, b, c, d]) {
    g.fillStyle = a; g.fillRect(0, 0, s, s);
    const n = 15, st = s / n, fx = s * (.3 + R() * .4), fy = s * (.3 + R() * .4);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i + .5) * st, y = (j + .5) * st, dist = Math.hypot(x - fx, y - fy) / s;
      g.fillStyle = mix(b, c, (i + j) / (2 * n));
      g.beginPath(); g.arc(x, y, st * .46 * Math.max(.07, 1 - dist * 1.5), 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(fx, fy, 0, fx, fy, s * .5); gl.addColorStop(0, rgba(d, .55)); gl.addColorStop(1, rgba(d, 0));
    g.fillStyle = gl; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'source-over';
  },
};

// grain léger, comme une pochette imprimée
function grain(g, s, amt = 13) {
  const im = g.getImageData(0, 0, s, s), p = im.data;
  for (let i = 0; i < p.length; i += 4) { const n = (Math.random() - .5) * amt; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  g.putImageData(im, 0, 0);
}

const PALETTES = [
  ['#FF6B4A', '#FF2E63', '#FFC15E', '#2B1055'], ['#0C3B3C', '#3FD0B6', '#B6F5D8', '#0A2224'], ['#03045E', '#0077B6', '#48CAE4', '#CAF0F8'],
  ['#0E0126', '#FF00A8', '#00C2FF', '#7A00FF'], ['#C8553D', '#F28F3B', '#2F5D62', '#F7DCC6'], ['#C9184A', '#FFB703', '#7A1034', '#1B0710'],
  ['#1D2D44', '#F0EBD8', '#748CAB', '#0D1321'], ['#5F0F40', '#FB8B24', '#E36414', '#0F4C5C'],
];
function autoArt(seed) {
  const R = seeded(seed);
  return { style: ['mesh', 'rings', 'waves', 'grid', 'bauhaus', 'mesh'][Math.floor(R() * 6)], colors: PALETTES[Math.floor(R() * PALETTES.length)] };
}

// une image par album et par taille, dessinée une seule fois
const coverCache = new Map();
function cover(album, size = 600) {
  const key = album.title + '|' + album.artist + '|' + size;
  let url = coverCache.get(key);
  if (url) return url;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  painters[album.art.style](g, size, seeded(album.title + album.artist), album.art.colors);
  grain(g, size);
  url = c.toDataURL('image/jpeg', .9);
  coverCache.set(key, url);
  return url;
}

window.Art = { cover, autoArt, hexRgb, mix };
})();
