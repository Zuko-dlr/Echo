/* Écho — interface : musique, films et séries, lecteurs audio et vidéo.
 * Les données et les fichiers viennent du Mac (Native.call / Native.on). */
(() => {
'use strict';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Pont avec le Mac ---------- */
const Native = window.Native = {
  bus: {},
  on(ev, fn) { (this.bus[ev] ||= []).push(fn); },
  emit(ev, data) { (this.bus[ev] || []).forEach(fn => fn(data)); },
  call(cmd, args = {}) { return window.webkit.messageHandlers.native.postMessage({ cmd, args }); },
};
const log = msg => Native.call('log', { msg });

// erreurs de l'interface → journal du Mac (visible en mode débogage)
addEventListener('error', e => log(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', e => log('promesse rejetée : ' + (e.reason && e.reason.message || e.reason)));

/* ---------- Outils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => r.querySelectorAll(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
// URL placée dans url('…') en CSS : on encode les caractères qui pourraient en sortir
const cssUrl = u => esc(String(u || '').replace(/['()\\\s"]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')));
const bgImg = u => `background-image:url('${cssUrl(u)}')`;
// n'écrit le HTML que s'il a changé (évite de reconstruire la page, ses images et sa mise en page)
const put = (el, html, force) => { if (force || el._html !== html) { el.innerHTML = html; el._html = html; } };
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const pad2 = n => String(n).padStart(2, '0');
function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = pad2(s % 60);
  return h ? `${h}:${pad2(m)}:${sec}` : `${m}:${sec}`;
}
const runtime = min => !min ? '' : min >= 60 ? `${Math.floor(min / 60)} h ${pad2(min % 60)}` : `${min} min`;
const size = b => b >= 1e9 ? nf1.format(b / 1e9) + ' Go' : Math.round(b / 1e6) + ' Mo';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const shuffled = list => { const q = [...list]; for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; } return q; };

const S_ = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const SKIP = '<path d="M2 6.3v11.4c0 .8.9 1.3 1.6.8L12 13.2v4.5c0 .8.9 1.3 1.6.8l9.1-5.7c.6-.4.6-1.3 0-1.7l-9.1-5.7c-.7-.4-1.6.1-1.6.8v4.5L3.6 5.5C2.9 5 2 5.5 2 6.3z"/>';
const SPEAKER = '<path fill="currentColor" d="M3.5 9.5h3.2L11 5.9c.4-.3 1-.1 1 .5v11.2c0 .6-.6.8-1 .5l-4.3-3.6H3.5c-.6 0-1-.4-1-1v-3c0-.6.4-1 1-1z"/>';
const TEN = x => `<text x="${x}" y="15.3" font-size="6.6" font-weight="700" text-anchor="middle" fill="currentColor" font-family="-apple-system, sans-serif">10</text>`;
const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5v14c0 .8.9 1.3 1.6.9l11-7c.6-.4.6-1.3 0-1.7l-11-7C8.4 3.7 7.5 4.2 7.5 5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.3" height="16" rx="1.3"/><rect x="14.2" y="4" width="4.3" height="16" rx="1.3"/></svg>',
  next: `<svg viewBox="0 0 28 24" fill="currentColor">${SKIP}</svg>`,
  prev: `<svg viewBox="0 0 28 24" fill="currentColor"><g transform="matrix(-1 0 0 1 28 0)">${SKIP}</g></svg>`,
  shuffle: `<svg viewBox="0 0 24 24" ${S_}><path d="M3 7h2.6c2.1 0 3.4 1.1 4.6 3.1l1.9 3.5c1.2 2.1 2.5 3.4 4.8 3.4H21M18 14l3 3-3 3M3 17h2.6c1.5 0 2.6-.6 3.6-1.7M13.4 8.7c1-1.1 2.2-1.7 3.6-1.7H21M18 4l3 3-3 3"/></svg>`,
  close: `<svg viewBox="0 0 24 24" ${S_}><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" ${S_}><path d="m6 9.5 6 6 6-6"/></svg>`,
  search: `<svg viewBox="0 0 24 24" ${S_}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" ${S_}><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" ${S_}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`,
  album: `<svg viewBox="0 0 24 24" ${S_}><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".7" fill="currentColor"/></svg>`,
  note: `<svg viewBox="0 0 24 24" ${S_}><path d="M9 18V6.5l10-2.2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>`,
  film: `<svg viewBox="0 0 24 24" ${S_}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/></svg>`,
  tv: `<svg viewBox="0 0 24 24" ${S_}><rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8.5 20.5h7"/></svg>`,
  disk: `<svg viewBox="0 0 24 24" ${S_}><rect x="3" y="7.5" width="18" height="10" rx="2.5"/><path d="M6.5 12.5h5"/><circle cx="17" cy="12.5" r=".9" fill="currentColor"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" ${S_}><path d="M4 7h10M18.5 7H20M4 17h2M10.5 17H20"/><circle cx="16.2" cy="7" r="2.3"/><circle cx="8.2" cy="17" r="2.3"/></svg>`,
  back10: `<svg viewBox="0 0 24 24"><g ${S_}><path d="M12 4.5a7.5 7.5 0 1 1-7.2 5.4"/><path d="M4.2 4.8v5.1h5.1"/></g>${TEN(12.6)}</svg>`,
  fwd10: `<svg viewBox="0 0 24 24"><g ${S_}><path d="M12 4.5a7.5 7.5 0 1 0 7.2 5.4"/><path d="M19.8 4.8v5.1h-5.1"/></g>${TEN(11.4)}</svg>`,
  full: `<svg viewBox="0 0 24 24" ${S_}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  vol: `<svg viewBox="0 0 24 24">${SPEAKER}<path ${S_} d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a7.8 7.8 0 0 1 0 10.8"/></svg>`,
  vlow: `<svg viewBox="0 0 24 24">${SPEAKER}</svg>`,
  warn: `<svg viewBox="0 0 24 24" ${S_}><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  external: `<svg viewBox="0 0 24 24" ${S_}><path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>`,
  playlist: `<svg viewBox="0 0 24 24" ${S_}><path d="M4 6.5h10M4 11.5h10M4 16.5h6"/><path d="M18.5 16.5V6.8l2.5-.8"/><circle cx="16.3" cy="16.8" r="2.2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" ${S_}><path d="M12 5v14M5 12h14"/></svg>`,
  plusCircle: `<svg viewBox="0 0 24 24" ${S_}><circle cx="12" cy="12" r="8.5"/><path d="M12 8.2v7.6M8.2 12h7.6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" ${S_}><path d="M5 7h14M10 7V5.2h4V7M7 7l.9 12.2h8.2L17 7M10.3 10.5v5.5M13.7 10.5v5.5"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24" ${S_}><path d="M4.5 19.5h4l10.3-10.3a2.1 2.1 0 0 0-4-4L4.5 15.5z"/></svg>`,
};

/* ---------- Éléments fixes de la page ---------- */
const wall = $('#wall'), nav = $('#nav'), main = $('#main'), scroll = $('#scroll'), sheet = $('#sheet');
const side = $('.side'), navInd = $('#nav-ind'), fAmbient = $('#f-ambient');
const player = $('#player'), pArt = $('.p-art'), fArt = $('.f-art'), pPlay = $('#p-play'), fPlay = $('.f-play');
const pLine = $('.p-line i'), fBar = $('#f-bar i'), fPos = $('#f-pos'), fRem = $('#f-rem');
const video = $('#video'), vp = $('#vplayer'), vLayer = $('#v-layer'), vPlay = $('#v-play');
const vFill = $('#v-track .fill'), vKnob = $('#v-track .knob'), vPos = $('#v-pos'), vRem = $('#v-rem');
const menu = $('#menu'), dialog = $('#dialog'), dlgInput = $('#dlg-input'), dlgOk = $('#dlg-ok'), dlgText = $('#dlg-text');

/* ---------- Données ---------- */
let S = { albums: [], movies: [], shows: [], volumes: [], settings: { musicFolders: [], videoFolders: [], hasKey: false }, progress: {}, status: null };
function adopt(state) {
  S = state;
  for (const a of S.albums) {
    if (!a.art) a.spec = Art.autoArt(a.title + a.artist);
    if (!a.colors) a.colors = (a.spec || Art.autoArt(a.title + a.artist)).colors;
    for (const t of a.tracks) t.album = a;
  }
  S.tracks = S.albums.flatMap(a => a.tracks);
  S.trackById = new Map(S.tracks.map(t => [t.id, t]));
  S.playlists = S.playlists || [];
  // morceau introuvable (disque débranché) : on garde ses infos pour l'afficher grisé
  for (const pl of S.playlists) pl.items = pl.tracks.map(e => S.trackById.get(e.id) || {
    id: e.id, title: e.title, artist: e.artist, duration: 0, missing: true,
    album: { title: e.album, art: null, spec: Art.autoArt(e.album + e.artist), colors: null } });
}
const albumArt = (a, px = 600) => a.art || Art.cover({ title: a.title, artist: a.artist, art: a.spec }, px);
const resumable = p => p && p.pos > 60 && p.dur && p.pos < p.dur * .92;
const watched = p => p && p.dur && p.pos >= p.dur * .92;
const pct = p => (p.pos / p.dur * 100).toFixed(1);

/* ---------- Fond aux couleurs du contenu ---------- */
// couleurs par défaut, celles de l'écran d'ouverture : rose, pêche et prune en grand, l'ambre en touche
// (assez profondes pour que le texte blanc et gris reste lisible, comme avec les couleurs des pochettes)
const DEFAULT = ['#b4435f', '#c46a4a', '#7d2850', '#12060c'], DEFAULT_C4 = '#b07a2e';
function toHsl(hex) {
  const [r, g, b] = Art.hexRgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
function toHex([h, s, l]) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}
// luminosité perçue (un jaune paraît bien plus clair qu'un bleu à « l » égal)
const luma = hex => { const [r, g, b] = Art.hexRgb(hex).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
/** Couleurs d'une pochette/affiche rendues sûres pour le fond : on écarte les quasi-blancs et les gris,
 *  et on plafonne la luminosité pour que le texte blanc et le verre restent lisibles (affiches très claires). */
function safePalette(colors) {
  if (!colors || colors.length < 4) return null;
  const hsl = colors.map(toHsl);
  let vivid = hsl.slice(0, 3).filter(([, s, l]) => s >= .12 && l > .08 && l < .9);
  if (!vivid.length) vivid = hsl.filter(([, s, l]) => s >= .12 && l > .06 && l < .92);
  if (!vivid.length) return null;
  while (vivid.length < 3) vivid.push(vivid[vivid.length % vivid.length]);
  const tamed = vivid.slice(0, 3).map(([h, s, l]) => {
    s = Math.min(s, .85); l = Math.max(.2, Math.min(l, .44));
    while (l > .18 && luma(toHex([h, s, l])) > .16) l -= .02;   // plafond : le blanc reste lisible
    return toHex([h, s, l]);
  });
  const [bh, bs, bl] = hsl[3];
  const base = toHex(bs >= .12 ? [bh, bs, Math.min(bl, .1)] : [vivid[0][0], vivid[0][1] * .6, .08]);
  return [...tamed, base];
}
function paint(colors) {
  const c = safePalette(colors) || DEFAULT, def = c === DEFAULT;
  ['--c1', '--c2', '--c3'].forEach((k, i) => wall.style.setProperty(k, c[i]));
  wall.style.setProperty('--c4', def ? DEFAULT_C4 : Art.mix(c[3], c[0], .5));
  // fond presque noir : le halo coloré reste un halo, le texte et le verre restent lisibles
  const base = def ? c[3] : Art.mix(c[3], '#000000', .6);
  wall.style.setProperty('--base', base);
  document.documentElement.style.setProperty('--base', base);
  if (window.Shader) Shader.setColors([c[0], c[1], c[2], def ? DEFAULT_C4 : Art.mix(c[3], c[0], .5), base]);
}
const paintCurrent = () => paint(Player.track ? Player.track.album.colors : null);

/* ---------- Lecteur de musique ---------- */
const audio = new Audio();
const Player = {
  queue: [], index: -1, playing: false,
  get track() { return this.queue[this.index] || null; },
  get duration() { const t = this.track; return !t ? 0 : isFinite(audio.duration) ? audio.duration : t.duration || 0; },
  get position() { return this.track ? audio.currentTime : 0; },
  playAlbum(a, i = 0) { this.playList(a.tracks, i); },
  playList(list, i = 0) { this.queue = list; this._load(i); this.play(); },
  _load(i) { this.index = i; audio.src = this.track.url; showTrack(this.track); },
  play() {
    if (!this.track) return;
    if (VP.isOpen) VP.close();
    audio.play().catch(e => log(`lecture audio refusée : ${e.name} ${e.message} (${audio.src})`));
    this.playing = true; showPlayState();
  },
  pause() { audio.pause(); this.playing = false; showPlayState(); },
  toggle() { if (this.playing) this.pause(); else if (this.track) this.play(); else if (S.albums[0]) this.playAlbum(S.albums[0]); },
  next() { if (!this.queue.length) return; this._load((this.index + 1) % this.queue.length); this.play(); },
  // fin d'un morceau : suivant, ou arrêt à la fin de la file
  advance() { if (this.index < this.queue.length - 1) return this.next(); this.pause(); this.seek(0); },
  prev() { if (this.position > 3) return this.seek(0); if (!this.queue.length) return; this._load((this.index - 1 + this.queue.length) % this.queue.length); this.play(); },
  seek(sec) { audio.currentTime = sec; syncNowPlaying(); drawSoon(); },
};
audio.volume = .8;
audio.addEventListener('ended', () => Player.advance());
audio.addEventListener('error', () => log(`erreur audio ${audio.error && audio.error.code} ${audio.error && audio.error.message} (${audio.src})`));
// position affichée : à chaque image seulement pendant la lecture ; sinon une fois, quand elle change
audio.addEventListener('timeupdate', drawSoon);
audio.addEventListener('durationchange', drawSoon);

function syncNowPlaying() {
  const t = Player.track;
  if (!t) return Native.call('nowPlaying', {});
  Native.call('nowPlaying', { title: t.title, artist: t.artist, album: t.album.title, duration: Player.duration,
    position: Player.position, playing: Player.playing, art: t.album.art || '' });
}

/* ---------- Navigation ---------- */
let view = 'albums', query = '';
const TITLES = { albums: 'Albums', artists: 'Artistes', songs: 'Morceaux', movies: 'Films', shows: 'Séries' };

function renderNav() {
  const counts = { albums: S.albums.length, movies: S.movies.length, shows: S.shows.length };
  const item = (id, ic, label) => `<a href="#" data-view="${id}" class="${view === id ? 'on' : ''}">${ic}${label}${counts[id] ? `<span class="n">${counts[id]}</span>` : ''}</a>`;
  const disks = S.volumes.length ? S.volumes.map(v => `
      <div class="disk${v.mounted ? '' : ' off'}" title="${v.mounted ? 'Branché' : 'Débranché'}">${ICON.disk}
        <div style="min-width:0"><b>${esc(v.name)}</b><span>${[v.movies && plural(v.movies, 'film', 'films'), v.episodes && plural(v.episodes, 'épisode', 'épisodes')].filter(Boolean).join(' · ') || (v.mounted ? 'Aucune vidéo' : 'Débranché')}</span></div>
        <i class="dot"></i></div>`).join('')
    : `<div class="disk-empty">Branchez un disque : ses films et séries apparaîtront ici tout seuls.</div>`;
  put(nav, `
    <div class="sec">Musique</div>${item('albums', ICON.album, 'Albums')}${item('artists', ICON.mic, 'Artistes')}${item('songs', ICON.note, 'Morceaux')}
    <div class="sec">Playlists</div>${S.playlists.map(pl => `<a href="#" data-view="pl:${pl.id}" data-pl-drop="${pl.id}" class="${view === 'pl:' + pl.id ? 'on' : ''}">${ICON.playlist}<span class="nm">${esc(pl.name)}</span>${pl.tracks.length ? `<span class="n">${pl.tracks.length}</span>` : ''}</a>`).join('')}
    <a href="#" data-action="new-playlist" class="new">${ICON.plus}Nouvelle playlist</a>
    <div class="sec">Vidéos</div>${item('movies', ICON.film, 'Films')}${item('shows', ICON.tv, 'Séries')}
    <div class="sec">Disques</div>${disks}`);
  placeNavInd();
}
// la pastille de sélection glisse vers le lien actif (une seule pastille pour toute la barre)
let navFirst = true;
function placeNavInd() {
  const on = $('#nav a.on');
  Motion.slideTo(navInd, on, side, { first: navFirst });
  navFirst = false;
}
nav.addEventListener('scroll', () => Motion.slideTo(navInd, $('#nav a.on'), side, { first: true }), { passive: true });
addEventListener('resize', () => Motion.slideTo(navInd, $('#nav a.on'), side, { first: true }));
$('#open-settings').innerHTML = ICON.settings + 'Réglages';

function go(v) { view = v; query = ''; closeSheet(); render(true); }
// grand titre qui se compacte dès qu'on fait défiler
scroll.addEventListener('scroll', () => scroll.classList.toggle('scrolled', scroll.scrollTop > 28), { passive: true });
// vignettes et cartes qui s'inclinent sous la souris
Motion.tilt(scroll, '.tile, .card');
nav.addEventListener('click', e => {
  const act = e.target.closest('[data-action]'); if (act) { e.preventDefault(); return action(act.dataset.action); }
  const a = e.target.closest('a[data-view]'); if (!a) return; e.preventDefault(); go(a.dataset.view);
});

const emptyCard = (icon, title, text, button = '') => `<div class="empty glass">${icon}<h2>${title}</h2><p>${text}</p>${button}</div>`;

function posterPic(item) {
  const src = item.poster || item.thumb;
  const [c1, c2] = item.colors || Art.autoArt(item.title).colors;
  return src ? `<img src="${esc(src)}" alt="" loading="lazy">`
    : `<div class="ph" style="background:linear-gradient(160deg, ${c1}, ${c2})">${esc(item.title)}</div>`;
}
const pbar = p => resumable(p) ? `<div class="pbar"><i style="width:${pct(p)}%"></i></div>` : '';
const checkMark = p => watched(p) ? `<i class="check">${ICON.check}</i>` : '';

function render(animate) {
  renderNav();
  if (view.startsWith('pl:')) return renderPlaylist(animate);
  const q = query.toLowerCase(), match = (...fields) => !q || fields.some(f => String(f || '').toLowerCase().includes(q));
  const n = { albums: S.albums.length, movies: S.movies.length, shows: S.shows.length }[view];
  let count = '';
  if (view === 'albums' || view === 'artists' || view === 'songs') count = `${plural(S.albums.length, 'album', 'albums')} · ${plural(S.tracks.length, 'morceau', 'morceaux')}`;
  else if (view === 'movies') count = plural(n, 'film', 'films');
  else count = `${plural(n, 'série', 'séries')} · ${plural(S.shows.reduce((s, x) => s + x.seasons.reduce((k, y) => k + y.episodes.length, 0), 0), 'épisode', 'épisodes')}`;

  let body = '';
  const musicEmpty = () => emptyCard(ICON.note, 'Aucune musique pour l’instant',
    'Indiquez le dossier où se trouve votre musique. Si elle est sur un disque externe, branchez-le simplement.',
    `<button class="pill primary" data-action="add-music">${ICON.folder}Ajouter un dossier de musique</button>`);
  const noResult = () => emptyCard(ICON.search, 'Aucun résultat', `Rien ne correspond à « ${esc(query)} ».`);

  if (view === 'albums') {
    const list = S.albums.filter(a => match(a.title, a.artist));
    body = !S.albums.length ? musicEmpty() : !list.length ? noResult()
      : `<div class="grid">${list.map((a, i) => `<button class="tile" data-album="${a.id}" style="--i:${i}"><div class="pic"><img src="${esc(albumArt(a, 400))}" alt="" loading="lazy"><span class="tplay" role="button" aria-label="Lire l’album" data-play-album="${a.id}">${ICON.play}</span></div><div class="t">${esc(a.title)}</div><div class="a">${esc(a.artist)}</div></button>`).join('')}</div>`;
  } else if (view === 'artists') {
    const seen = new Map(); S.albums.forEach(a => seen.has(a.artist) || seen.set(a.artist, a));
    const list = [...seen.values()].filter(a => match(a.artist));
    body = !S.albums.length ? musicEmpty() : !list.length ? noResult()
      : `<div class="grid">${list.map((a, i) => `<button class="tile round" data-artist="${esc(a.artist)}" style="--i:${i}"><div class="pic"><img src="${esc(albumArt(a, 400))}" alt=""></div><div class="t">${esc(a.artist)}</div></button>`).join('')}</div>`;
  } else if (view === 'songs') {
    const list = S.tracks.filter(t => match(t.title, t.artist, t.album.title));
    body = !S.albums.length ? musicEmpty() : !list.length ? noResult()
      : `<div class="list glass">${list.map((t, i) => `<button class="row${Player.track === t ? ' current' : ''}" data-track="${t.id}" draggable="true" style="--i:${i}"><img src="${esc(albumArt(t.album, 120))}" alt="" loading="lazy"><span class="ti">${esc(t.title)}</span><span class="dim">${esc(t.artist)}</span><span class="dim">${esc(t.album.title)}</span><span class="d">${t.duration ? fmt(t.duration) : '—'}</span><span class="addto" role="button" title="Ajouter à une playlist" data-add-track="${t.id}">${ICON.plusCircle}</span></button>`).join('')}</div>`;
  } else {
    const isMovies = view === 'movies', all = isMovies ? S.movies : S.shows;
    const items = all.filter(x => match(x.title));
    if (!all.length) {
      body = emptyCard(isMovies ? ICON.film : ICON.tv, isMovies ? 'Aucun film trouvé' : 'Aucune série trouvée',
        `Branchez le disque qui contient vos ${isMovies ? 'films' : 'séries'} : il est détecté automatiquement. Vous pouvez aussi ajouter un dossier du Mac.`,
        `<button class="pill primary" data-action="add-video">${ICON.folder}Ajouter un dossier de vidéos</button>`);
    } else if (!items.length) body = noResult();
    else {
      if (!S.settings.hasKey) body += `<div class="banner glass" style="--i:0"><p><b>Affiches et résumés</b> : ajoutez votre clé TMDB pour afficher les vraies affiches, les résumés et le nom des épisodes.</p><button class="pill primary" data-action="settings">Ajouter la clé</button></div>`;
      if (!query) body += continueShelf(isMovies);
      body += `<div class="grid posters">${items.map((x, i) => {
        const off = isMovies ? !x.files.some(f => f.available) : !x.seasons.some(s => s.episodes.some(e => e.file.available));
        const sub = isMovies ? (x.year || '') : plural(x.seasons.length, 'saison', 'saisons');
        const p = isMovies && x.files[0] ? S.progress[x.files[0].id] : null;
        const playable = !off && (isMovies ? x.files.some(f => f.available && f.native) : true);
        return `<button class="tile${off ? ' off' : ''}" data-${isMovies ? 'movie' : 'show'}="${x.id}" style="--i:${i + 1}">
          <div class="pic">${posterPic(x)}${off ? `<span class="badge">${ICON.disk}Débranché</span>` : ''}${pbar(p)}${playable ? `<span class="tplay" role="button" aria-label="Lire" data-play-${isMovies ? 'movie' : 'show'}="${x.id}">${ICON.play}</span>` : ''}</div>
          <div class="t">${esc(x.title)}${checkMark(p)}</div><div class="a">${esc(sub)}</div></button>`;
      }).join('')}</div>`;
    }
  }

  put(scroll, `<div class="top"><h1 style="--i:0">${TITLES[view]}</h1><span class="count" style="--i:1">${count}</span>
    <label class="search glass" style="--i:2">${ICON.search}<input id="search" type="search" placeholder="Rechercher" value="${esc(query)}" autocomplete="off" spellcheck="false"></label></div>
    <div class="${animate ? 'enter' : ''}">${body}</div>`, animate);
  if (animate) { scroll.scrollTop = 0; scroll.classList.remove('scrolled'); }
  if (document.activeElement === document.body && query) $('#search').focus();
}

function continueShelf(isMovies) {
  const items = [];
  if (isMovies) {
    for (const m of S.movies) for (const f of m.files) { const p = S.progress[f.id]; if (resumable(p) && f.available) items.push({ p, m }); }
  } else {
    for (const s of S.shows) for (const se of s.seasons) for (const e of se.episodes) {
      const p = S.progress[e.file.id]; if (resumable(p) && e.file.available) items.push({ p, show: s, ep: e });
    }
  }
  if (!items.length) return '';
  items.sort((a, b) => b.p.at - a.p.at);
  return `<div class="shelf-title">Reprendre</div><div class="shelf">${items.slice(0, 4).map((x, i) => {
    const bar = `<div class="pbar"><i style="width:${pct(x.p)}%"></i></div>`;
    const left = Math.max(1, Math.round((x.p.dur - x.p.pos) / 60));
    if (isMovies) return `<button class="card" data-resume-movie="${x.m.id}" style="--i:${i + 1}"><div class="pic" style="${bgImg(x.m.backdrop || x.m.thumb || x.m.poster)}">${bar}</div><div class="t">${esc(x.m.title)}</div><div class="a">Encore ${left} min</div></button>`;
    return `<button class="card" data-resume-ep="${x.ep.id}" data-show-id="${x.show.id}" style="--i:${i + 1}"><div class="pic" style="${bgImg(x.ep.still || x.show.backdrop)}">${bar}</div><div class="t">${esc(x.show.title)}</div><div class="a">S${x.ep.s} · É${x.ep.e} — encore ${left} min</div></button>`;
  }).join('')}</div>`;
}

scroll.addEventListener('input', e => {
  if (e.target.id !== 'search') return;
  query = e.target.value;
  const pos = e.target.selectionStart;
  render(false);
  const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos);
});
scroll.addEventListener('click', e => {
  const t = e.target;
  const add = t.closest('[data-add-track]'); if (add) { e.stopPropagation(); return openAddMenu([add.dataset.addTrack], add); }
  // bouton « lecture » posé sur la pochette ou l'affiche : lit sans ouvrir la fiche
  const pa = t.closest('[data-play-album]'); if (pa) { e.stopPropagation(); return Player.playAlbum(S.albums.find(a => a.id === pa.dataset.playAlbum)); }
  const pm = t.closest('[data-play-movie]'); if (pm) { e.stopPropagation(); return playMovie(S.movies.find(m => m.id === pm.dataset.playMovie)); }
  const ps = t.closest('[data-play-show]'); if (ps) { e.stopPropagation(); const s = S.shows.find(x => x.id === ps.dataset.playShow); return s && playEpisode(s, nextEpisode(episodes(s))); }
  const rmb = t.closest('[data-rm]'); if (rmb) { e.stopPropagation(); return Native.call('playlistRemove', { id: currentPlaylist().id, index: +rmb.dataset.rm }); }
  const plb = t.closest('[data-pl]'); if (plb) return playlistAction(plb.dataset.pl);
  const prow = t.closest('.prow'); if (prow) return playFromPlaylist(+prow.dataset.index);
  const act = t.closest('[data-action]'); if (act) return action(act.dataset.action);
  const al = t.closest('[data-album]'); if (al) return openAlbum(S.albums.find(a => a.id === al.dataset.album));
  const ar = t.closest('[data-artist]'); if (ar) { query = ar.dataset.artist; view = 'albums'; return render(true); }
  const tr = t.closest('[data-track]'); if (tr) return Player.playList(S.tracks, S.tracks.findIndex(x => x.id === tr.dataset.track));
  const mv = t.closest('[data-movie]'); if (mv) return openMovie(S.movies.find(m => m.id === mv.dataset.movie));
  const sh = t.closest('[data-show]'); if (sh) return openShow(S.shows.find(s => s.id === sh.dataset.show));
  const rm = t.closest('[data-resume-movie]'); if (rm) return playMovie(S.movies.find(m => m.id === rm.dataset.resumeMovie));
  const re = t.closest('[data-resume-ep]');
  if (re) { const s = S.shows.find(x => x.id === re.dataset.showId); const ep = s && episodes(s).find(x => x.id === re.dataset.resumeEp); if (ep) playEpisode(s, ep); }
});

function action(a) {
  if (a === 'add-music') return Native.call('addFolder', { kind: 'music' });
  if (a === 'add-video') return Native.call('addFolder', { kind: 'video' });
  if (a === 'settings') return openSettings();
  if (a === 'new-playlist') return newPlaylist([]);
}

/* ---------- Fiches ---------- */
let sheetCtx = null, reopening = false;
/** Rectangle qu'aura `target` quand `container` sera revenu au repos (sans sa transformation d'entrée). */
function restRect(container, target, styles) {
  const saved = {}; for (const k in styles) { saved[k] = container.style[k]; container.style[k] = styles[k]; }
  const prevT = container.style.transition; container.style.transition = 'none';
  const r = target.getBoundingClientRect();
  for (const k in styles) container.style[k] = saved[k];
  void container.offsetWidth; container.style.transition = prevT;
  return r;
}
// image dont est partie la fiche ouverte (pochette ou affiche de la grille), pour le vol retour
let sheetSource = null;
/** `fly` : { from: élément de la grille, to: sélecteur dans la fiche } → l'image vole de l'un à l'autre. */
function showSheet(html, { scrolly = false, narrow = false, colors = null, fly = null } = {}) {
  const keep = reopening && sheet.classList.contains('open');
  sheet.className = 'sheet glass tint' + (scrolly ? ' scrolly' : '') + (narrow ? ' narrow' : '') + (keep ? ' open' : '');
  sheet.innerHTML = `<button class="sheet-close" aria-label="Fermer">${ICON.close}</button>` + html;
  sheet.scrollTop = 0;
  if (!keep) {
    Motion.cancelFlights();
    sheetSource = fly && fly.from || null;
    const target = fly && $(fly.to, sheet);
    const toRect = target && restRect(sheet, target, { transform: 'none' });
    void sheet.offsetWidth;
    sheet.classList.add('open');
    if (target && toRect) Motion.fly(fly.from, target, { toRect, radius: getComputedStyle(target).borderRadius });
  }
  sheet.setAttribute('aria-hidden', 'false');
  main.classList.add('sheet-open');
  if (colors) paint(colors);
}
function closeSheet() {
  if (!sheetCtx) return;
  const ctx = sheetCtx;
  sheetCtx = null;
  sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true');
  main.classList.remove('sheet-open');
  // la pochette revole vers sa vignette si elle est encore affichée
  const back = sheetSource && sheetSource.isConnected && (ctx.type === 'album' ? $('.sheet-head img', sheet) : $('.m-poster', sheet));
  if (back) Motion.fly(back, sheetSource, { toRect: restRect(scroll, sheetSource, { transform: 'none', filter: 'none' }), spring: 'snappy' });
  sheetSource = null;
  paintCurrent();
}
// fiche redessinée (données mises à jour, saison choisie…) sans perdre la position de défilement
function reopen(open, item) { const y = sheet.scrollTop; reopening = true; try { open(item); } finally { reopening = false; } sheet.scrollTop = y; }
// vignette de la grille correspondant à un élément (pour faire voler son image)
const tileImg = sel => { const t = $(sel, scroll); return t && (t.querySelector('.pic img, .pic .ph') || null); };

function openAlbum(a) {
  if (!a) return;
  sheetCtx = { type: 'album', id: a.id };
  const mins = Math.round(a.tracks.reduce((s, t) => s + (t.duration || 0), 0) / 60);
  showSheet(`
    <div class="sheet-head"><img src="${esc(albumArt(a, 400))}" alt="">
      <div><h2 style="--i:0">${esc(a.title)}</h2><div class="artist" style="--i:1">${esc(a.artist)}</div>
        <div class="meta" style="--i:2">${[a.genre, a.year, plural(a.tracks.length, 'morceau', 'morceaux'), mins ? mins + ' min' : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="pills" style="--i:3"><button class="pill primary" data-a="play">${ICON.play}Lire</button><button class="pill soft" data-a="shuffle">${ICON.shuffle}Aléatoire</button><button class="pill soft" data-a="add-album">${ICON.plusCircle}Ajouter à une playlist</button></div></div></div>
    <div class="rows">${a.tracks.map((t, i) => `<button class="row arow${Player.track === t ? ' current' : ''}" data-i="${i}" data-track-id="${t.id}" draggable="true" style="--i:${i}"><span class="n"><span class="num">${t.n || i + 1}</span><span class="eq"><i></i><i></i><i></i></span></span><span class="ti">${esc(t.title)}</span><span class="addto" role="button" title="Ajouter à une playlist" data-add-track="${t.id}">${ICON.plusCircle}</span><span class="d">${t.duration ? fmt(t.duration) : '—'}</span></button>`).join('')}</div>`,
    { fly: { from: tileImg(`.tile[data-album="${a.id}"]`), to: '.sheet-head img' } });
}

const infoLine = (x, second) => [x.year, second, (x.genres || []).slice(0, 2).join(', '), x.rating ? '★ ' + nf1.format(x.rating) : ''].filter(Boolean).map(String);
// la note « ★ 7,8 » prend la couleur de l'étoile ; le reste est séparé par des points médians
const infoHtml = parts => parts.map(p => p.startsWith('★') ? `<span class="star">${esc(p)}</span>` : esc(p)).join('<span class="sep"> · </span>');
const movieLine = (m, plain) => { const parts = infoLine(m, runtime(m.runtime)); return plain ? parts.join(' · ') : infoHtml(parts); };
// image de fond + affiche + titre des fiches film et série
const mediaHead = (x, title, line, pills) => `
    <div class="hero" style="${bgImg(x.backdrop || x.thumb)}"></div>
    <div class="m-head"><div class="pic">${x.poster || x.thumb ? `<img class="m-poster" src="${esc(x.poster || x.thumb)}" alt="">` : `<div class="m-poster ph" style="background:linear-gradient(160deg, ${(x.colors || DEFAULT)[0]}, ${(x.colors || DEFAULT)[1]})">${esc(x.title)}</div>`}</div>
      <div><h2 style="--i:0">${title}</h2><div class="m-line" style="--i:1">${line}</div>${pills}</div></div>
    ${x.overview ? `<p class="m-overview" style="--i:3">${esc(x.overview)}</p>` : ''}`;

function openMovie(m) {
  if (!m) return;
  sheetCtx = { type: 'movie', id: m.id, json: JSON.stringify(m) };
  const f = m.files.find(x => x.available) || m.files[0];
  const p = f && S.progress[f.id];
  let buttons;
  if (!f || !f.available) buttons = `<button class="pill primary" disabled>${ICON.play}Lire</button>`;
  else if (!f.native) buttons = `<button class="pill primary" data-a="external">${ICON.play}Lire</button>`;
  else if (resumable(p)) buttons = `<button class="pill primary" data-a="resume">${ICON.play}Reprendre à ${fmt(p.pos)}</button><button class="pill soft" data-a="start">Depuis le début</button>`;
  else buttons = `<button class="pill primary" data-a="start">${ICON.play}Lire</button>`;
  showSheet(mediaHead(m, esc(m.title) + checkMark(p), movieLine(m), `<div class="pills" style="--i:2">${buttons}</div>`) + `
    <div class="m-file" style="--i:4">${fileLine(f)}
      ${S.settings.hasKey ? `<button data-a="match">Ce n’est pas le bon film ?</button>` : ''}</div>`,
    { scrolly: true, colors: m.colors, fly: { from: tileImg(`.tile[data-movie="${m.id}"]`), to: '.m-poster' } });
}

function fileLine(f) {
  if (!f) return '';
  const where = f.available ? `Disque « ${esc(f.volume)} »` : `<span class="m-warn">${ICON.warn}Branchez le disque « ${esc(f.volume)} » pour lire</span>`;
  return `<span>${esc(f.ext.toUpperCase())} · ${size(f.size)}</span><span>${where}</span>${!f.native && f.available ? '<span>Format lu par Elmedia Player</span>' : ''}${f.available ? `<button data-a="reveal" data-path="${esc(f.path)}">Afficher dans le Finder</button>` : ''}`;
}

const episodes = s => s.seasons.flatMap(x => x.episodes);
// épisode à reprendre, sinon le premier pas encore vu, sinon le premier
const nextEpisode = all => all.find(e => resumable(S.progress[e.file.id])) || all.find(e => !watched(S.progress[e.file.id])) || all[0];

let showSeason = null;
function openShow(s) {
  if (!s) return;
  if (!sheetCtx || sheetCtx.id !== s.id) showSeason = null;
  const season = s.seasons.find(x => x.n === showSeason) || s.seasons[0];
  showSeason = season.n;
  sheetCtx = { type: 'show', id: s.id, json: JSON.stringify(s) };
  const nextEp = nextEpisode(episodes(s));
  const avail = nextEp && nextEp.file.available;
  const label = nextEp && resumable(S.progress[nextEp.file.id]) ? `Reprendre S${nextEp.s} É${nextEp.e}` : `Lire S${nextEp.s} É${nextEp.e}`;
  const line = infoHtml(infoLine(s, plural(s.seasons.length, 'saison', 'saisons')));
  // position de la sélection de saison avant redessin : la nouvelle glissera depuis là
  const prevSeg = $('.seg-ind', sheet)?._pos;
  showSheet(mediaHead(s, esc(s.title), line, `
        <div class="pills" style="--i:2"><button class="pill primary" data-a="next-ep" ${avail ? '' : 'disabled'}>${ICON.play}${label}</button></div>`) + `
    ${s.seasons.length > 1 ? `<div class="seasons" style="--i:4"><i class="seg-ind"></i>${s.seasons.map(x => `<button data-season="${x.n}" class="${x.n === season.n ? 'on' : ''}">${x.n ? 'Saison ' + x.n : 'Hors saison'}</button>`).join('')}</div>` : '<div style="height:22px"></div>'}
    <div class="eps">${season.episodes.map((e, i) => {
      const p = S.progress[e.file.id];
      return `<button class="ep${e.file.available ? '' : ' off'}" data-ep="${e.id}" style="--i:${i}">
        <div class="pic" style="${bgImg(e.still)}">${pbar(p)}</div>
        <div style="min-width:0"><b>${e.e}. ${esc(e.title)}${checkMark(p)}</b><span>${[runtime(e.runtime), e.file.native ? '' : e.file.ext.toUpperCase() + ' · Elmedia Player', e.file.available ? '' : 'Disque « ' + esc(e.file.volume) + ' » débranché'].filter(Boolean).join(' · ')}</span>${e.overview ? `<p>${esc(e.overview)}</p>` : ''}</div>
        <span class="go">${ICON.play}</span></button>`;
    }).join('')}</div>
    <div class="m-file">${S.settings.hasKey ? `<button data-a="match">Ce n’est pas la bonne série ?</button>` : ''}</div>`,
    { scrolly: true, colors: s.colors, fly: { from: tileImg(`.tile[data-show="${s.id}"]`), to: '.m-poster' } });
  const seg = $('.seg-ind', sheet);
  if (seg) { if (prevSeg) seg._pos = prevSeg; Motion.slideTo(seg, $('.seasons .on', sheet), seg.parentElement, { first: !prevSeg }); }
}

function openSettings() {
  sheetCtx = { type: 'settings' };
  const key = S.settings.hasKey;
  const folders = list => list.length ? list.map(p => `<div class="folder">${ICON.folder}<span>${esc(p.replace(/^\/Users\/[^/]+/, '~'))}</span><button data-remove="${esc(p)}" aria-label="Retirer">${ICON.close}</button></div>`).join('')
    : `<p class="small">Aucun dossier.</p>`;
  showSheet(`<div class="set">
    <h2>Réglages</h2>
    <section><h3>Affiches et infos des films (TMDB)</h3>
      <p>Créez un compte gratuit sur <span class="link" data-url="https://www.themoviedb.org/signup">themoviedb.org</span>, puis ouvrez <span class="link" data-url="https://www.themoviedb.org/settings/api">Paramètres → API</span> et copiez la « Clé d’API ». Seuls les titres de vos films et séries sont envoyés à TMDB.</p>
      <div class="field"><input id="tmdb-key" type="text" placeholder="${key ? 'Clé enregistrée — collez-en une autre pour la remplacer' : 'Collez votre clé d’API TMDB'}" autocomplete="off" spellcheck="false">
        <button class="pill primary" data-s="save-key">Enregistrer</button></div>
      <div class="msg${key ? ' ok' : ''}" id="key-msg">${key ? 'Clé active : les affiches sont téléchargées automatiquement.' : ''}</div>
      ${key ? `<p class="small" style="margin-top:8px"><span class="link" data-s="remove-key">Supprimer la clé</span></p>` : ''}
    </section>
    <section><h3>Dossiers de musique</h3><div class="folders">${folders(S.settings.musicFolders)}</div>
      <button class="pill soft" data-s="add-music">${ICON.folder}Ajouter un dossier…</button></section>
    <section><h3>Dossiers de vidéos</h3><p>Les disques externes sont analysés automatiquement dès qu’ils sont branchés ; ajoutez ici les dossiers du Mac.</p><div class="folders">${folders(S.settings.videoFolders)}</div>
      <button class="pill soft" data-s="add-video">${ICON.folder}Ajouter un dossier…</button></section>
    <section><h3>Bibliothèque</h3><p>Relance l’analyse de tous les dossiers et disques, et la recherche des affiches manquantes.</p>
      <div class="pills"><button class="pill soft" data-s="rescan">Analyser à nouveau</button></div></section>
    <section><p class="small">Films et séries : données et images fournies par TMDB. Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB. Les fichiers MKV et AVI s’ouvrent dans Elmedia Player.</p></section>
  </div>`, { scrolly: true, narrow: true });
}

function openMatch(kind, item) {
  sheetCtx = { type: 'match', id: item.id, kind, key: item.key };
  showSheet(`<div class="set"><h2>${kind === 'movie' ? 'Choisir le bon film' : 'Choisir la bonne série'}</h2>
    <p>Fichier reconnu comme « ${esc(item.title)} ». Cherchez le bon titre puis cliquez sur l’affiche correspondante.</p>
    <div class="field"><input id="match-q" type="search" value="${esc(item.title)}" spellcheck="false"><button class="pill primary" data-s="match-search">Rechercher</button></div>
    <div class="msg" id="match-msg"></div>
    <div class="match-grid" id="match-results"></div></div>`, { scrolly: true, narrow: true });
  matchSearch();
}
async function matchSearch() {
  const q = $('#match-q').value.trim(); if (!q) return;
  const msg = (text, cls = '') => { const m = $('#match-msg'); m.textContent = text; m.className = 'msg' + cls; };
  msg('Recherche…');
  try {
    const res = JSON.parse(await Native.call('search', { kind: sheetCtx.kind, query: q }));
    $('#match-msg').textContent = res.length ? '' : 'Aucun résultat.';
    $('#match-results').innerHTML = res.map(r => `<button data-match="${r.id}">${r.poster ? `<img src="${esc(r.poster)}" alt="">` : `<div class="ph">${esc(r.title)}</div>`}<b>${esc(r.title)}</b><span>${esc(r.year)}</span></button>`).join('');
  } catch (e) { msg(String(e.message || e), ' err'); }
}

sheet.addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('.sheet-close')) return closeSheet();
  const ctx = sheetCtx; if (!ctx) return;
  const a = t.closest('[data-a]')?.dataset.a;
  if (ctx.type === 'album') {
    const al = S.albums.find(x => x.id === ctx.id);
    const add = t.closest('[data-add-track]'); if (add) return openAddMenu([add.dataset.addTrack], add);
    if (a === 'add-album') return openAddMenu(al.tracks.map(x => x.id), t.closest('[data-a]'));
    if (a === 'play') return Player.playAlbum(al);
    if (a === 'shuffle') return Player.playList(shuffled(al.tracks), 0);
    const row = t.closest('.row'); if (row) return Player.playAlbum(al, +row.dataset.i);
  }
  if (ctx.type === 'movie') {
    const m = S.movies.find(x => x.id === ctx.id); if (!m) return;
    if (a === 'resume' || a === 'external') return playMovie(m);
    if (a === 'start') return playMovie(m, true);
    if (a === 'reveal') return Native.call('reveal', { path: t.closest('[data-path]').dataset.path });
    if (a === 'match') return openMatch('movie', m);
  }
  if (ctx.type === 'show') {
    const s = S.shows.find(x => x.id === ctx.id); if (!s) return;
    const all = episodes(s);
    if (a === 'next-ep') return playEpisode(s, nextEpisode(all));
    if (a === 'match') return openMatch('tv', s);
    const sb = t.closest('[data-season]'); if (sb) { showSeason = +sb.dataset.season; return reopen(openShow, s); }
    const epb = t.closest('[data-ep]'); if (epb) { const ep = all.find(x => x.id === epb.dataset.ep); if (ep && ep.file.available) playEpisode(s, ep, true); }
  }
  if (ctx.type === 'settings') {
    const link = t.closest('[data-url]'); if (link) return Native.call('openURL', { url: link.dataset.url });
    const rm = t.closest('[data-remove]'); if (rm) return Native.call('removeFolder', { path: rm.dataset.remove });
    const s = t.closest('[data-s]')?.dataset.s;
    if (s === 'add-music' || s === 'add-video') return Native.call('addFolder', { kind: s === 'add-music' ? 'music' : 'video' });
    if (s === 'rescan') { Native.call('rescan'); return closeSheet(); }
    if (s === 'remove-key') { await Native.call('setKey', { key: '' }); return; }
    if (s === 'save-key') {
      const key = $('#tmdb-key').value.trim(), msg = $('#key-msg');
      const say = (text, cls = '') => { msg.textContent = text; msg.className = 'msg' + cls; };
      if (!key) return say('Collez d’abord votre clé.', ' err');
      say('Vérification auprès de TMDB…');
      try { await Native.call('setKey', { key }); say('Clé valide : recherche des affiches en cours.', ' ok'); $('#tmdb-key').value = ''; }
      catch (err) { say(String(err.message || err), ' err'); }
    }
  }
  if (ctx.type === 'match') {
    if (t.closest('[data-s="match-search"]')) return matchSearch();
    const r = t.closest('[data-match]');
    if (r) { await Native.call('setMatch', { key: ctx.key, id: +r.dataset.match }); closeSheet(); }
  }
});
sheet.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'match-q') matchSearch();
  if (e.target.id === 'tmdb-key') $('[data-s="save-key"]').click();
});
$('#open-settings').onclick = openSettings;

