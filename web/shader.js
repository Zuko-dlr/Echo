/* Écho — fond vivant en WebGL : un dégradé fluide (bruit déformé, comme shadergradient.co)
 * aux couleurs de la pochette ou de l'affiche en cours. Sans dépendance.
 * Sans WebGL, le fond reste uni (couleur --base). */
(() => {
'use strict';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wall = document.getElementById('wall');
if (!wall) return;
const canvas = document.createElement('canvas');
canvas.className = 'shader';
wall.prepend(canvas);
const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
if (!gl) { canvas.remove(); return; }

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
// bruit simplex 2D (Ian McEwan, Ashima Arts — licence MIT), puis bruit fractal déformé deux fois
const FRAG = `
precision highp float;
uniform vec2 u_res; uniform float u_time;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_base;
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0); m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p){ float v = 0.0, a = 0.55; for (int i = 0; i < 3; i++) { v += a * snoise(p); p = p * 1.9 + vec2(1.7, 9.2); a *= 0.45; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv; p.x *= u_res.x / u_res.y;
  float t = u_time * 0.045;
  // deux déformations successives : c'est ce qui donne le côté « soie qui ondule »
  // grandes vagues lentes, déformées deux fois : le côté « soie qui ondule »
  vec2 q = vec2(fbm(p * 0.45 + vec2(0.0, t)), fbm(p * 0.45 + vec2(5.2, 1.3) - t * 0.6));
  vec2 r = vec2(fbm(p * 0.5 + 1.6 * q + vec2(1.7, 9.2) + t * 0.5), fbm(p * 0.5 + 1.6 * q + vec2(8.3, 2.8) - t * 0.35));
  float f = fbm(p * 0.55 + 1.8 * r);
  vec3 col = mix(u_c1, u_c2, smoothstep(-0.5, 0.5, f));
  col = mix(col, u_c3, smoothstep(0.1, 0.8, length(q)) * 0.85);
  col = mix(col, u_c4, smoothstep(0.2, 1.0, r.x * 0.5 + 0.5) * 0.5);
  // reste un halo : un peu plus sombre vers le bas et sur les bords
  float edge = smoothstep(0.0, 1.0, distance(uv, vec2(0.5, 0.7)) * 1.05);
  col = mix(col, u_base, 0.12 + 0.42 * edge);
  gl_FragColor = vec4(col, 1.0);
}`;

function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
let prog;
try {
  prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
} catch (e) { canvas.remove(); return; }   // repli : fond uni
gl.useProgram(prog);
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const U = Object.fromEntries(['u_res', 'u_time', 'u_c1', 'u_c2', 'u_c3', 'u_c4', 'u_base'].map(n => [n, gl.getUniformLocation(prog, n)]));

/* ---------- Couleurs : « #rrggbb » ou « rgb(r, g, b) » → [0..1], fondu doux vers la nouvelle palette ---------- */
function parse(c) {
  c = String(c).trim();
  if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => v / 255); }
  const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(v => +v / 255) : [0, 0, 0];
}
// le fond naît dans les teintes chaudes de l'écran d'ouverture (intro.js, ce sont aussi les couleurs par défaut)
// et les garde jusqu'à release() ; il glisse ensuite lentement vers les couleurs du contenu en cours
const WARM = ['#b4435f', '#c46a4a', '#7d2850', '#b07a2e', '#12060c'];
let held = document.body.classList.contains('boot'), pending = null, slow = 0;
let target = WARM.map(parse);
let current = target.map(c => [...c]);
function setColors(cols) {
  if (!cols || cols.length < 5) return;
  if (held) { pending = cols; return; }
  target = cols.map(parse); wake();
}
function release() {
  if (!held) return;
  held = false; slow = 1;
  if (pending) setColors(pending);
}

/* ---------- Rendu : demi-résolution (le résultat est flou par nature), pause quand rien ne bouge ---------- */
function resize() {
  const w = Math.max(2, Math.ceil(innerWidth / 2)), h = Math.max(2, Math.ceil(innerHeight / 2));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
}
const vplayer = document.getElementById('vplayer');
let time = 0, last = 0, raf = 0, settled = false;
function frame(now) {
  raf = 0;
  const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
  if (document.hidden || (vplayer && vplayer.classList.contains('open'))) { last = 0; raf = 0; setTimeout(wake, 400); return; }   // caché : on ne dessine pas
  if (!reduced) time += dt;
  // fondu des couleurs (≈ 1,5 s pour arriver ; ≈ 5 s pour quitter les teintes de l'ouverture)
  const k = 1 - Math.exp(-dt / (slow ? 1.7 : .5)); let moving = false;
  current = current.map((c, i) => c.map((v, j) => { const d = target[i][j] - v; if (Math.abs(d) > .002) moving = true; return v + d * k; }));
  resize();
  gl.uniform2f(U.u_res, canvas.width, canvas.height); gl.uniform1f(U.u_time, time);
  [U.u_c1, U.u_c2, U.u_c3, U.u_c4, U.u_base].forEach((u, i) => gl.uniform3fv(u, current[i]));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  settled = !moving;
  if (settled) slow = 0;
  if (!reduced || moving) raf = requestAnimationFrame(frame);   // mouvement réduit : une image, puis repos
}
function wake() { if (!raf) raf = requestAnimationFrame(frame); }
addEventListener('resize', wake);
document.addEventListener('visibilitychange', wake);
wake();

window.Shader = { setColors, release };
})();
