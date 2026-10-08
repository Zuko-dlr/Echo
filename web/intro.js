/* Écho — écran d'ouverture : un point de lumière devient une ligne, qui s'ouvre en un grand écran LED
 * dans le noir ; « ECHO » s'y forme en pixels surexposés, avec bandes lumineuses, parasites, un éclat et
 * son reflet sur un sol brillant ; puis l'écran fond dans sa propre lumière, d'où naît le fond de l'interface.
 * WebGL, sans dépendance. `Intro.done` se résout quand l'interface doit commencer son entrée.
 * Rien n'est joué sans WebGL, avec « réduire les animations », avec VoiceOver ou si la fenêtre est cachée.
 * Un clic ou une touche abrège : l'écran fond aussitôt (la touche n'atteint pas l'interface).
 * Photosensibilité : un seul éclat, doux (montée 0,25 s, ≤ 50 %), aucun scintillement rapide. */
(() => {
'use strict';
let finish;
window.Intro = { done: new Promise(r => { finish = r; }) };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const skipAll = reduced || document.hidden || (window.EchoEnv && window.EchoEnv.voiceOver);

const MELT = 1.75;       // l'écran commence à fondre
const HANDOFF = 1.95;    // l'interface démarre et ce voile s'efface
const END = 2.9;         // fin de la fonte : l'écran d'ouverture disparaît
const ASPECT = 1.75;     // proportions de l'écran
const COLS = 84;         // colonnes de LED (pas fixe, comme un vrai écran)

const box = document.createElement('div');
box.id = 'intro-screen';
box.setAttribute('aria-hidden', 'true');
const canvas = document.createElement('canvas');
box.appendChild(canvas);
const gl = !skipAll && canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
if (!gl) { finish(); return; }
document.body.appendChild(box);

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FRAG = `
precision highp float;
uniform vec2 u_res; uniform float u_t;
uniform sampler2D u_txt, u_glow;
uniform vec4 u_rect;                 // centre (x, y) et demi-taille de l'écran, en pixels (origine en haut à gauche)
uniform float u_wide, u_open, u_melt, u_txtOn, u_pix, u_flash, u_glitch, u_band, u_band2;
const vec3 WARM = vec3(1.0, .80, .70);
float hash(float n){ return fract(sin(n) * 43758.5453); }
float noise(float x){ float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.), f * f * (3. - 2. * f)); }
// la teinte suit la lumière : prune → lie-de-vin → rose → pêche → crème (l'or sombre tourne au kaki)
vec3 grade(float v){
  v = clamp(v, 0., 1.);
  vec3 a = vec3(.20, .05, .11), b = vec3(.58, .18, .32), c = vec3(.96, .47, .54), d = vec3(1., .70, .52), e = vec3(1., .87, .62);
  if (v < .3) return mix(a, b, v / .3);
  if (v < .6) return mix(b, c, (v - .3) / .3);
  if (v < .85) return mix(c, d, (v - .6) / .25);
  return mix(d, e, (v - .85) / .15);
}
// image affichée par l'écran ; « m » = présence du texte (net à l'écran, flou dans le reflet)
vec3 content(vec2 q, float m){
  float n = noise(q.y * 3.2 + u_t * .8) * .6 + noise(q.y * 11. - u_t * 1.6) * .4;
  float v = .22 + .5 * n + .1 * sin(q.y * 4.2 - u_t * .6 + 1.3);
  vec3 col = grade(v) * (.55 + .6 * v);
  // bandes larges : l'or n'existe qu'en haute lumière
  float gb = q.y - (.74 + .06 * sin(u_t * .9)), pb = q.y - (.16 - .04 * sin(u_t * .7));
  col += vec3(1., .72, .38) * .85 * exp(-gb * gb / .006) * (.6 + .4 * n);
  col += vec3(1., .62, .55) * .45 * exp(-pb * pb / .003);
  col = mix(col, vec3(1.0, .95, .92) * 4.2 * (1. + 1.2 * smoothstep(0., .3, u_melt)), m * u_txtOn);   // le texte brûle avant de fondre
  float b1 = (q.y - u_band) / .05, b2 = (q.y - u_band2) / .03;     // (pow() refuse les nombres négatifs)
  col += vec3(1.0, .72, .80) * 1.4 * exp(-b1 * b1);
  col += vec3(1.0, .80, .55) * 1.0 * exp(-b2 * b2);
  return col + u_flash * vec3(1.9, 1.7, 1.6);
}
float box(vec2 d, vec2 h){ vec2 q = abs(d) - h; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }
void main(){
  vec2 fc = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 C = u_rect.xy, H = u_rect.zw;
  // allumage : un point devient une ligne, qui s'ouvre (tube cathodique) ; fonte : l'écran s'élargit et se dissout
  float sx = max(u_wide, .004), sy = mix(.006, 1., u_open);
  vec2 Hs = H * vec2(sx, sy) * (1. + 1.8 * u_melt * u_melt);
  float energy = min(pow(1. / (sx * sy), .3), 6.) * (1. + .5 * sin(u_melt * 3.1416));   // le point concentre la lumière ; la fonte la fait gonfler
  vec2 d = fc - C;
  vec2 uv = d / (2. * Hs) + .5;
  uv += u_melt * .16 * vec2(noise(uv.y * 2.3 + u_t * .9) - .5, noise(uv.x * 1.9 - u_t * .7 + 7.) - .5);   // ondulation lente, comme la soie du fond
  // parasites : tranches horizontales décalées (8 tirages par seconde au plus)
  float slice = floor(uv.y * 26.);
  uv.x += (hash(slice + floor(u_t * 8.)) - .5) * .09 * u_glitch * step(.55, hash(slice * 1.7 + floor(u_t * 8.)));
  vec3 col = vec3(0.);
  float w = .002 + .45 * u_melt;                                          // bord net, puis de plus en plus doux
  float inside = 1. - smoothstep(-.4 * w, w, box(uv - .5, vec2(.5)));
  // LED à pas fixe ; seule l'image affichée est pixellisée (de grossière à fine)
  vec2 grid = vec2(COLS., COLS. / ASPECT);
  vec2 cgrid = grid / u_pix;
  float melt = smoothstep(0., .55, u_melt);
  vec2 q = mix((floor(uv * cgrid) + .5) / cgrid, uv, melt);               // les pixels se fondent
  vec2 f = fract(uv * grid);
  float k = floor(fract(uv.x * grid.x) * 3.);
  vec3 stripe = k < .5 ? vec3(1., .34, .42) : (k < 1.5 ? vec3(.62, 1., .34) : vec3(.42, .46, 1.));
  float fs = fract(uv.x * grid.x * 3.);
  float gx = smoothstep(0., .14, fs) * smoothstep(1., .86, fs);
  float gy = mix(1., smoothstep(0., .14, f.y) * smoothstep(1., .86, f.y), .3);
  vec3 led = mix(mix(vec3(.7), stripe * 1.35, .5) * (.3 + .7 * gx * gy), vec3(1.), melt);
  float tm = mix(texture2D(u_txt, q).a, texture2D(u_glow, (uv + .3) / 1.6).a * 1.4, melt) * (1. - smoothstep(.3, .75, u_melt));
  vec3 c = content(q, tm) * energy;
  col += inside * (c * led + max(c - 1., 0.) * .85);
  // halo autour de l'écran et lueur du texte (approximation de « bloom »)
  float sd = max(box(d, Hs), 0.);
  float lit = max(smoothstep(0., .15, u_open), .5 * u_wide);
  float lum = (.35 + .8 * u_txtOn + 2.2 * u_flash) * energy * lit;
  float rad = 1. + 1.5 * u_melt;
  col += WARM * lum * (exp(-sd / (.16 * H.y * rad)) * .42 + exp(-sd / (.65 * H.y * rad)) * .14) * (1. - .9 * inside);   // halo : autour, pas par-dessus
  vec2 g = (uv + .3) / 1.6;
  col += vec3(1., .80, .74) * texture2D(u_glow, g).a * u_txtOn * (1. - u_melt) * energy * mix(.9, 1.1, inside) * smoothstep(0., .3, u_open);
  // reflet sur le sol brillant : écran retourné, flou (étalé verticalement), qui s'efface en s'éloignant
  float floorY = C.y + H.y * 1.13;
  if (fc.y > floorY) {
    float dist = fc.y - floorY;
    vec2 fr = vec2(fc.x + sin(fc.y * .045 + u_t * 2.) * 1.2, 2. * floorY - fc.y);
    vec2 dr = fr - C, ur = dr / (2. * Hs) + .5;
    float soft = smoothstep(-.04, .03, ur.x) * smoothstep(1.04, .97, ur.x) * smoothstep(-.06, .04, ur.y) * smoothstep(1.06, .96, ur.y);
    float sm = dist / H.y * .018, mr = 0.;
    for (int i = -4; i <= 4; i++) { float fi = float(i); mr += exp(-fi * fi / 8.) * texture2D(u_glow, (ur + vec2(0., fi * sm) + .3) / 1.6).a; }
    mr *= 1.2 / 5.01;
    vec3 rc = content(clamp(ur, 0., 1.), clamp(mr, 0., 1.)) * energy * vec3(1., .82, .80);
    float om = 1. - u_melt;
    float fade = exp(-dist / (.6 * H.y)) * .3 * om * om * smoothstep(0., .06 * H.y, dist);
    float sdr = max(box(dr, Hs), 0.);
    col += (rc * soft + WARM * lum * exp(-sdr / (.3 * H.y)) * .35 * (1. - .8 * soft)) * fade;
    col += WARM * .012 * exp(-dist / 4.) * lum * om * smoothstep(1.3 * H.x, 0., abs(d.x));   // liseré du sol
  }
  col = 1. - exp(-col * 1.1);                                     // la surexposition tend vers le blanc
  col += (hash(fc.x * .071 + fc.y * .113 + u_t) - .5) / 128.;     // grain léger (évite les bandes)
  gl_FragColor = vec4(col, 1.);
}`;

function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG.replace(/ASPECT/g, ASPECT.toFixed(2)).replace(/COLS/g, String(COLS))));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { box.remove(); finish(); return; }
gl.useProgram(prog);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'p');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const KEYS = ['wide', 'open', 'melt', 'txtOn', 'pix', 'flash', 'glitch', 'band', 'band2'];
const U = {};
for (const n of ['res', 't', 'txt', 'glow', 'rect', ...KEYS]) U[n] = gl.getUniformLocation(prog, 'u_' + n);