/* ---------- Lecteur vidéo ---------- */
const fullScreen = () => Native.call('toggleFullScreen');
const VP = {
  isOpen: false, item: null, from: 0, lastSave: 0, idleTimer: 0,
  open(item, from = 0) {
    if (Player.playing) Player.pause();
    closeLayer();
    this.item = item; this.isOpen = true; this.from = from;
    $('#v-title').textContent = item.title; $('#v-sub').textContent = item.sub || '';
    vp.classList.add('open'); vp.setAttribute('aria-hidden', 'false');
    video.src = item.url;
    video.play().catch(() => {});
    this.wake();
  },
  close() {
    if (!this.isOpen) return;
    this.save(true);
    this.isOpen = false; this.from = 0;
    video.pause(); video.removeAttribute('src'); video.load();
    vp.classList.remove('open', 'idle'); vp.setAttribute('aria-hidden', 'true');
    closeLayer();
    Native.call('nowPlaying', {});
    render(false);
    if (sheetCtx && sheetCtx.type === 'movie') reopen(openMovie, S.movies.find(m => m.id === sheetCtx.id));
    if (sheetCtx && sheetCtx.type === 'show') reopen(openShow, S.shows.find(s => s.id === sheetCtx.id));
  },
  save(force) {
    if (!this.item || !isFinite(video.duration) || !video.duration) return;
    const now = Date.now();
    if (!force && now - this.lastSave < 5000) return;
    this.lastSave = now;
    const p = { pos: video.ended ? video.duration : video.currentTime, dur: video.duration, at: now / 1000 };
    S.progress[this.item.id] = p;
    Native.call('saveProgress', { id: this.item.id, pos: p.pos, dur: p.dur });
  },
  wake() {
    vp.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!video.paused) vp.classList.add('idle'); }, 2600);
  },
  toggle() { video.paused ? video.play() : video.pause(); },
  skip(d) { video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + d)); this.wake(); },
  syncNowPlaying() {
    if (!this.item) return;
    Native.call('nowPlaying', { title: this.item.title, artist: this.item.sub || '', album: '', duration: video.duration || 0, position: video.currentTime, playing: !video.paused, art: '' });
  },
};
function closeLayer() { vLayer.innerHTML = ''; }
$('#v-close').innerHTML = ICON.close; $('#v-back').innerHTML = ICON.back10; $('#v-fwd').innerHTML = ICON.fwd10; $('#v-full').innerHTML = ICON.full; vPlay.innerHTML = ICON.pause;
$('#v-close').onclick = () => VP.close();
vPlay.onclick = () => VP.toggle();
$('#v-back').onclick = () => VP.skip(-10);
$('#v-fwd').onclick = () => VP.skip(10);
$('#v-full').onclick = fullScreen;
$('#v-volume').oninput = e => { video.volume = +e.target.value; e.target.style.setProperty('--v', e.target.value * 100 + '%'); };
vp.addEventListener('mousemove', () => VP.wake());
video.addEventListener('click', () => VP.toggle());
video.addEventListener('dblclick', fullScreen);
// reprise à la position enregistrée (un seul écouteur, pour la vidéo ouverte en dernier)
video.addEventListener('loadedmetadata', () => { const from = VP.from; VP.from = 0; if (from > 0 && from < video.duration - 5) video.currentTime = from; });
video.addEventListener('play', () => { vPlay.innerHTML = ICON.pause; VP.wake(); VP.syncNowPlaying(); });
video.addEventListener('pause', () => { vPlay.innerHTML = ICON.play; VP.wake(); VP.save(true); VP.syncNowPlaying(); });
video.addEventListener('timeupdate', () => {
  const d = video.duration || 0, p = video.currentTime;
  const w = d ? (p / d * 100).toFixed(2) + '%' : '0%';
  vFill.style.width = w; vKnob.style.left = w;
  vPos.textContent = fmt(p); vRem.textContent = '-' + fmt(d - p);
  VP.save(false);
  if (VP.item && VP.item.next && d && d - p < 25 && !vLayer.querySelector('.v-next')) showNext();
});
video.addEventListener('ended', () => { VP.save(true); if (VP.item && VP.item.next) VP.item.next(); });
video.addEventListener('error', () => {
  if (!VP.isOpen || !video.getAttribute('src')) return;
  vLayer.innerHTML = `<div class="v-msg glass tint"><h3>Cette vidéo ne peut pas être lue ici</h3><p>Son format n’est pas pris en charge par le lecteur intégré.</p><button class="pill primary" id="v-ext">${ICON.external}Ouvrir dans Elmedia Player</button></div>`;
  $('#v-ext').onclick = () => { Native.call('openExternal', { path: VP.item.path }); VP.close(); };
});
function showNext() {
  const n = VP.item.nextInfo; if (!n) return;
  vLayer.innerHTML = `<button class="v-next glass tint" id="v-next"><div class="pic" style="${bgImg(n.still)}"></div><div style="min-width:0;text-align:left"><span>Épisode suivant</span><b>${esc(n.label)}</b></div></button>`;
  $('#v-next').onclick = () => VP.item.next();
}
(() => {
  const track = $('#v-track');
  const seekTo = e => { const r = track.getBoundingClientRect(); video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (video.duration || 0); };
  track.addEventListener('mousedown', e => {
    seekTo(e);
    const up = () => { removeEventListener('mousemove', seekTo); removeEventListener('mouseup', up); VP.syncNowPlaying(); };
    addEventListener('mousemove', seekTo); addEventListener('mouseup', up);
  });
})();

