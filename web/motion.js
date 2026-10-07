/* Écho — moteur d'animations : ressorts physiques (comme motion.dev) rendus en CSS `linear()`,
 * transitions d'élément partagé (pochette → fiche), indicateur qui glisse entre deux éléments,
 * inclinaison 3D au survol. Aucune dépendance : Web Animations API uniquement. */
(() => {
'use strict';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
const supportsLinear = CSS.supports('animation-timing-function', 'linear(0, 1)');

/* ---------- Ressort → courbe d'accélération ----------
 * Même modèle que motion.dev : raideur (stiffness), amortissement (damping), masse.
 * On échantillonne la position du ressort et on la convertit en `linear(...)` que CSS et
 * la Web Animations API savent lire ; la durée est le temps que met le ressort à se poser. */
function spring({ stiffness = 170, damping = 20, mass = 1, velocity = 0 } = {}) {
  const w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = zeta < 1 ? w0 * Math.sqrt(1 - zeta * zeta) : 0;
  const pos = zeta < 1
    ? t => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 - velocity) / wd * Math.sin(wd * t))
    : t => 1 - (1 + (w0 - velocity) * t) * Math.exp(-w0 * t);
  let duration = .25;
  for (let t = .1; t < 3; t += .01) { duration = t; if (Math.abs(1 - pos(t)) < .0015 && Math.abs(pos(t) - pos(t - .02)) < .001) break; }
  const n = 64, pts = [];
  for (let i = 0; i < n; i++) pts.push(pos(duration * i / n).toFixed(4));
  pts.push('1');
  return { easing: supportsLinear ? `linear(${pts.join(',')})` : 'cubic-bezier(.3,1.2,.4,1)', duration: Math.round(duration * 1000) };
}

/* Réglages nommés, exposés en variables CSS : --sp-<nom> (courbe) et --sd-<nom> (durée). */
const SPRINGS = {
  bouncy: spring({ stiffness: 320, damping: 17 }),   // rebond franc : apparitions, boutons, menus
  snappy: spring({ stiffness: 520, damping: 34 }),   // vif, presque sans rebond : survols, indicateurs
  smooth: spring({ stiffness: 190, damping: 24 }),   // ample : fiches, lecteur, transitions partagées
  gentle: spring({ stiffness: 110, damping: 16 }),   // lent et souple : grands déplacements
};
for (const [name, s] of Object.entries(SPRINGS)) {
  root.style.setProperty(`--sp-${name}`, s.easing);
  root.style.setProperty(`--sd-${name}`, (reduced ? 0 : s.duration) + 'ms');
}

/* ---------- Animation d'un élément avec un ressort ---------- */
function animate(el, keyframes, { spring: name = 'smooth', delay = 0, fill = 'both', ...rest } = {}) {
  const s = SPRINGS[name] || SPRINGS.smooth;
  if (reduced) { const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : null; if (last) Object.assign(el.style, last); return { finished: Promise.resolve(), cancel() {} }; }
  return el.animate(keyframes, { duration: s.duration, easing: s.easing, delay, fill, ...rest });
}

/* ---------- Élément partagé : une image « vole » d'un endroit à l'autre ----------
 * `from` : élément visible au départ ; `to` : élément à sa place d'arrivée (déjà dans la page).
 * On clone `from`, on le place par-dessus, on l'anime jusqu'au rectangle de `to`, puis on le retire. */