// « ECHO » dessiné une fois : net (aux proportions de l'écran) et flou (avec une marge, pour la lueur)
function textCanvas(w, h, pad, blur) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const th = h / (1 + 2 * pad);
  g.font = `900 ${Math.round(th * .54)}px -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(th * .04)}px`;
  const x = w / 2, y = h / 2 + th * .02;
  if (!blur) { g.fillStyle = '#fff'; g.fillText('ECHO', x, y); return c; }
  // flou sans filtre CSS (pas toujours géré) : seule l'ombre du texte, décalé hors du canevas, est dessinée
  g.fillStyle = '#fff'; g.shadowColor = '#fff';
  for (const b of blur) { g.shadowBlur = b; g.shadowOffsetX = w * 4; g.fillText('ECHO', x - w * 4, y); }
  return c;
}
function texture(unit, src) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
texture(0, textCanvas(1024, Math.round(1024 / ASPECT), 0, null));
texture(1, textCanvas(820, Math.round(820 / ASPECT), .3, [8, 20, 38]));
gl.uniform1i(U.txt, 0); gl.uniform1i(U.glow, 1);

let rect = [0, 0, 1, 1];
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5), w = innerWidth, h = innerHeight;   // l'image est floue par nature : 1,5× suffit
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  const sw = Math.min(w * .46, h * .5 * ASPECT) * dpr, sh = sw / ASPECT;
  rect = [canvas.width / 2, canvas.height * .43, sw / 2, sh / 2];
}
resize();
addEventListener('resize', resize);