function playMovie(m, fromStart) {
  const f = m && m.files.find(x => x.available);
  if (!f) return;
  if (!f.native) return Native.call('openExternal', { path: f.path });
  const p = S.progress[f.id];
  VP.open({ id: f.id, url: f.url, path: f.path, title: m.title, sub: movieLine(m, true) }, !fromStart && resumable(p) ? p.pos : 0);
}
function playEpisode(s, ep, fromStart) {
  if (!ep || !ep.file.available) return;
  if (!ep.file.native) return Native.call('openExternal', { path: ep.file.path });
  const all = episodes(s), next = all[all.indexOf(ep) + 1];
  const ok = next && next.file.available && next.file.native;
  const p = S.progress[ep.file.id];
  VP.open({
    id: ep.file.id, url: ep.file.url, path: ep.file.path, title: s.title, sub: `Saison ${ep.s} · Épisode ${ep.e} — ${ep.title}`,
    nextInfo: ok ? { label: `S${next.s} É${next.e} · ${next.title}`, still: next.still } : null,
    next: ok ? () => playEpisode(s, next, true) : null,
  }, !fromStart && resumable(p) ? p.pos : 0);
}

/* ---------- Playlists ---------- */
const currentPlaylist = () => S.playlists.find(p => 'pl:' + p.id === view);