const flights = new Set();
function fly(from, to, { spring: name = 'smooth', radius, fromRect, toRect } = {}) {
  if (reduced || !from || !to) return Promise.resolve();
  const a = fromRect || from.getBoundingClientRect(), b = toRect || to.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const ghost = from.cloneNode(true);
  ghost.className = 'fly';
  const r0 = getComputedStyle(from).borderRadius, r1 = radius || getComputedStyle(to).borderRadius;
  Object.assign(ghost.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px',
    margin: 0, zIndex: 60, pointerEvents: 'none', borderRadius: r0, transformOrigin: '0 0', objectFit: 'cover', boxShadow: '0 30px 60px -20px rgba(0,0,0,.6)' });
  document.body.appendChild(ghost);
  flights.add(ghost);
  const prevVis = to.style.visibility; to.style.visibility = 'hidden';
  const dx = b.left - a.left, dy = b.top - a.top, sx = b.width / a.width, sy = b.height / a.height;
  const anim = animate(ghost, [
    { transform: 'translate(0,0) scale(1,1)', borderRadius: r0 },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, borderRadius: `calc(${r1} / ${sx})` },
  ], { spring: name });
  const done = () => { ghost.remove(); flights.delete(ghost); to.style.visibility = prevVis; };
  return anim.finished.then(done, done);
}
function cancelFlights() { for (const g of flights) { g.remove(); } flights.clear(); }

/* ---------- Indicateur qui glisse (sélection de la barre latérale, saisons…) ----------
 * `ind` est un élément absolu dans `container` ; on le déplace sur `target` avec un ressort. */
function slideTo(ind, target, container, { spring: name = 'snappy', first = false } = {}) {
  if (!target) { ind.style.opacity = '0'; return; }
  // position de mise en page (indépendante des transformations en cours, ex. animation de lancement)
  let x = 0, y = 0;
  for (let el = target; el && el !== container; el = el.offsetParent) { x += el.offsetLeft; y += el.offsetTop; }
  for (let el = target.parentElement; el && el !== container; el = el.parentElement) { x -= el.scrollLeft; y -= el.scrollTop; }
  const to = { x, y, w: target.offsetWidth, h: target.offsetHeight };
  const from = ind._pos;
  ind._pos = to;
  ind.style.opacity = '1';
  Object.assign(ind.style, { width: to.w + 'px', height: to.h + 'px', transform: `translate(${to.x}px, ${to.y}px)` });
  if (!from || first || reduced) return;
  ind.animate([
    { transform: `translate(${from.x}px, ${from.y}px)`, width: from.w + 'px', height: from.h + 'px' },
    { transform: `translate(${to.x}px, ${to.y}px)`, width: to.w + 'px', height: to.h + 'px' },
  ], { duration: SPRINGS[name].duration, easing: SPRINGS[name].easing });
}

/* ---------- Inclinaison 3D et reflet qui suivent la souris ----------
 * Délégué : un seul écouteur par zone ; chaque élément `selector` reçoit --rx, --ry, --mx, --my. */
function tilt(zone, selector, { max = 7 } = {}) {
  if (reduced) return;
  let current = null;
  zone.addEventListener('pointermove', e => {
    const el = e.target.closest(selector);
    if (el !== current) { if (current) leave(current); current = el; if (el) el.classList.add('tilting'); }
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', ((px - .5) * 2 * max).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((.5 - py) * 2 * max).toFixed(2) + 'deg');
    el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
    el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  });
  const leave = el => { el.classList.remove('tilting'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
  zone.addEventListener('pointerleave', () => { if (current) leave(current); current = null; });
  zone.addEventListener('pointerdown', () => { if (current) leave(current); });
}

/* ---------- Petit « pop » : rejoue une animation CSS sur un élément ---------- */
function pop(el, cls = 'pop') { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

/* ---------- Texte qui défile s'il déborde (titre long dans le lecteur) ---------- */
function marquee(el, text) {
  el.classList.remove('marquee');
  el.textContent = text;
  if (reduced) return;
  requestAnimationFrame(() => {
    if (el.scrollWidth <= el.clientWidth + 2) return;
    el.innerHTML = `<span>${el.textContent.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`;
    el.firstChild.innerHTML += `<i aria-hidden="true">${el.firstChild.innerHTML}</i>`;
    el.style.setProperty('--mq', (el.firstChild.scrollWidth / 2 + 36) + 'px');
    el.style.setProperty('--mqd', Math.max(8, el.firstChild.scrollWidth / 60) + 's');
    el.classList.add('marquee');
  });
}

window.Motion = { reduced, spring, SPRINGS, animate, fly, cancelFlights, slideTo, tilt, pop, marquee };
})();