// déroulé (en secondes) : mise en place, montée, un seul temps fort, puis relâchement
const clamp01 = x => Math.max(0, Math.min(1, x));
const ramp = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = x => x * x * (3 - 2 * x);
const expoOut = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
const backOut = x => { const s = 1.2; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };   // léger dépassement (≈ 5 %)
const pulse = (t, at, len) => (t >= at && t < at + len) ? Math.pow(1 - (t - at) / len, 2) : 0;
function frameAt(t) {
  return {
    wide: expoOut(ramp(t, .06, .2)),
    open: t < .26 ? 0 : backOut(ramp(t, .26, .52)),
    melt: smooth(ramp(t, MELT, END)),
    txtOn: ramp(t, .58, .7),
    pix: [6, 4, 3, 2, 1.5, 1][Math.min(5, Math.floor(ramp(t, .58, 1.05) * 6))],
    flash: .5 * Math.min(smooth(ramp(t, 1.15, 1.4)), 1 - smooth(ramp(t, 1.4, 1.85))),   // l'unique éclat, doux
    glitch: Math.max(pulse(t, .58, .2) * .8, pulse(t, 1.36, .3) * 1.1),
    band: t > .8 && t < 1.75 ? -.1 + smooth(ramp(t, .8, 1.75)) * 1.2 : -1,
    band2: t > 1.1 && t < 2.05 ? 1.1 - smooth(ramp(t, 1.1, 2.05)) * 1.2 : -1,
  };
}

let t = 0, last = 0, speed = 1, handed = false;
function draw(at) {
  const s = frameAt(at);
  gl.uniform2f(U.res, canvas.width, canvas.height);
  gl.uniform1f(U.t, at);
  gl.uniform4f(U.rect, rect[0], rect[1], rect[2], rect[3]);
  for (const k of KEYS) gl.uniform1f(U[k], s[k]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
// passage de relais : l'interface et son fond démarrent pendant que l'écran fond et que ce voile s'efface
function handoff(fast) {
  if (handed) return;
  handed = true;
  removeEventListener('keydown', onKey, true);
  if (fast) box.classList.add('fast');
  box.classList.add('out');
  finish();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 0;   // un à-coup ralentit l'animation au lieu de la sauter
  last = now;
  t += dt * speed;
  if (t >= HANDOFF) handoff(false);
  if (t >= END) { box.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
  draw(t);
  requestAnimationFrame(tick);
}
// abréger : l'écran fond tout de suite, 2,5× plus vite, et l'interface démarre aussitôt
function skip() {
  if (handed) return;
  t = Math.max(t, MELT); speed = 2.5;
  handoff(true);
}
function onKey(e) {
  if (e.metaKey) return;                           // les raccourcis ⌘ restent à l'app
  e.preventDefault(); e.stopImmediatePropagation(); // la touche ne lance rien d'autre (Espace = lecture…)
  skip();                                          // même pressée avant la première image
}
box.addEventListener('pointerdown', skip);
addEventListener('keydown', onKey, true);
requestAnimationFrame(tick);
})();