function renderPlaylist(animate) {
  const pl = currentPlaylist();
  if (!pl) { view = 'albums'; return render(false); }
  const items = pl.items, playable = items.filter(t => !t.missing);
  const mins = Math.round(items.reduce((s, t) => s + (t.duration || 0), 0) / 60);
  const arts = [...new Set(playable.map(t => albumArt(t.album, 300)))].slice(0, 4);
  const cover = arts.length >= 4 ? `<div class="pl-cover">${arts.map(a => `<img src="${esc(a)}" alt="">`).join('')}</div>`
    : arts.length ? `<div class="pl-cover one"><img src="${esc(arts[0])}" alt=""></div>` : `<div class="pl-cover none">${ICON.playlist}</div>`;
  const rows = items.map((t, i) => `
    <div class="row prow${t.missing ? ' missing' : ''}${Player.track === t ? ' current' : ''}" role="button" tabindex="0" draggable="true" data-index="${i}" ${t.missing ? '' : `data-track="${t.id}"`} title="${t.missing ? 'Disque débranché' : ''}" style="--i:${i}">
      <img src="${esc(albumArt(t.album, 120))}" alt=""><span class="ti">${esc(t.title)}</span><span class="dim">${esc(t.artist)}</span>
      <span class="dim">${esc(t.album.title)}${t.missing ? ' · indisponible' : ''}</span><span class="d">${t.duration ? fmt(t.duration) : '—'}</span>
      <span class="rm" role="button" title="Retirer de la playlist" data-rm="${i}">${ICON.close}</span></div>`).join('');
  const dis = playable.length ? '' : 'disabled';
  put(scroll, `<div class="${animate ? 'enter' : ''}">
    <div class="pl-head" style="--i:0">${cover}<div>
      <div class="eyebrow">Playlist</div><h1 class="pl-name">${esc(pl.name)}</h1>
      <div class="meta">${plural(items.length, 'morceau', 'morceaux')}${mins ? ' · ' + mins + ' min' : ''}</div>
      <div class="pills">
        <button class="pill primary" data-pl="play" ${dis}>${ICON.play}Lire</button>
        <button class="pill soft" data-pl="shuffle" ${dis}>${ICON.shuffle}Aléatoire</button>
        <button class="pill soft" data-pl="rename">${ICON.pencil}Renommer</button>
        <button class="pill soft" data-pl="delete">${ICON.trash}Supprimer</button></div></div></div>
    ${items.length ? `<div class="list glass pl-list" style="--i:1">${rows}</div>`
      : emptyCard(ICON.playlist, 'Playlist vide', 'Ajoutez des morceaux avec le bouton ⊕ qui apparaît au survol d’un morceau, par un clic droit, ou en glissant un morceau sur la playlist dans la barre latérale.')}</div>`, animate);
}

function playFromPlaylist(i) {
  const pl = currentPlaylist(); if (!pl) return;
  const t = pl.items[i]; if (!t) return;
  if (t.missing) return toast(`${ICON.disk}Ce morceau est sur un disque débranché`);
  const playable = pl.items.filter(x => !x.missing);
  Player.playList(playable, playable.indexOf(t));
}

async function playlistAction(a) {
  const pl = currentPlaylist(); if (!pl) return;
  const playable = pl.items.filter(t => !t.missing);
  if (a === 'play' && playable.length) return Player.playList(playable, 0);
  if (a === 'shuffle' && playable.length) return Player.playList(shuffled(playable), 0);
  if (a === 'rename') {
    const name = await ask({ title: 'Renommer la playlist', value: pl.name, ok: 'Renommer' });
    if (name) Native.call('playlistRename', { id: pl.id, name });
  }
  if (a === 'delete') {
    const yes = await ask({ title: `Supprimer « ${pl.name} » ?`, text: 'La playlist sera supprimée. Les morceaux restent dans votre bibliothèque.', ok: 'Supprimer', danger: true, input: false });
    if (yes) { await Native.call('playlistDelete', { id: pl.id }); go('albums'); toast(`${ICON.trash}Playlist supprimée`); }
  }
}

async function newPlaylist(trackIds) {
  const name = await ask({ title: 'Nouvelle playlist', text: trackIds.length ? `${plural(trackIds.length, 'morceau sera ajouté', 'morceaux seront ajoutés')}.` : '', placeholder: 'Nom de la playlist', ok: 'Créer' });
  if (name === null) return;
  const id = await Native.call('playlistCreate', { name, tracks: trackIds });
  toast(`${ICON.playlist}« ${esc(name.trim() || 'Nouvelle playlist')} » créée`);
  if (!trackIds.length && id) go('pl:' + id);
}
async function addToPlaylist(id, tracks) {
  const pl = S.playlists.find(p => p.id === id);
  const n = await Native.call('playlistAdd', { id, tracks });
  toast(n ? `${ICON.check}Ajouté à « ${esc(pl.name)} »` : `Déjà dans « ${esc(pl.name)} »`);
}

// menu « Ajouter à une playlist » (bouton ⊕, clic droit, fiche album, lecteur)
function openAddMenu(trackIds, anchor, extra = '') {
  if (!trackIds.length) return;
  menu._tracks = trackIds;
  menu.innerHTML = `<div class="m-h">Ajouter ${trackIds.length > 1 ? plural(trackIds.length, 'morceau', 'morceaux') + ' ' : ''}à une playlist</div>`
    + S.playlists.map(p => `<button data-m-add="${p.id}">${ICON.playlist}<span>${esc(p.name)}</span></button>`).join('')
    + (S.playlists.length ? '<hr>' : '') + `<button data-m-new>${ICON.plus}<span>Nouvelle playlist…</span></button>` + extra;
  menu.classList.add('open');
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const x = r ? r.left : anchor.x, y = r ? r.bottom + 6 : anchor.y;
  menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  menu.style.top = (y + h > innerHeight - 8 ? Math.max(8, y - h - (r ? r.height + 12 : 0)) : y) + 'px';
  menu.querySelector('button')?.focus({ preventScroll: true });
}
function closeMenu() { menu.classList.remove('open'); }
menu.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const tracks = menu._tracks || [];
  closeMenu();
  if (b.dataset.mAdd) return addToPlaylist(b.dataset.mAdd, tracks);
  if (b.hasAttribute('data-m-new')) return newPlaylist(tracks);
  if (b.dataset.mRemove !== undefined) return Native.call('playlistRemove', { id: currentPlaylist().id, index: +b.dataset.mRemove });
});
addEventListener('mousedown', e => { if (menu.classList.contains('open') && !e.target.closest('#menu')) closeMenu(); }, true);
addEventListener('resize', closeMenu);
scroll.addEventListener('scroll', closeMenu);
sheet.addEventListener('scroll', closeMenu);

// clic droit sur un morceau ; ailleurs, pas de menu « Recharger » de WebKit (il remettrait l'app à zéro)
addEventListener('contextmenu', e => {
  if (e.target.closest('input, textarea')) return;
  e.preventDefault();
  const row = e.target.closest('[data-track], [data-track-id], .prow');
  if (!row) return;
  const id = row.dataset.track || row.dataset.trackId;
  const extra = row.classList.contains('prow') ? `<hr><button data-m-remove="${row.dataset.index}" class="danger">${ICON.close}<span>Retirer de cette playlist</span></button>` : '';
  if (id) openAddMenu([id], { x: e.clientX, y: e.clientY }, extra);
  else if (extra) { menu._tracks = []; menu.innerHTML = extra.replace('<hr>', ''); menu.classList.add('open'); menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px'; }
});

// petite fenêtre de saisie ou de confirmation
let dialogDone = null;
function ask({ title, text = '', value = '', placeholder = '', ok = 'OK', danger = false, input = true }) {
  $('#dlg-title').textContent = title; dlgText.textContent = text; dlgText.hidden = !text;
  dlgInput.hidden = !input; dlgInput.value = value; dlgInput.placeholder = placeholder;
  dlgOk.textContent = ok; dlgOk.className = 'pill ' + (danger ? 'danger' : 'primary');
  dialog.classList.add('open'); dialog.setAttribute('aria-hidden', 'false');
  setTimeout(() => (input ? dlgInput : dlgOk).focus(), 60);
  if (input) dlgInput.select();
  return new Promise(r => { dialogDone = r; });
}
function closeDialog(result) {
  dialog.classList.remove('open'); dialog.setAttribute('aria-hidden', 'true');
  const done = dialogDone; dialogDone = null; if (done) done(result);
}
dialog.addEventListener('click', e => {
  if (e.target === dialog) return closeDialog(null);
  const d = e.target.closest('[data-d]')?.dataset.d; if (!d) return;
  closeDialog(d === 'ok' ? (dlgInput.hidden ? true : dlgInput.value) : null);
});
dlgInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closeDialog(e.target.value); } });

// notification discrète (« Ajouté à … »)
let toastTimer = 0;
function toast(html) {
  const t = $('#toast'); t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// glisser un morceau sur une playlist de la barre latérale, ou réordonner une playlist
let dragIndex = null;
addEventListener('dragstart', e => {
  const prow = e.target.closest && e.target.closest('.prow');
  const row = e.target.closest && e.target.closest('[data-track], [data-track-id]');
  if (!prow && !row) return;
  const id = (row && (row.dataset.track || row.dataset.trackId)) || '';
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/x-verre-tracks', JSON.stringify(id ? [id] : []));
  if (prow) { dragIndex = +prow.dataset.index; prow.classList.add('dragging'); e.dataTransfer.setData('text/x-verre-index', String(dragIndex)); }
});
addEventListener('dragend', () => { dragIndex = null; $$('.dragging, .drop-before, .drop-after, .nav a.drop').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after', 'drop')); });
nav.addEventListener('dragover', e => {
  const a = e.target.closest('[data-pl-drop]');
  $$('#nav a.drop').forEach(x => x !== a && x.classList.remove('drop'));
  if (!a || !e.dataTransfer.types.includes('text/x-verre-tracks')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; a.classList.add('drop');
});
nav.addEventListener('drop', e => {
  const a = e.target.closest('[data-pl-drop]'); if (!a) return;
  e.preventDefault(); a.classList.remove('drop');
  const tracks = JSON.parse(e.dataTransfer.getData('text/x-verre-tracks') || '[]');
  if (tracks.length) addToPlaylist(a.dataset.plDrop, tracks);
});
// ligne visée et côté (avant/après) pendant le réordonnancement
const dropTarget = e => { const row = e.target.closest('.prow'); if (!row || dragIndex === null) return null; const r = row.getBoundingClientRect(); return { row, after: e.clientY > r.top + r.height / 2 }; };
scroll.addEventListener('dragover', e => {
  const d = dropTarget(e); if (!d) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  $$('.drop-before, .drop-after', scroll).forEach(x => x.classList.remove('drop-before', 'drop-after'));
  d.row.classList.add(d.after ? 'drop-after' : 'drop-before');
});
scroll.addEventListener('drop', e => {
  const d = dropTarget(e); if (!d) return;
  e.preventDefault();
  let to = +d.row.dataset.index + (d.after ? 1 : 0);
  if (dragIndex < to) to--;
  if (to !== dragIndex) Native.call('playlistMove', { id: currentPlaylist().id, from: dragIndex, to });
});

/* ---------- Lecteur de musique : commandes et affichage ---------- */
$('#p-prev').innerHTML = $('.f-prev').innerHTML = ICON.prev; $('#p-next').innerHTML = $('.f-next').innerHTML = ICON.next;
$('.f-collapse').innerHTML = ICON.chevronDown; $$('.ic-vol').forEach(e => e.innerHTML = ICON.vol); $$('.ic-vlow').forEach(e => e.innerHTML = ICON.vlow);
pPlay.innerHTML = fPlay.innerHTML = ICON.play;
pArt.onclick = () => Player.track && player.classList.add('expanded');
$('.f-collapse').onclick = () => player.classList.remove('expanded');
$('#f-add').innerHTML = ICON.plusCircle;
$('#f-add').onclick = () => Player.track && openAddMenu([Player.track.id], $('#f-add'));
pPlay.onclick = fPlay.onclick = () => Player.toggle();
$('#p-next').onclick = $('.f-next').onclick = () => Player.next();
$('#p-prev').onclick = $('.f-prev').onclick = () => Player.prev();
// se déplacer dans le morceau : cliquer ou glisser sur la barre (mini lecteur et lecteur agrandi) ;
// pendant le glisser, la barre et les temps suivent le pointeur, la lecture saute au relâchement
let scrub = null;
function scrubber(zone, bar) {
  const at = e => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  zone.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !Player.track || !Player.duration) return;
    e.preventDefault(); e.stopPropagation();
    try { zone.setPointerCapture(e.pointerId); } catch {} zone.classList.add('drag');
    scrub = at(e); drawProgress();
    const move = ev => { scrub = at(ev); drawProgress(); };
    const end = ev => {
      zone.removeEventListener('pointermove', move); zone.removeEventListener('pointerup', end); zone.removeEventListener('pointercancel', end);
      zone.classList.remove('drag');
      const f = scrub; scrub = null;
      if (ev.type === 'pointerup') Player.seek(f * Player.duration); else drawSoon();
    };
    zone.addEventListener('pointermove', move); zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  });
}
scrubber($('#p-seek'), $('.p-line')); scrubber($('#f-seek'), $('#f-bar'));
$('#m-volume').oninput = e => { audio.volume = +e.target.value; e.target.style.setProperty('--v', e.target.value * 100 + '%'); };

function showPlayState() {
  pPlay.innerHTML = fPlay.innerHTML = Player.playing ? ICON.pause : ICON.play;
  Motion.pop(pPlay); Motion.pop(fPlay);
  document.body.classList.toggle('is-playing', Player.playing);
  syncNowPlaying();
  drawSoon();
}
function showTrack(t) {
  pArt.style.backgroundImage = fArt.style.backgroundImage = fAmbient.style.backgroundImage = `url("${albumArt(t.album, 600)}")`;
  Motion.pop(pArt); Motion.pop(fArt, 'pop');
  Motion.marquee($('#p-title'), t.title); Motion.marquee($('#f-title'), t.title);
  $('#p-sub').textContent = $('#f-sub').textContent = t.artist;
  if (!sheetCtx || sheetCtx.type === 'album') paint(t.album.colors);
  const al = sheetCtx && sheetCtx.type === 'album' && S.albums.find(a => a.id === sheetCtx.id);
  $$('#sheet .row[data-i]').forEach(r => r.classList.toggle('current', !!al && al.tracks[r.dataset.i] === t));
  $$('.row[data-track]', scroll).forEach(r => r.classList.toggle('current', r.dataset.track === t.id));
  scroll._html = null;   // la page a été retouchée : le prochain rendu la réécrit
  drawSoon();
}
// barre de progression et temps : écrits seulement quand ils changent
let drawRaf = 0, lastW = '', lastPos = '', lastRem = '';
function drawProgress() {
  drawRaf = 0;
  if (!Player.track) return;
  const d = Player.duration, p = scrub === null ? Player.position : scrub * d;
  const w = (d ? p / d * 100 : 0).toFixed(2) + '%', a = fmt(p), b = '-' + fmt(d - p);
  if (w !== lastW) pLine.style.width = fBar.style.width = lastW = w;
  if (a !== lastPos) fPos.textContent = lastPos = a;
  if (b !== lastRem) fRem.textContent = lastRem = b;
  if (Player.playing) drawRaf = requestAnimationFrame(drawProgress);
}
function drawSoon() { if (!drawRaf) drawRaf = requestAnimationFrame(drawProgress); }

/* ---------- Clavier, menus, touches média ---------- */
function media(cmd) {
  if (VP.isOpen) {
    if (cmd === 'toggle') return VP.toggle();
    if (cmd === 'play') return video.play();
    if (cmd === 'pause') return video.pause();
    if (cmd === 'next') return VP.skip(10);
    if (cmd === 'prev') return VP.skip(-10);
    return;
  }
  if (cmd === 'toggle') Player.toggle();
  else if (cmd === 'play') Player.track ? Player.play() : Player.toggle();
  else if (cmd === 'pause') Player.pause();
  else if (cmd === 'next') Player.next();
  else if (cmd === 'prev') Player.prev();
}
Native.on('remote', media);
Native.on('seek', pos => VP.isOpen ? (video.currentTime = +pos) : Player.seek(+pos));
Native.on('menu', a => {
  if (a === 'settings') return openSettings();
  if (a === 'new-playlist') return newPlaylist([]);
  if (a === 'search') { if (VP.isOpen) return; closeSheet(); return $('#search')?.focus(); }
  if (TITLES[a]) return go(a);
  media(a);
});
addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input, textarea');
  if (e.key === 'Escape') {
    if (dialog.classList.contains('open')) return closeDialog(null);
    if (menu.classList.contains('open')) return closeMenu();
    if (typing && e.target.id === 'search' && query) { query = ''; return render(false); }
    if (VP.isOpen) return VP.close();
    if (sheetCtx) return closeSheet();
    return player.classList.remove('expanded');
  }
  if (typing) return;
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('prow')) return playFromPlaylist(+e.target.dataset.index);
  if (e.code === 'Space') { e.preventDefault(); media('toggle'); }
  if (VP.isOpen) {
    if (e.key === 'ArrowRight') VP.skip(10);
    if (e.key === 'ArrowLeft') VP.skip(-10);
    if (e.key.toLowerCase() === 'f') fullScreen();
  } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && Player.track && player.classList.contains('expanded')) {
    // lecteur agrandi : ← → reculent / avancent de 10 secondes
    e.preventDefault();
    Player.seek(Math.max(0, Math.min(Player.duration - .5, Player.position + (e.key === 'ArrowRight' ? 10 : -10))));
  }
});

/* ---------- État envoyé par le Mac ---------- */
let statusTimer = 0;
function setStatus(text) {
  const el = $('#status');
  clearTimeout(statusTimer);
  if (text) { $('#status-text').textContent = text; el.classList.add('show'); $('.spin', el).style.display = /…|analyse/i.test(text) ? '' : 'none'; }
  else statusTimer = setTimeout(() => el.classList.remove('show'), 600);
}
Native.on('status', setStatus);
let lastState = '';
Native.on('state', st => {
  const sig = JSON.stringify(st);
  if (sig === lastState) return;          // rien n'a changé : pas de rafraîchissement (évite les clignotements)
  lastState = sig;
  const playingId = Player.track && Player.track.id;
  adopt(st);
  if (playingId) {  // on garde la file d'attente en cours (et son ordre) en la rattachant aux nouvelles données
    const q = Player.queue.map(t => S.trackById.get(t.id)).filter(Boolean);
    const i = q.findIndex(t => t.id === playingId);
    if (i >= 0) { Player.queue = q; Player.index = i; }
  }
  setStatus(S.status);
  if (!document.activeElement || document.activeElement.id !== 'search') render(false); else renderNav();
  const ctx = sheetCtx;
  if (!ctx) return;
  if (ctx.type === 'movie' || ctx.type === 'show') {
    const [list, open] = ctx.type === 'movie' ? [S.movies, openMovie] : [S.shows, openShow];
    const x = list.find(y => y.id === ctx.id);
    if (!x) closeSheet(); else if (JSON.stringify(x) !== ctx.json) reopen(open, x);
  }
  if (ctx.type === 'album' && !S.albums.some(x => x.id === ctx.id)) closeSheet();
  if (ctx.type === 'settings') {
    // on redessine les réglages sans perdre la clé en cours de saisie ni le message affiché
    const msg = $('#key-msg')?.outerHTML, input = $('#tmdb-key');
    const typed = input ? input.value : '', focused = document.activeElement === input, pos = input ? input.selectionStart : 0;
    reopen(openSettings);
    if (msg && /err|Vérification|valide/.test(msg)) $('#key-msg').outerHTML = msg;
    if (typed) { const k = $('#tmdb-key'); k.value = typed; if (focused) { k.focus(); k.setSelectionRange(pos, pos); } }
  }
});

/* ---------- Démarrage ---------- */
(async () => {
  try { const st = JSON.parse(await Native.call('state')), sig = JSON.stringify(st); adopt(st); lastState = sig; }
  catch (e) { console.error(e); adopt(S); }
  setStatus(S.status);
  render(false);
  const buttons = () => Native.call('windowButtons', { visible: true });
  if (window.Intro) await Intro.done;          // écran d'ouverture (intro.js), puis entrée de l'interface
  document.body.classList.remove('boot');
  setTimeout(() => window.Shader?.release(), reduced ? 0 : 600);   // le fond glisse ensuite vers les couleurs du contenu
  if (reduced) { document.body.classList.remove('intro'); return buttons(); }
  setTimeout(buttons, 350);
  setTimeout(() => document.body.classList.remove('intro'), 1600);
})();
})();
