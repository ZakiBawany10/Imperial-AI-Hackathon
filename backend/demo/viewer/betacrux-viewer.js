// BetaCrux 3D viewer: the wall, its holds and the climber as a glowing "digital twin".
//
//   import { mountViewer } from "/demo/viewer/betacrux-viewer.js";
//   const viewer = mountViewer(element, { imageUrl, analyze, solveRequest, solve });
//
// No build step and no network: three.js is in ./vendor/. See README.md for the options and methods.
//
// Units: everything the API sends is in pixels of the photo (y down). The viewer works in metres
// "on the wall": x to the right, y up from the floor, z out of the wall toward the viewer. The whole
// wall then leans about its bottom edge by the wall angle.
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { EffectComposer } from "./vendor/EffectComposer.js";
import { RenderPass } from "./vendor/RenderPass.js";
import { UnrealBloomPass } from "./vendor/UnrealBloomPass.js";
import { OutputPass } from "./vendor/OutputPass.js";
import { createClimber, poseFromTargets } from "../climber/climber.js";

// ---------------------------------------------------------------- plain words

// Names shown to people who have never climbed.
export const HOLD_LABEL = {
  jug: "Big easy grip", crimp: "Thin edge", sloper: "Rounded, no edge", pinch: "Squeeze grip",
  pocket: "Finger hole", volume: "Big shape", foot: "Foot only", unknown: "Grip",
};
const HOLD_IN_SENTENCE = {
  jug: "a big easy grip", crimp: "a thin edge", sloper: "a rounded grip with no edge", pinch: "a squeeze grip",
  pocket: "a finger hole", volume: "a big shape", foot: "a foot-only grip", unknown: "the next grip",
};
const LIMB_NAME = { LH: "Left hand", RH: "Right hand", LF: "Left foot", RF: "Right foot" };
const LIMBS = ["LH", "RH", "LF", "RF"];
const END_JOINT = { LH: "lh", RH: "rh", LF: "lf", RF: "rf" };
const MID_JOINT = { LH: "l_elbow", RH: "r_elbow", LF: "l_knee", RF: "r_knee" };

/** "6a+" -> "Intermediate". Bands: up to 5a+ Beginner, 5b to 6a Improver, 6a+ to 6c Intermediate, 6c+ to 7a+ Advanced, 7b and up Expert. */
export function gradeBand(font) {
  const m = /^(\d)([abc])(\+?)$/i.exec(String(font || "").trim());
  if (!m) return "";
  const step = (Number(m[1]) * 3 + "abc".indexOf(m[2].toLowerCase())) * 2 + (m[3] ? 1 : 0);
  return step < 32 ? "Beginner" : step < 37 ? "Improver" : step < 41 ? "Intermediate" : step < 44 ? "Advanced" : "Expert";
}

/** One move as a sentence: "Right hand to a big easy grip". joins = name of the limb already on that hold, if any. */
export function describeMove(move, hold, joins) {
  const who = LIMB_NAME[move.limb] || "Hand";
  if (move.hold === null || move.hold === undefined) return `${who} onto the bare wall`;
  const what = HOLD_IN_SENTENCE[hold?.type] || HOLD_IN_SENTENCE.unknown;
  if (joins) return `${who} joins the ${LIMB_NAME[joins].toLowerCase()} on ${what.replace(/^an? /, "the ")}`;
  return `${who} to ${what}`;
}

// ---------------------------------------------------------------- look

const CYAN = "#27e6ff", MAGENTA = "#ff2bd6", HOT = "#ff2a4f";
// How far each kind of hold stands out from the wall, in metres, and how it is shaped:
// top = size of the flat top compared with the base, rings = how many steps make the rounded side.
const RELIEF = {
  volume: { out: 0.2, top: 0.3, rings: 1 }, jug: { out: 0.085, top: 0.5, rings: 3 },
  sloper: { out: 0.075, top: 0.2, rings: 3 }, pinch: { out: 0.07, top: 0.55, rings: 3 },
  pocket: { out: 0.055, top: 0.7, rings: 2 }, unknown: { out: 0.05, top: 0.5, rings: 3 },
  crimp: { out: 0.03, top: 0.7, rings: 2 }, foot: { out: 0.022, top: 0.5, rings: 2 },
};
// Effort colours: calm when easy, hot near the limit.
const EFFORT_STOPS = [[0, "#1fd8ff"], [0.3, "#4dffb5"], [0.55, "#ffd23f"], [0.82, "#ff7a1a"], [1, HOT]];

// Timing of the animation at speed 1, in seconds.
const TIME = { start: 1.0, move: 1.15, hold: 0.55, hardMove: 1.6, hardHold: 1.1, end: 2.2 };

const STYLE = `
.bcx{position:relative;width:100%;height:100%;min-height:240px;overflow:hidden;background:#04060b;color:#d9f6ff;
  font:13px/1.35 ui-monospace,"SF Mono","JetBrains Mono","Cascadia Mono",Menlo,Consolas,monospace;
  -webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;outline:none}
.bcx canvas{display:block;width:100%;height:100%;touch-action:none}
.bcx-fx{position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(160,240,255,.045) 0 1px,transparent 1px 3px),
  radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.55) 100%)}
.bcx-corner{position:absolute;width:22px;height:22px;border:2px solid ${CYAN};opacity:.7;pointer-events:none}
.bcx-corner.tl{top:8px;left:8px;border-right:0;border-bottom:0}.bcx-corner.tr{top:8px;right:8px;border-left:0;border-bottom:0}
.bcx-corner.bl{bottom:8px;left:8px;border-right:0;border-top:0}.bcx-corner.br{bottom:8px;right:8px;border-left:0;border-top:0}
.bcx-card{position:absolute;background:linear-gradient(180deg,rgba(6,16,28,.86),rgba(4,9,18,.78));
  border:1px solid rgba(39,230,255,.38);box-shadow:0 0 18px rgba(39,230,255,.12),inset 0 0 22px rgba(39,230,255,.05);
  padding:12px 14px;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
.bcx-left{top:22px;left:22px;width:min(340px,44%)}
.bcx-right{top:22px;right:22px;width:min(270px,36%)}
.bcx-tag{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${CYAN};opacity:.85}
.bcx-brand{display:flex;justify-content:space-between;gap:8px;font-size:10px;letter-spacing:.2em;color:rgba(217,246,255,.55);
  text-transform:uppercase;margin-bottom:8px}
.bcx-brand b{color:${MAGENTA};font-weight:600}
.bcx-grade{font-size:32px;font-weight:700;line-height:1.1;color:#fff;text-shadow:0 0 14px rgba(39,230,255,.75);margin:2px 0 2px}
.bcx-grade small{font-size:17px;font-weight:600;color:${CYAN}}
.bcx-sub{font-size:12px;color:rgba(217,246,255,.7)}
.bcx-rule{height:1px;background:linear-gradient(90deg,${CYAN},transparent);opacity:.45;margin:10px 0}
.bcx-count{display:flex;align-items:center;gap:10px;margin-bottom:2px}
.bcx-flag{display:none;font-size:10px;letter-spacing:.16em;font-weight:700;color:#fff;background:${MAGENTA};padding:2px 7px;
  box-shadow:0 0 14px ${MAGENTA};animation:bcx-blink .7s steps(2,start) infinite}
.bcx-flag.on{display:inline-block}
.bcx-what{font-size:18px;font-weight:600;color:#fff;min-height:48px;margin:2px 0 8px}
.bcx-bar{position:relative;height:10px;background:rgba(39,230,255,.12);border:1px solid rgba(39,230,255,.35)}
.bcx-bar i{position:absolute;left:0;top:0;bottom:0;width:0;background:${CYAN};box-shadow:0 0 10px currentColor;transition:width .25s linear}
.bcx-barrow{display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;color:rgba(217,246,255,.8)}
.bcx-warn{display:none;margin-top:8px;font-size:12px;font-weight:700;color:#fff;background:rgba(255,42,79,.2);
  border:1px solid ${HOT};padding:5px 8px;animation:bcx-blink .6s steps(2,start) infinite}
.bcx-warn.on{display:block}
.bcx-limb{display:grid;grid-template-columns:86px 1fr 38px;align-items:center;gap:8px;font-size:12px;margin-top:5px}
.bcx-limb .bcx-bar{height:7px}.bcx-limb span:last-child{text-align:right}
.bcx-limb.moving{color:#fff}.bcx-limb.off{opacity:.4}
.bcx-note{font-size:11px;color:rgba(217,246,255,.6);margin-top:9px}
.bcx-bottom{position:absolute;left:22px;right:22px;bottom:20px;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.bcx-line{display:flex;gap:4px;width:min(760px,100%);pointer-events:auto}
.bcx-seg{position:relative;flex:1;height:14px;background:rgba(39,230,255,.1);border:1px solid rgba(39,230,255,.4);cursor:pointer;padding:0}
.bcx-seg i{position:absolute;left:0;top:0;bottom:0;width:0;background:${CYAN};box-shadow:0 0 8px ${CYAN}}
.bcx-seg.foot{border-style:dashed}
.bcx-seg.hard{border-color:${MAGENTA};background:rgba(255,43,214,.14)}.bcx-seg.hard i{background:${MAGENTA};box-shadow:0 0 8px ${MAGENTA}}
.bcx-seg.hard::after{content:"hardest";position:absolute;left:50%;top:-15px;transform:translateX(-50%);font-size:9px;
  letter-spacing:.14em;text-transform:uppercase;color:${MAGENTA};white-space:nowrap}
.bcx-ctl{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;pointer-events:auto}
.bcx-ctl button{font:inherit;font-size:12px;letter-spacing:.06em;color:#d9f6ff;background:rgba(4,12,22,.82);
  border:1px solid rgba(39,230,255,.45);padding:7px 11px;cursor:pointer;min-width:44px;
  clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px))}
.bcx-ctl button:hover{background:rgba(39,230,255,.18);color:#fff}
.bcx-ctl button.main{color:#04060b;background:${CYAN};font-weight:700;min-width:84px}
.bcx-ctl button[hidden]{display:none}
.bcx-info{position:absolute;right:16px;bottom:86px;width:270px;display:none;padding:12px 14px;pointer-events:auto;
  background:linear-gradient(180deg,rgba(6,16,28,.92),rgba(4,9,18,.88));border:1px solid ${CYAN};box-shadow:0 0 22px rgba(39,230,255,.25);font-size:13px;line-height:1.45}
.bcx-info.on{display:block}
.bcx-info canvas{display:block;width:100%;height:170px;margin:4px 0 8px;border:1px solid rgba(39,230,255,.35);background:#03070e;cursor:grab}
.bcx-info h3{margin:2px 0 6px;font-size:18px;letter-spacing:.02em}
.bcx-info .sw{display:inline-block;width:12px;height:12px;border:1px solid #fff6;margin-right:6px;vertical-align:-1px}
.bcx-info .x{position:absolute;right:8px;top:4px;cursor:pointer;opacity:.7;background:none;border:0;color:inherit;font:inherit}
.bcx-alert{position:absolute;left:50%;top:26px;transform:translateX(-50%);display:none;padding:7px 16px;font-size:15px;
  font-weight:700;letter-spacing:.2em;color:#fff;border:1px solid ${MAGENTA};background:rgba(255,43,214,.16);
  text-shadow:0 0 12px ${MAGENTA};box-shadow:0 0 26px rgba(255,43,214,.45);white-space:nowrap;pointer-events:none}
.bcx-alert.on{display:block;animation:bcx-pulse .8s ease-in-out infinite alternate}
.bcx-alert.danger{border-color:${HOT};background:rgba(255,42,79,.2);text-shadow:0 0 12px ${HOT};box-shadow:0 0 26px rgba(255,42,79,.5)}
.bcx.mid .bcx-left{width:250px;padding:9px 11px}.bcx.mid .bcx-right{width:205px;padding:9px 11px}
.bcx.mid .bcx-grade{font-size:24px}.bcx.mid .bcx-grade small{font-size:14px}.bcx.mid .bcx-what{font-size:15px;min-height:40px}
.bcx.mid .bcx-note{display:none}.bcx.mid .bcx-limb{grid-template-columns:74px 1fr 32px;font-size:11px}.bcx.mid .bcx-alert{font-size:13px}
.bcx.small .bcx-left{width:min(300px,calc(100% - 44px));padding:8px 10px;top:12px;left:12px}.bcx.small .bcx-right{display:none}
.bcx.small .bcx-brand,.bcx.small .bcx-note,.bcx.small .bcx-sub{display:none}.bcx.small .bcx-rule{margin:6px 0}
.bcx.small .bcx-grade{font-size:22px}.bcx.small .bcx-grade small{font-size:13px}.bcx.small .bcx-what{font-size:14px;min-height:0;margin-bottom:5px}
.bcx.small .bcx-bottom{left:10px;right:10px;bottom:10px}.bcx.small .bcx-ctl button{padding:6px 8px;font-size:11px}
.bcx.small .bcx-alert{top:auto;bottom:150px;font-size:12px}.bcx.small .bcx-alert:not(.danger){display:none}
.bcx.nohud .bcx-card,.bcx.nohud .bcx-bottom,.bcx.nohud .bcx-alert{display:none}
@keyframes bcx-blink{to{opacity:.45}}
@keyframes bcx-pulse{to{transform:translateX(-50%) scale(1.05)}}
`;

function addStyle() {
  if (document.getElementById("bcx-style")) return;
  const el = document.createElement("style");
  el.id = "bcx-style";
  el.textContent = STYLE;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------- small helpers

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const linear = (hex) => new THREE.Color(hex);          // three.js turns the hex into linear light for us

function effortColor(e, out) {
  e = clamp(e, 0, 1);
  for (let i = 1; i < EFFORT_STOPS.length; i++) {
    if (e <= EFFORT_STOPS[i][0]) {
      const [a, ca] = EFFORT_STOPS[i - 1], [b, cb] = EFFORT_STOPS[i];
      return out.copy(linear(ca)).lerp(linear(cb), (e - a) / (b - a));
    }
  }
  return out.copy(linear(HOT));
}

// A hold's own colour, pushed toward a clean bright version so it reads as neon.
function neon(hex) {
  const c = new THREE.Color(/^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#9fb4c8"), hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s < 0.08 ? hsl.s : Math.min(1, hsl.s * 1.35 + 0.12), clamp(hsl.l, 0.5, 0.62), THREE.SRGBColorSpace);
  return c;
}

// A small sign that always faces the camera: glowing text on a dark plate. heightM is its height on the wall.
function textSprite(text, color, heightM) {
  const cv = document.createElement("canvas"), font = '700 44px ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  let g = cv.getContext("2d");
  g.font = font;
  cv.width = Math.ceil(g.measureText(text).width) + 44; cv.height = 72;
  g = cv.getContext("2d");
  g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(3,8,16,0.82)"; g.fillRect(2, 2, cv.width - 4, cv.height - 4);
  g.strokeStyle = color; g.lineWidth = 3; g.strokeRect(3.5, 3.5, cv.width - 7, cv.height - 7);
  g.fillStyle = color;
  g.fillText(text, cv.width / 2, cv.height / 2 + 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(heightM * cv.width / cv.height, heightM, 1);
  sprite.userData.width = heightM * cv.width / cv.height;
  sprite.renderOrder = 10;
  return sprite;
}

// Elbow or knee of a two-part limb from root to target. pole says which way the bend should point.
// When the target is further than the limb is long the joint lies on the straight line (the limb stretches).
const _n = new THREE.Vector3(), _p = new THREE.Vector3();
function bend(root, target, l1, l2, pole, out) {
  _n.subVectors(target, root);
  let d = _n.length();
  if (d < 1e-6) return out.copy(root);
  _n.divideScalar(d);
  if (d >= l1 + l2) return out.copy(root).addScaledVector(_n, d * l1 / (l1 + l2));
  d = Math.max(d, Math.abs(l1 - l2) + 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1).addScaledVector(_n, -_n.z);
  _p.normalize();
  return out.copy(root).addScaledVector(_n, a).addScaledVector(_p, h);
}

// ---------------------------------------------------------------- the viewer

export function mountViewer(container, options = {}) {
  if (!container) throw new Error("mountViewer: no container element");
  addStyle();
  const opts = { autoplay: true, loop: true, speed: 1, view: "photo", hud: true, sway: true, bloom: true, ...options };

  // ---- page elements
  const root = document.createElement("div");
  root.className = "bcx" + (opts.hud ? "" : " nohud");
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="bcx-fx"></div>
    <div class="bcx-corner tl"></div><div class="bcx-corner tr"></div><div class="bcx-corner bl"></div><div class="bcx-corner br"></div>
    <div class="bcx-card bcx-left">
      <div class="bcx-brand"><span><b>BetaCrux</b> // 3D wall</span><span>live model</span></div>
      <div class="bcx-tag" data-k="gradetag">How hard</div>
      <div class="bcx-grade" data-k="grade"></div>
      <div class="bcx-sub" data-k="gradesub"></div>
      <div data-k="movebox">
        <div class="bcx-rule"></div>
        <div class="bcx-count"><span class="bcx-tag" data-k="count"></span><span class="bcx-flag" data-k="flag">Hardest move</span></div>
        <div class="bcx-what" data-k="what"></div>
        <div class="bcx-barrow"><span>Effort</span><span data-k="effortword"></span></div>
        <div class="bcx-bar"><i data-k="effortbar"></i></div>
        <div class="bcx-warn" data-k="warn">This position cannot be held still</div>
      </div>
      <div class="bcx-note" data-k="wallinfo"></div>
    </div>
    <div class="bcx-card bcx-right" data-k="physbox" hidden>
      <div class="bcx-tag">Who carries the weight</div>
      <div data-k="limbs"></div>
      <div class="bcx-note">Arrows show how hard the wall pushes back on each hand and foot. The white marker is the body's balance point.</div>
      <div class="bcx-note" data-k="physsum"></div>
    </div>
    <div class="bcx-alert" data-k="alert"></div>
    <div class="bcx-info" data-k="info"></div>
    <div class="bcx-bottom">
      <div class="bcx-line" data-k="line"></div>
      <div class="bcx-ctl">
        <button data-a="prev" title="Back one move">&#9664; Step</button>
        <button data-a="play" class="main" title="Play or pause (space bar)">Pause</button>
        <button data-a="next" title="Forward one move">Step &#9654;</button>
        <button data-a="mesh" title="Show the wall's 3D shape from the photo, or a flat wall with raised holds">3D wall: on</button>
        <button data-a="reset" title="Put the camera back">Reset view</button>
      </div>
    </div>`;
  container.appendChild(root);
  const ui = {};
  root.querySelectorAll("[data-k]").forEach((el) => (ui[el.dataset.k] = el));
  const buttons = {};
  root.querySelectorAll("[data-a]").forEach((el) => (buttons[el.dataset.a] = el));
  const setText = (el, text) => { if (el.__t !== text) { el.__t = text; el.textContent = text; } };
  const setOn = (el, on) => { if (el.__on !== on) { el.__on = on; el.classList.toggle("on", on); } };

  // ---- renderer, scene, camera
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  } catch (e) {
    // No 3D graphics in this browser: say so, and hand back methods that do nothing so the page keeps working.
    root.innerHTML = '<div class="bcx-card bcx-left"><div class="bcx-tag">3D view</div><div class="bcx-what">This browser cannot show 3D graphics (WebGL is off).</div></div>';
    console.warn("BetaCrux viewer: WebGL is not available.", e);
    const stub = { on: () => () => {}, state: () => ({ move: -1, of: 0, progress: 0, phase: "start", playing: false }), stats: () => ({ fps: 0 }), dispose: () => root.remove() };
    for (const name of ["setSolve", "play", "pause", "seek", "setSpeed", "setView", "resetView", "setFollow", "setCamera", "resize"]) stub[name] = () => stub;
    return stub;
  }
  renderer.setClearColor(0x04060b, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  root.insertBefore(renderer.domElement, root.firstChild);
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-2.5, 4, 5);
  scene.add(key);
  scene.background = new THREE.Color(0x04060b);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.8;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI / 2 + 0.03;          // do not go under the floor
  controls.minAzimuthAngle = -1.45;                     // stay in front of the wall
  controls.maxAzimuthAngle = 1.45;
  controls.screenSpacePanning = true;

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.7, 0.5, 0.85);
  bloom.enabled = !!opts.bloom;
  composer.addPass(bloom);
  renderer.info.autoReset = false;                      // count a whole frame, not just its last pass
  composer.addPass(new OutputPass());

  // Everything that must be freed when the scene is rebuilt or the viewer is closed.
  const staticGroup = new THREE.Group();                // floor
  const wall = new THREE.Group();                       // leans by the wall angle; children are in wall metres
  const wallStatic = new THREE.Group();                 // wall surface, holds, markers: rebuilt by build()
  wall.add(wallStatic);
  scene.add(staticGroup, wall);
  const freeTree = (obj) => obj.traverse((o) => {
    o.geometry?.dispose();
    o.userData.plain?.dispose();
    for (const m of [].concat(o.material || [])) { if (m.map && m.map !== photo) m.map.dispose(); m.dispose(); }
  });

  // ---- floor: a glowing grid that fades with distance
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: linear(CYAN) }, uB: { value: linear(MAGENTA) } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uA; uniform vec3 uB; varying vec3 vW;
      float grid(vec2 p, float size, float width){ vec2 q = p / size; vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * width); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){
        float d = length(vW.xz - vec2(0.0, 1.0));
        float fade = exp(-d * 0.17);
        float lines = grid(vW.xz, 0.5, 1.0) * 0.28 + grid(vW.xz, 2.0, 1.6) * 0.95;
        vec3 c = mix(uA, uB, smoothstep(3.0, 13.0, d)) * lines * fade * 1.25;
        gl_FragColor = vec4(c + vec3(0.003, 0.007, 0.014) * fade, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat);
  floor.rotation.x = -Math.PI / 2;
  staticGroup.add(floor);

  // ---- state
  let analyze = opts.analyze || null, solveRequest = opts.solveRequest || null, solve = opts.solve || null;
  // Relief map from POST /depth: how far each part of the photo sticks out of the wall (0..1).
  let relief = null;                                    // { w, h, data: Float32Array }
  const RELIEF_M = opts.reliefMetres || 0.32;           // what 1.0 in the relief map is, in metres
  let meshOn = opts.mesh !== false;                     // false: flat photo with raised holds, even when a relief map is loaded
  let photo = null;                                     // texture of the wall photo
  let viewMode = opts.view === "schematic" ? "schematic" : "photo";
  let showForces = true;
  let S = null;                                         // sizes and lookups for the current wall, set by build()
  let timeline = [], total = 0, t = 0, playing = !!opts.autoplay, stepping = false, speed = opts.speed || 1;
  let lastMove = -2, disposed = false, swaying = !!opts.sway, userMoved = false, following = false, clock = 0;
  const listeners = new Map();
  const emit = (name, ...args) => { for (const fn of listeners.get(name) || []) { try { fn(...args); } catch (e) { console.error(e); } } };

  // ---- the climber: tubes and balls, coloured by a shader that makes the edges glow
  const bodyUniforms = () => ({ uColor: { value: linear(CYAN) }, uCore: { value: 0.3 }, uRim: { value: 1.9 } });
  const bodyShader = (uniforms) => new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vY = (modelMatrix * vec4(position,1.0)).y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uCore; uniform float uRim; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec3 n = normalize(vN);
        float rim = pow(1.0 - abs(dot(n, normalize(vV))), 2.0);
        float lit = 0.45 + 0.75 * max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0);   // soft light from the upper left, to show the shape
        float band = 0.8 + 0.2 * step(0.5, fract(vY * 45.0));                            // thin stripes, like a projected image
        gl_FragColor = vec4(uColor * (uCore * lit + uRim * rim) * band, 1.0); }`,
  });
  const bodyMat = bodyShader(bodyUniforms());
  const activeMat = bodyShader({ uColor: { value: new THREE.Color(1, 0.97, 0.9) }, uCore: { value: 0.55 }, uRim: { value: 1.3 } });
  const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  const ballGeo = new THREE.SphereGeometry(1, 16, 12);
  const torsoGeo = new THREE.CylinderGeometry(1, 0.72, 1, 16, 1, false);
  const figure = new THREE.Group();
  figure.visible = false;
  wall.add(figure);
  // The realistic climber (../climber/climber.js) is shown by default; opts.figure = "simple" keeps the
  // tube-and-ball figure. The simple figure is still posed every frame: its joints drive the climber.
  const climber = opts.figure === "simple" ? null : createClimber(THREE, { style: opts.climberStyle || "hologram" });
  if (climber) { climber.group.visible = false; wall.add(climber.group); }
  const mk = (geo) => { const m = new THREE.Mesh(geo, bodyMat); m.visible = !climber; figure.add(m); return m; };
  const body = {
    torso: mk(torsoGeo), pelvis: mk(ballGeo), neck: mk(tubeGeo), head: mk(ballGeo),
    limb: Object.fromEntries(LIMBS.map((l) => [l, { upper: mk(tubeGeo), lower: mk(tubeGeo), root: mk(ballGeo), mid: mk(ballGeo), end: mk(ballGeo), foot: l[1] === "F" ? mk(tubeGeo) : null }])),
  };
  const UP = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function tube(mesh, a, b, r) {
    _d.subVectors(b, a);
    const len = Math.max(_d.length(), 1e-5);
    mesh.position.copy(a).addScaledVector(_d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
    mesh.scale.set(r, len, r);
  }
  const ball = (mesh, at, r) => { mesh.position.copy(at); mesh.scale.setScalar(r); };

  // ---- force arrows, one per hand and foot, and the balance-point marker
  const arrows = {};
  for (const l of LIMBS) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), mat), head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12), mat);
    g.add(shaft, head);
    g.visible = false;
    wall.add(g);
    arrows[l] = { g, shaft, head, mat };
  }
  // Drawn over the body (no depth test), because the balance point is inside it.
  const comMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), wireframe: true, depthTest: false });
  const com = new THREE.Mesh(new THREE.OctahedronGeometry(0.085), comMat);
  const comCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), depthTest: false }));
  com.renderOrder = 8; comCore.renderOrder = 9;
  com.add(comCore);
  const dropGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const drop = new THREE.Line(dropGeo, new THREE.LineDashedMaterial({ color: new THREE.Color(1.5, 1.5, 1.5), dashSize: 0.07, gapSize: 0.05 }));
  const comFloor = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.125, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide }));
  comFloor.rotation.x = -Math.PI / 2;
  const comGroup = new THREE.Group();
  comGroup.add(com, drop, comFloor);
  comGroup.visible = false;
  drop.frustumCulled = false;
  scene.add(comGroup);

  // ---- ring around the hold the moving hand or foot is going to, and the "hardest move" label
  const targetRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  targetRing.visible = false;
  wall.add(targetRing);
  const hardLabel = textSprite("HARDEST MOVE", MAGENTA, 0.15);
  hardLabel.visible = false;
  wall.add(hardLabel);

  // ------------------------------------------------------------ building the wall

  function schematicTexture(wM, hM) {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = Math.max(64, Math.round(1024 * hM / wM));
    const g = cv.getContext("2d"), k = cv.width / wM;
    g.fillStyle = "#060b15"; g.fillRect(0, 0, cv.width, cv.height);
    for (const [step, style] of [[0.25, "rgba(39,230,255,0.07)"], [1, "rgba(39,230,255,0.26)"]]) {
      g.strokeStyle = style; g.lineWidth = 1; g.beginPath();
      for (let x = wM / 2 % step; x < wM; x += step) { g.moveTo(Math.round(x * k) + 0.5, 0); g.lineTo(Math.round(x * k) + 0.5, cv.height); }
      for (let y = 0; y < hM; y += step) { const py = cv.height - Math.round(y * k) - 0.5; g.moveTo(0, py); g.lineTo(cv.width, py); }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // Marching squares over the relief map: line segments where the surface crosses each level.
  function contourLines(wallW, wallH) {
    const out = [], W = relief.w, H = relief.h, d = relief.data, step = 1;
    const levels = [0.18, 0.45, 0.75];
    const wx = (i) => (i / (W - 1) - 0.5) * wallW, wy = (j) => (1 - j / (H - 1)) * wallH;
    for (const L of levels) {
      const z = L * RELIEF_M + 0.004;
      for (let j = 0; j < H - step; j += step) for (let i = 0; i < W - step; i += step) {
        const a = d[j * W + i], b = d[j * W + i + step], c = d[(j + step) * W + i + step], e = d[(j + step) * W + i];
        const code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (e > L ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const t = (p, q) => (L - p) / ((q - p) || 1e-6);
        const P = { top: [wx(i + step * t(a, b)), wy(j)], right: [wx(i + step), wy(j + step * t(b, c))],
                    bottom: [wx(i + step * t(e, c)), wy(j + step)], left: [wx(i), wy(j + step * t(a, e))] };
        const pairs = { 1: [["left", "bottom"]], 2: [["bottom", "right"]], 3: [["left", "right"]], 4: [["top", "right"]],
          5: [["left", "top"], ["bottom", "right"]], 6: [["top", "bottom"]], 7: [["left", "top"]], 8: [["left", "top"]],
          9: [["top", "bottom"]], 10: [["left", "bottom"], ["top", "right"]], 11: [["top", "right"]], 12: [["left", "right"]],
          13: [["bottom", "right"]], 14: [["left", "bottom"]] }[code];
        for (const [u, v] of pairs) out.push(P[u][0], P[u][1], z, P[v][0], P[v][1], z);
      }
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  }

  // The outline of a hold in wall metres, counter-clockwise, at most 18 points.
  function holdOutline(h) {
    let pts;
    if (Array.isArray(h.outline) && h.outline.length >= 3) {
      const stepBy = Math.max(1, Math.ceil(h.outline.length / 18));
      pts = h.outline.filter((_, i) => i % stepBy === 0).map(([x, y]) => S.toWall(x, y));
    } else {                                            // no outline: a box with rounded corners
      const a = Math.max(h.w || 30, 6) * S.mpp / 2, b = Math.max(h.h || 30, 6) * S.mpp / 2, [cx, cy] = S.toWall(h.x, h.y);
      pts = [];
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
        const r = Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), -0.25);
        pts.push([cx + c * r * a, cy + s * r * b]);
      }
    }
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) pts.reverse();
    return pts;
  }

  function reliefOf(h) {
    const kind = RELIEF[h.type] || RELIEF.unknown;
    if (relief && meshOn && h.type === "volume") return 0.015;     // the mesh already shows a big shape's real form
    const small = Math.min(h.w || 30, h.h || 30) * S.mpp;
    return Math.max(0.012, Math.min(kind.out, small * (h.type === "volume" ? 0.55 : 0.9)));
  }

  // One mesh for a whole set of holds. Each hold is a low dome over its outline; its lighting is
  // worked out once here and stored as colour, so the scene needs no lights at all.
  const LIGHT = new THREE.Vector3(-0.35, 0.65, 0.68).normalize();
  function holdsMesh(holds, brightness, material) {
    const pos = [], col = [], edge = [], edgeCol = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const tri = (p, q, r, base) => {
      a.set(...p); b.set(...q); c.set(...r);
      n.subVectors(b, a).cross(c.sub(a)).normalize();
      const shade = (0.3 + 0.8 * Math.max(0, n.dot(LIGHT))) * brightness;
      pos.push(...p, ...q, ...r);
      for (let i = 0; i < 3; i++) col.push(base.r * shade, base.g * shade, base.b * shade);
    };
    for (const h of holds) {
      const kind = RELIEF[h.type] || RELIEF.unknown, out = reliefOf(h), ring0 = holdOutline(h), base = neon(h.color);
      const cx = ring0.reduce((s, p) => s + p[0], 0) / ring0.length, cy = ring0.reduce((s, p) => s + p[1], 0) / ring0.length;
      const baseZ = S.depthAt(cx, cy);                  // the wall surface under the hold
      const rings = [];
      for (let j = 0; j <= kind.rings; j++) {
        const ang = (j / kind.rings) * Math.PI / 2, k = kind.top + (1 - kind.top) * Math.cos(ang), z = baseZ + 0.002 + out * Math.sin(ang);
        rings.push(ring0.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k, z]));
      }
      const N = ring0.length;
      for (let j = 0; j < kind.rings; j++) {
        for (let i = 0; i < N; i++) {
          const i2 = (i + 1) % N;
          tri(rings[j][i], rings[j][i2], rings[j + 1][i2], base);
          tri(rings[j][i], rings[j + 1][i2], rings[j + 1][i], base);
        }
      }
      const top = rings[kind.rings], centre = [cx, cy, 0.002 + out];
      for (let i = 0; i < N; i++) tri(centre, top[i], top[(i + 1) % N], base);
      const e = brightness * 1.5;
      for (const ring of [rings[0], top]) {
        for (let i = 0; i < N; i++) {
          edge.push(...ring[i], ...ring[(i + 1) % N]);
          for (let q = 0; q < 2; q++) edgeCol.push(base.r * e, base.g * e, base.b * e);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.Float32BufferAttribute(edge, 3));
    lines.setAttribute("color", new THREE.Float32BufferAttribute(edgeCol, 3));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, material), new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ vertexColors: true, transparent: material.transparent, opacity: material.transparent ? 0.7 : 1 })));
    return group;
  }

  function build() {
    freeTree(wallStatic);
    wallStatic.clear();
    const image = analyze?.image || solveRequest?.image || { w: 1920, h: 1440 };
    const wallH = Number(solveRequest?.wall_height_m ?? opts.wallHeightM ?? 4) || 4;
    const angleDeg = Number(solveRequest?.wall_angle_deg ?? opts.wallAngleDeg ?? 0) || 0;
    const mpp = wallH / image.h, wallW = image.w * mpp;
    S = {
      image, wallH, wallW, mpp, angleDeg, angle: angleDeg * Math.PI / 180,
      toWall: (x, y) => [(x - image.w / 2) * mpp, (image.h - y) * mpp],
      // How far the wall surface sticks out at a point given in wall metres (0 on a flat wall).
      depthAt: (wx, wy) => (meshOn ? reliefAt(wx, wy) : 0),
    };
    // Relief in metres at a point in wall metres, whether or not the mesh is shown (the hold close-up uses it).
    function reliefAt(wx, wy) {
      {
        if (!relief) return 0;
        const u = (wx / wallW + 0.5) * (relief.w - 1), v = (1 - wy / wallH) * (relief.h - 1);
        const x0 = Math.max(0, Math.min(relief.w - 2, Math.floor(u))), y0 = Math.max(0, Math.min(relief.h - 2, Math.floor(v)));
        const fx = Math.min(Math.max(u - x0, 0), 1), fy = Math.min(Math.max(v - y0, 0), 1), d = relief.data, W = relief.w;
        const a = d[y0 * W + x0], b = d[y0 * W + x0 + 1], c = d[(y0 + 1) * W + x0], e = d[(y0 + 1) * W + x0 + 1];
        return RELIEF_M * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy);
      }
    }
    S = { ...S, reliefAt,
      holds: new Map(), route: new Set(), start: new Set(solveRequest?.start || []), finish: new Set(solveRequest?.finish || []),
    };
    for (const h of analyze?.holds || []) S.holds.set(h.id, h);
    for (const h of solveRequest?.holds || []) { S.holds.set(h.id, { ...S.holds.get(h.id), ...h }); S.route.add(h.id); }
    wall.rotation.x = S.angle;                          // positive leans the top toward the viewer

    // The wall surface: the photo, or a plain dark panel with a grid.
    let surfaceGeo;
    const showMesh = relief && meshOn;
    if (showMesh) {
      // The wall as a mesh: one vertex per relief pixel (at most 192 across), pushed out by the relief.
      const cols = Math.min(relief.w, 256), rows = Math.max(2, Math.round(cols * relief.h / relief.w));
      surfaceGeo = new THREE.PlaneGeometry(wallW, wallH, cols - 1, rows - 1);
      const pos = surfaceGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, S.depthAt(pos.getX(i) , pos.getY(i) + wallH / 2));
      surfaceGeo.computeVertexNormals();
    } else surfaceGeo = new THREE.PlaneGeometry(wallW, wallH);
    const surface = new THREE.Mesh(surfaceGeo, showMesh ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : new THREE.MeshBasicMaterial({ color: 0xffffff }));
    surface.position.set(0, wallH / 2, 0);
    if (showMesh) {
      // Height lines, like a map: one line every few centimetres of relief, so the shape of every
      // volume reads from any angle, without a busy wireframe.
      const lines = contourLines(wallW, wallH);
      const topo = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: linear(CYAN).multiplyScalar(1.2), transparent: true, opacity: 0.3, depthWrite: false }));
      topo.name = "topo";
      wallStatic.add(topo);
    }
    surface.name = "surface";
    surface.userData.plain = schematicTexture(wallW, wallH);
    wallStatic.add(surface);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(wallW + 0.08, wallH + 0.04, 0.14), new THREE.MeshBasicMaterial({ color: 0x03060c }));
    slab.position.set(0, wallH / 2, -0.075);
    wallStatic.add(slab);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(wallW + 0.08, wallH + 0.04, 0.14)), new THREE.LineBasicMaterial({ color: linear(CYAN).multiplyScalar(1.6) }));
    frame.position.copy(slab.position);
    wallStatic.add(frame);
    // Height marks every metre up the right edge.
    for (let m = 1; m <= Math.floor(wallH + 1e-6); m++) {
      const mark = textSprite(`${m} m`, CYAN, 0.13);
      mark.position.set(wallW / 2 + 0.2 + mark.userData.width / 2, m, 0.02);
      wallStatic.add(mark);
    }
    const ticks = [];
    for (let m = 0; m <= wallH + 1e-6; m += 0.5) ticks.push(wallW / 2 + 0.04, m, 0, wallW / 2 + (m % 1 === 0 ? 0.16 : 0.1), m, 0);
    const tickGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    wallStatic.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: linear(CYAN).multiplyScalar(1.3) })));

    // Holds: the chosen route bright, everything else dim. With no route chosen, all at normal brightness.
    const all = [...S.holds.values()].filter((h) => Number.isFinite(h.x) && Number.isFinite(h.y));
    const hasRoute = S.route.size > 0;
    const onRoute = all.filter((h) => S.route.has(h.id)), rest = all.filter((h) => !S.route.has(h.id));
    if (onRoute.length) {
      const g = holdsMesh(onRoute, 1.25, new THREE.MeshBasicMaterial({ vertexColors: true }));
      g.name = "route";
      wallStatic.add(g);
    }
    if (rest.length) {
      const g = holdsMesh(rest, hasRoute ? 0.42 : 1.12, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: hasRoute, opacity: 1, depthWrite: !hasRoute }));
      g.name = "rest";
      wallStatic.add(g);
    }
    // Start and finish marks.
    for (const [ids, text, color] of [[S.start, "START", CYAN], [S.finish, "FINISH", MAGENTA]]) {
      for (const id of ids) {
        const h = S.holds.get(id);
        if (!h) continue;
        const [x, y] = S.toWall(h.x, h.y), r = Math.max(h.w || 30, h.h || 30) * mpp * 0.5 + 0.07, out = reliefOf(h);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 56), new THREE.MeshBasicMaterial({ color: linear(color).multiplyScalar(2.2) }));
        ring.position.set(x, y, 0.01);
        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(r + 0.045, 0.005, 6, 56), new THREE.MeshBasicMaterial({ color: linear(color).multiplyScalar(1.4) }));
        ring2.position.set(x, y, 0.01);
        const label = textSprite(text, color, 0.13);
        const side = x > 0 ? -1 : 1;                    // put the label on the side with more room
        label.position.set(x + side * (r + 0.1 + label.userData.width / 2), y, out + 0.06);
        wallStatic.add(ring, ring2, label);
      }
    }
    applyView();
    fitCamera(userMoved);
  }

  function applyView() {
    const surface = wallStatic.getObjectByName("surface");
    if (!surface) return;
    const usePhoto = viewMode === "photo" && photo;
    const hasRoute = S.route.size > 0;
    surface.material.map = usePhoto ? photo : surface.userData.plain;
    // The photo is darkened so the glowing holds and the climber stand out from it.
    surface.material.color.setScalar(usePhoto ? (hasRoute ? 0.5 : 0.62) : 1);
    surface.material.needsUpdate = true;
    const rest = wallStatic.getObjectByName("rest");
    if (rest && hasRoute) {                             // on the photo, holds that are not on the route are only ghosts
      // On the photo the other holds are already visible, so their glow is left off: only the climb shines.
      rest.visible = !usePhoto;
      rest.children[0].material.opacity = 0.9;
      rest.children[1].material.opacity = 0.8;
    }
    if (buttons.mesh) { buttons.mesh.textContent = `3D wall: ${meshOn ? "on" : "off"}`; buttons.mesh.hidden = !relief; }
  }

  // ------------------------------------------------------------ camera

  const home = { target: new THREE.Vector3(), pos: new THREE.Vector3(), az: 0 };
  function fitCamera(keepUserView) {
    if (!S) return;
    const aspect = camera.aspect || 1.6, half = Math.tan((camera.fov * Math.PI / 180) / 2);
    const lean = Math.sin(Math.max(S.angle, 0)) * S.wallH;
    const dist = Math.max((S.wallH * 1.22) / (2 * half), (S.wallW * 1.12) / (2 * half * aspect)) + lean * 0.5;
    home.target.set(0, S.wallH * 0.47, lean * 0.45);
    home.az = -0.36;
    const el = 0.07;
    home.pos.set(Math.sin(home.az) * Math.cos(el), Math.sin(el), Math.cos(home.az) * Math.cos(el)).multiplyScalar(dist).add(home.target);
    if (keepUserView) return;
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
  }

  // ------------------------------------------------------------ the climb: timing and lookups

  let K = null;       // per-keyframe data in wall metres, set by prepare()
  function nearestHold(px, limbIsHand) {
    let best = null, bestD = Infinity;
    for (const id of S.route.size ? S.route : S.holds.keys()) {
      const h = S.holds.get(id);
      if (!h) continue;
      const d = Math.hypot(h.x - px[0], h.y - px[1]), reach = Math.max(h.w || 0, h.h || 0) / 2 + (limbIsHand ? 8 : 4);
      if (d <= reach && d < bestD) { best = id; bestD = d; }
    }
    return best;
  }

  function prepare() {
    K = null; timeline = []; total = 0; t = 0; lastMove = -2; stepping = false;
    const frames = solve?.keyframes || [];
    if (!frames.length) return;
    const needed = ["head", "hip", "lh", "rh", "l_elbow", "r_elbow", "lf", "rf", "l_knee", "r_knee"];
    if (!frames.every((f) => f.joints && needed.every((n) => Array.isArray(f.joints[n]) && f.joints[n].length >= 2))) {
      console.warn("BetaCrux viewer: a keyframe is missing a joint; showing the wall without the climber.");
      return;
    }
    const moves = (solve.moves || []).slice(0, Math.max(0, frames.length - 1));
    const hasPhysics = frames.some((f) => f.physics) || moves.some((m) => typeof m.effort === "number");
    const j0 = frames[0].joints;
    // Climber height in metres, read off the figure itself: head centre to hip is 40% of height.
    const height = clamp(Math.hypot(j0.head[0] - j0.hip[0], j0.head[1] - j0.hip[1]) * S.mpp / 0.4, 1.0, 2.5) || 1.75;
    const kf = frames.map((f) => {
      const J = {};
      for (const [name, p] of Object.entries(f.joints)) J[name] = new THREE.Vector2(...S.toWall(p[0], p[1]));
      const contacts = {}, z = {};
      for (const l of LIMBS) {
        const given = f.contacts && l in f.contacts;
        contacts[l] = given ? f.contacts[l] : nearestHold(f.joints[END_JOINT[l]], l[1] === "H");
        const h = contacts[l] === null || contacts[l] === undefined ? null : S.holds.get(contacts[l]);
        const at = h ? S.toWall(h.x, h.y) : S.toWall(...f.joints[END_JOINT[l]]);
        z[l] = S.depthAt(...at) + (h ? reliefOf(h) * (l[1] === "H" ? 0.85 : 0.75) + 0.02 : 0.03);   // how far out the hand or foot sits
      }
      let physics = null;
      if (f.physics) {
        const forces = {};
        for (const fo of f.physics.forces || []) {
          if (!LIMBS.includes(fo.limb) || !fo.at || !fo.f) continue;
          forces[fo.limb] = { at: new THREE.Vector2(...S.toWall(fo.at[0], fo.at[1])), f: new THREE.Vector2(fo.f[0], -fo.f[1]), share: fo.share ?? 0 };
        }
        physics = { com: f.physics.com ? new THREE.Vector2(...S.toWall(f.physics.com[0], f.physics.com[1])) : null,
                    effort: f.physics.effort ?? 0, stable: f.physics.stable !== false, forces };
      }
      return { J, contacts, z, physics };
    });
    const crux = Number.isInteger(solve.crux) && moves.length ? clamp(solve.crux, 0, moves.length - 1) : -1;
    const info = moves.map((m, i) => {
      const limb = LIMBS.includes(m.limb) ? m.limb : "RH";
      const hold = m.hold === null || m.hold === undefined ? null : S.holds.get(m.hold);
      const before = kf[i].contacts;
      const joins = hold && limb[1] === "H" ? ["LH", "RH"].find((o) => o !== limb && before[o] === m.hold) : null;
      const effort = typeof m.effort === "number" ? m.effort : null;
      return {
        limb, hold, hard: i === crux, joins,
        text: describeMove({ limb, hold: m.hold }, hold, joins),
        effort, load: typeof m.load === "number" ? m.load : 0,
        stable: m.stable !== false && (effort === null || effort < 1),
        fall: typeof m.fall_chance === "number" ? m.fall_chance : null,
      };
    });
    let at = TIME.start;
    info.forEach((m, i) => {
      const move = m.hard ? TIME.hardMove : TIME.move, hold = m.hard ? TIME.hardHold : TIME.hold;
      timeline.push({ i, t0: at, move, hold });
      at += move + hold;
    });
    total = at + TIME.end;
    K = { kf, moves: info, crux, height, hasPhysics };
  }

  // Where the animation is at time t: which move, and how far through it (0 to 1).
  function locate(time) {
    if (!timeline.length || time < timeline[0].t0) return { i: -1, p: 0, phase: "start" };
    for (const s of timeline) {
      if (time < s.t0 + s.move) return { i: s.i, p: (time - s.t0) / s.move, phase: "move" };
      if (time < s.t0 + s.move + s.hold) return { i: s.i, p: 1, phase: "hold" };
    }
    return { i: timeline.length - 1, p: 1, phase: "end" };
  }

  // ------------------------------------------------------------ posing the 3D figure

  const P = {};       // 3D points of the figure in wall metres, reused every frame
  for (const name of ["head", "neck", "hip", "chest", "ls", "rs", "lhip", "rhip", "lh", "rh", "lf", "rf", "le", "re", "lk", "rk", "la", "ra", "pole", "tmp"]) P[name] = new THREE.Vector3();
  const _a2 = new THREE.Vector2(), _b2 = new THREE.Vector2();

  function poseFigure(where) {
    const { kf, moves, height: H } = K;
    const A = kf[Math.max(where.i, 0)], B = where.i < 0 ? A : kf[Math.min(where.i + 1, kf.length - 1)];
    const p = where.i < 0 ? 0 : where.p, mover = where.i >= 0 ? moves[where.i].limb : null;
    const eBody = ease(p), eEarly = ease(clamp(p / 0.55, 0, 1)), eLate = ease(clamp((p - 0.2) / 0.8, 0, 1));
    const mix2 = (name, e) => _a2.copy(A.J[name]).lerp(B.J[name], e);

    // Hands and feet: the limb that is moving goes last and lifts off the wall on the way.
    const z = {};
    for (const l of LIMBS) {
      const e = l === mover ? eLate : eEarly, name = END_JOINT[l];
      const travelled = A.J[name].distanceTo(B.J[name]);
      const lift = Math.min(0.14, travelled * 0.6) * Math.sin(Math.PI * e);
      const q = mix2(name, e);
      z[l] = lerp(A.z[l], B.z[l], e) + lift;
      P[name].set(q.x, q.y, z[l]);
    }
    const head2 = mix2("head", eBody); P.head.set(head2.x, head2.y, 0);
    const hip2 = mix2("hip", eBody); P.hip.set(hip2.x, hip2.y, 0);

    // Spine direction and the direction of the climber's right, both flat on the wall.
    const ux = P.head.x - P.hip.x, uy = P.head.y - P.hip.y, ul = Math.hypot(ux, uy) || 1;
    const sx = ux / ul, sy = uy / ul, rx = sy, ry = -sx;
    P.neck.set(P.head.x + (P.hip.x - P.head.x) * 0.275, P.head.y + (P.hip.y - P.head.y) * 0.275, 0);
    const shoulder = 0.1 * H, hipHalf = 0.052 * H;
    const armU = 0.185 * H, armL = 0.22 * H, legU = 0.245 * H, legL = 0.25 * H;
    P.ls.set(P.neck.x - rx * shoulder - sx * 0.015 * H, P.neck.y - ry * shoulder - sy * 0.015 * H, 0);
    P.rs.set(P.neck.x + rx * shoulder - sx * 0.015 * H, P.neck.y + ry * shoulder - sy * 0.015 * H, 0);
    P.lhip.set(P.hip.x - rx * hipHalf, P.hip.y - ry * hipHalf, 0);
    P.rhip.set(P.hip.x + rx * hipHalf, P.hip.y + ry * hipHalf, 0);

    // How far the body stands out from the wall. It hangs further out on an overhang, and is pulled
    // in when an arm or leg would otherwise not reach.
    const over = Math.max(0, Math.sin(S.angle));
    let chestZ = (0.14 + 0.1 * over) * H, hipZ = (0.17 + 0.13 * over) * H;
    const reachZ = (root, end, len) => end.z + Math.sqrt(Math.max(len * len - (root.x - end.x) ** 2 - (root.y - end.y) ** 2, 0));
    chestZ = Math.max(0.075 * H, Math.min(chestZ, reachZ(P.ls, P.lh, (armU + armL) * 0.99), reachZ(P.rs, P.rh, (armU + armL) * 0.99)));
    hipZ = Math.max(0.09 * H, Math.min(hipZ, reachZ(P.lhip, P.lf, (legU + legL) * 0.98) + 0.03, reachZ(P.rhip, P.rf, (legU + legL) * 0.98) + 0.03));
    const under = Math.max(S.depthAt(P.hip.x, P.hip.y), S.depthAt(P.neck.x, P.neck.y));   // a volume behind the body pushes it out
    chestZ += under; hipZ += under;
    P.ls.z = P.rs.z = P.neck.z = chestZ;
    P.head.z = chestZ + 0.012 * H;
    P.hip.z = P.lhip.z = P.rhip.z = hipZ;

    // Elbows: bent the way the 2D pose says, and out from the wall.
    for (const [l, root, endName, midName, out] of [["LH", P.ls, "lh", "l_elbow", P.le], ["RH", P.rs, "rh", "r_elbow", P.re]]) {
      const hint = mix2(midName, eBody), end = P[endName];
      P.pole.set(hint.x - (root.x + end.x) / 2, hint.y - (root.y + end.y) / 2, 0);
      if (P.pole.lengthSq() < 1e-6) P.pole.set(l === "LH" ? -rx : rx, l === "LH" ? -ry : ry, 0);
      P.pole.normalize().multiplyScalar(0.75);
      P.pole.z = 0.65;
      bend(root, end, armU, armL, P.pole, out);
    }
    // Knees the same way; the shin ends at the ankle, a little out from the toes that touch the wall.
    for (const [l, root, endName, midName, out, ankle] of [["LF", P.lhip, "lf", "l_knee", P.lk, P.la], ["RF", P.rhip, "rf", "r_knee", P.rk, P.ra]]) {
      const hint = mix2(midName, eBody), toe = P[endName];
      ankle.set(toe.x, toe.y - 0.012 * H, toe.z + 0.055 * H);
      P.pole.set(hint.x - (root.x + ankle.x) / 2, hint.y - (root.y + ankle.y) / 2, 0);
      if (P.pole.lengthSq() < 1e-6) P.pole.set(l === "LF" ? -rx : rx, l === "LF" ? -ry : ry, 0);
      P.pole.normalize();
      P.pole.z = 0.55;
      bend(root, ankle, legU, legL, P.pole, out);
    }

    // Put the meshes on the points.
    const chest = P.chest.copy(P.neck).lerp(P.hip, 0.06), mid = P.tmp.copy(chest).lerp(P.hip, 0.5);
    _d.subVectors(chest, P.hip);
    const tl = _d.length() || 1;
    const yAxis = _d.clone().divideScalar(tl), xAxis = new THREE.Vector3(rx, ry, 0);
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();
    _m4.makeBasis(xAxis, yAxis, zAxis);
    body.torso.quaternion.setFromRotationMatrix(_m4);
    body.torso.position.copy(mid);
    body.torso.scale.set(0.118 * H, tl, 0.062 * H);
    body.pelvis.quaternion.copy(body.torso.quaternion);
    body.pelvis.position.copy(P.hip);
    body.pelvis.scale.set(0.09 * H, 0.055 * H, 0.058 * H);
    tube(body.neck, chest, P.head, 0.024 * H);
    ball(body.head, P.head, 0.062 * H);
    const arm = (l, root, elbow, hand) => {
      const b = body.limb[l];
      tube(b.upper, root, elbow, 0.027 * H); tube(b.lower, elbow, hand, 0.022 * H);
      ball(b.root, root, 0.034 * H); ball(b.mid, elbow, 0.027 * H); ball(b.end, hand, 0.032 * H);
    };
    const leg = (l, root, knee, ankle, toe) => {
      const b = body.limb[l];
      tube(b.upper, root, knee, 0.04 * H); tube(b.lower, knee, ankle, 0.029 * H); tube(b.foot, ankle, toe, 0.022 * H);
      ball(b.root, root, 0.043 * H); ball(b.mid, knee, 0.034 * H); ball(b.end, ankle, 0.029 * H);
    };
    arm("LH", P.ls, P.le, P.lh); arm("RH", P.rs, P.re, P.rh);
    leg("LF", P.lhip, P.lk, P.la, P.lf); leg("RF", P.rhip, P.rk, P.ra, P.rf);
    for (const l of LIMBS) {
      const mat = l === mover ? activeMat : bodyMat, b = body.limb[l];
      for (const part of [b.upper, b.lower, b.mid, b.end, b.foot]) if (part && part.material !== mat) part.material = mat;
    }
    return { A, B, p, mover, eBody, z, hipZ };
  }

  // ------------------------------------------------------------ physics overlays

  const _col = new THREE.Color(), _w = new THREE.Vector3(), _f2 = new THREE.Vector2(), _at2 = new THREE.Vector2();
  const shareA = linear(CYAN), shareB = linear(MAGENTA);
  function posePhysics(st, live) {
    const { A, B, p, mover, eBody } = st;
    const on = showForces && A.physics && B.physics;
    for (const l of LIMBS) {
      const fa = on ? A.physics.forces[l] : null, fb = on ? B.physics.forces[l] : null, ar = arrows[l];
      if (!fa && !fb) { ar.g.visible = false; live.share[l] = 0; continue; }
      // Blend the force from one position to the next. The limb that is in the air carries nothing.
      const air = l === mover ? 1 - Math.sin(Math.PI * clamp(p, 0, 1)) : 1;
      _f2.set(0, 0);
      if (fa) _f2.addScaledVector(fa.f, 1 - eBody);
      if (fb) _f2.addScaledVector(fb.f, eBody);
      _f2.multiplyScalar(air);
      const share = (lerp(fa ? fa.share : 0, fb ? fb.share : 0, eBody)) * air;
      live.share[l] = share;
      const size = _f2.length();
      if (size < 0.01) { ar.g.visible = false; continue; }
      const end = P[END_JOINT[l]];
      _at2.set(end.x, end.y);
      const len = clamp(size * 1.8, 0.12, 2.2), headLen = Math.min(0.14, len * 0.4), r = 0.014 + 0.02 * clamp(share, 0, 1);
      ar.g.visible = true;
      ar.g.position.set(_at2.x, _at2.y, end.z + 0.09);
      ar.g.quaternion.setFromUnitVectors(UP, _w.set(_f2.x / size, _f2.y / size, 0));
      ar.shaft.position.set(0, (len - headLen) / 2, 0);
      ar.shaft.scale.set(r, len - headLen, r);
      ar.head.position.set(0, len - headLen / 2, 0);
      ar.head.scale.set(r * 2.6, headLen, r * 2.6);
      ar.mat.color.copy(shareA).lerp(shareB, clamp(share * 1.8, 0, 1)).multiplyScalar(1.35);
    }
    // Balance point (centre of mass): a marker at the body, a dashed line straight down, a ring on the floor.
    const ca = on && A.physics.com, cb = on && B.physics.com;
    if (ca && cb) {
      _at2.copy(ca).lerp(cb, eBody);
      _w.set(_at2.x, _at2.y, st.hipZ * 0.9);
      wall.localToWorld(_w);
      comGroup.visible = true;
      com.position.copy(_w);
      com.rotation.y = clock * 1.4;
      const arr = dropGeo.attributes.position.array;
      arr[0] = _w.x; arr[1] = _w.y; arr[2] = _w.z; arr[3] = _w.x; arr[4] = 0.005; arr[5] = _w.z;
      dropGeo.attributes.position.needsUpdate = true;
      drop.computeLineDistances();
      comFloor.position.set(_w.x, 0.006, _w.z);
    } else comGroup.visible = false;
  }

  // ------------------------------------------------------------ HUD

  function buildHud() {
    const grade = solve?.grade;
    const nHolds = S.holds.size, nRoute = S.route.size;
    const lean = Math.abs(S.angleDeg) < 0.5 ? "upright" : S.angleDeg > 0 ? `leaning ${Math.round(S.angleDeg)}° toward you` : `leaning ${Math.round(-S.angleDeg)}° away from you`;
    const who = Number(solveRequest?.climber_height_m) ? ` · climber ${Number(solveRequest.climber_height_m).toFixed(2)} m` : "";
    setText(ui.wallinfo, `Wall ${S.wallH.toFixed(1)} m high, ${lean}${who}`);
    if (grade?.font) {
      const band = gradeBand(grade.font);
      setText(ui.gradetag, "How hard");
      ui.grade.innerHTML = "";
      ui.grade.append(document.createTextNode(grade.font + " "));
      const sm = document.createElement("small");
      sm.textContent = band ? `· ${band}` : "";
      ui.grade.append(sm);
      setText(ui.gradesub, grade.low && grade.high && grade.low !== grade.high ? `Likely between ${grade.low} and ${grade.high}` : "");
    } else {
      setText(ui.gradetag, "Wall scan");
      ui.grade.textContent = `${nHolds} grips`;
      const routes = analyze?.routes?.length;
      setText(ui.gradesub, nRoute ? `${nRoute} grips on the chosen route. Not solved yet.`
        : routes ? `${routes} colour groups found. Pick a route to see how to climb it.` : "Pick a route to see how to climb it.");
    }
    ui.movebox.hidden = !K;
    ui.physbox.hidden = !(K && K.hasPhysics);
    if (buttons.forces) buttons.forces.hidden = !(K && K.hasPhysics);
    for (const a of ["prev", "play", "next"]) buttons[a].hidden = !K || !K.moves.length;
    if (buttons.follow) buttons.follow.hidden = !K;
    ui.line.innerHTML = "";
    ui.line.style.display = K && K.moves.length ? "" : "none";
    if (K) {
      K.moves.forEach((m, i) => {
        const seg = document.createElement("button");
        seg.className = "bcx-seg" + (m.hard ? " hard" : "") + (m.limb[1] === "F" ? " foot" : "");
        seg.title = `Move ${i + 1}: ${m.text}`;
        seg.appendChild(document.createElement("i"));
        seg.addEventListener("click", () => api.seek(i));
        ui.line.appendChild(seg);
      });
      ui.limbs.innerHTML = "";
      ui.limbRows = {};
      for (const l of LIMBS) {
        const row = document.createElement("div");
        row.className = "bcx-limb";
        row.innerHTML = `<span>${LIMB_NAME[l]}</span><div class="bcx-bar"><i></i></div><span></span>`;
        ui.limbs.appendChild(row);
        ui.limbRows[l] = { row, bar: row.querySelector("i"), pct: row.lastChild };
      }
      const ph = solve.physics;
      setText(ui.physsum, ph && typeof ph.max_effort === "number"
        ? (typeof ph.finish_chance === "number" ? `Chance of reaching the top: ${Math.round(ph.finish_chance * 100)}% (the safest way up). ` : "") +
          `Highest effort ${Math.round(ph.max_effort * 100)}%, average ${Math.round((ph.mean_effort ?? 0) * 100)}%.` +
          (ph.unstable_positions ? ` ${ph.unstable_positions} position${ph.unstable_positions > 1 ? "s" : ""} cannot be held still.` : "")
        : "");
    }
    updatePlayButton();
  }

  function updatePlayButton() {
    buttons.play.textContent = playing ? "Pause" : "Play";
    if (buttons.speed) buttons.speed.textContent = `Speed ${speed}×`;
    if (buttons.forces) buttons.forces.textContent = `Forces: ${showForces ? "on" : "off"}`;
    if (buttons.follow) buttons.follow.textContent = `Camera: ${following ? "climber" : "wall"}`;
  }

  const live = { share: { LH: 0, RH: 0, LF: 0, RF: 0 }, effort: 0, tint: new THREE.Color() };
  function updateHud(where, st) {
    const { moves } = K, n = moves.length;
    const m = where.i >= 0 ? moves[where.i] : null;
    setText(ui.count, m ? `Move ${where.i + 1} of ${n}` : n ? `Start · ${n} moves` : "Start position");
    setText(ui.what, m ? m.text : "Ready: hands on the start grips");
    setOn(ui.flag, !!m && m.hard);
    // Effort shown: the physics number when there is one, otherwise the solver's relative cost.
    let effort = 0, word = "";
    if (m) {
      if (m.effort !== null) { effort = m.effort; word = `${Math.round(effort * 100)}% of full grip strength`; }
      if (m.fall !== null && m.fall !== undefined) word += ` · ${m.fall < 0.01 ? "under 1" : Math.round(m.fall * 100)}% chance of slipping`;
      else { effort = m.load; word = effort < 0.34 ? "light" : effort < 0.67 ? "moderate" : "heavy"; }
    } else if (st.A.physics) { effort = st.A.physics.effort; word = `${Math.round(effort * 100)}% of full grip strength`; }
    const unstable = m ? !m.stable : st.A.physics ? !st.A.physics.stable : false;
    setText(ui.effortword, word);
    const w = `${Math.round(clamp(effort, 0, 1) * 100)}%`;
    if (ui.effortbar.__w !== w) { ui.effortbar.__w = w; ui.effortbar.style.width = w; }
    const tintE = m && m.effort === null ? effort * 0.7 : effort;       // without physics, never show "at the limit" red
    effortColor(tintE, _col);
    const css = `#${_col.clone().convertLinearToSRGB().getHexString()}`;
    if (ui.effortbar.__c !== css) { ui.effortbar.__c = css; ui.effortbar.style.background = css; ui.effortbar.style.color = css; }
    setOn(ui.warn, unstable);
    const alert = unstable ? "CANNOT BE HELD STILL" : m && m.hard && where.phase !== "end" ? "HARDEST MOVE" : "";
    setText(ui.alert, alert);
    setOn(ui.alert, !!alert);
    if (ui.alert.__d !== unstable) { ui.alert.__d = unstable; ui.alert.classList.toggle("danger", unstable); }
    // Timeline.
    const segs = ui.line.children;
    for (let i = 0; i < segs.length; i++) {
      const fill = i < where.i ? 100 : i === where.i ? Math.round(where.p * 100) : 0;
      const bar = segs[i].firstChild;
      if (bar.__w !== fill) { bar.__w = fill; bar.style.width = fill + "%"; }
    }
    // Who carries the weight.
    if (K.hasPhysics && ui.limbRows) {
      for (const l of LIMBS) {
        const r = ui.limbRows[l], pct = Math.round(live.share[l] * 100), moving = st.mover === l && where.phase === "move";
        if (r.__p !== pct) { r.__p = pct; r.bar.style.width = clamp(pct, 0, 100) + "%"; r.pct.textContent = pct + "%"; }
        if (r.__m !== moving) { r.__m = moving; r.row.classList.toggle("moving", moving); r.row.firstChild.textContent = LIMB_NAME[l] + (moving ? " •" : ""); }
      }
    }
    // Figure colour: eased toward the colour for this effort; flashes hot when the position cannot be held.
    live.tint.lerp(effortColor(tintE, _col), 0.12);
    bodyMat.uniforms.uColor.value.copy(live.tint);
    if (unstable) bodyMat.uniforms.uColor.value.lerp(linear(HOT), 0.5 + 0.5 * Math.sin(clock * 14)).multiplyScalar(1.25);
  }

  // ------------------------------------------------------------ frame loop

  let last = performance.now(), frames = 0, fpsFrom = last, fps = 0, slowFor = 0, raf = 0;
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now; clock += dt;
    frames++;
    if (now - fpsFrom >= 1000) {
      fps = (frames * 1000) / (now - fpsFrom); frames = 0; fpsFrom = now;
      // If the laptop cannot keep up, draw fewer pixels rather than drop frames.
      slowFor = fps < 42 ? slowFor + 1 : 0;
      if (slowFor >= 3 && pixelRatio > 1) { pixelRatio = 1; slowFor = 0; api.resize(); }
    }

    if (K) {
      if ((playing || stepping) && K.moves.length) {
        t += dt * speed;
        if (stepping) {
          const s = timeline[stepping.i];
          if (t >= s.t0 + s.move) { t = s.t0 + s.move; stepping = false; }
        } else if (t >= total) {
          if (opts.loop) { t = 0; lastMove = -2; emit("loop"); }
          else { t = total - 1e-3; playing = false; updatePlayButton(); emit("end"); }
        }
      }
      const where = locate(t);
      if (where.i !== lastMove) { lastMove = where.i; if (where.i >= 0) emit("move", where.i); }
      const st = poseFigure(where);
      posePhysics(st, live);
      if (climber) {
        // The climber's frame has x = 0 at the photo's left edge and z = 0 on a flat wall. Shift it out
        // by the wall surface behind the hips, so a volume behind the body pushes the whole body out.
        const under = S.depthAt(P.hip.x, P.hip.y), dx = S.wallW / 2;
        const at = (v) => [v.x + dx, v.y, Math.max(v.z, S.depthAt(v.x, v.y) + 0.05) - under];
        climber.group.position.set(-dx, 0, under);
        climber.group.visible = figure.visible;
        const m = where.i >= 0 ? K.moves[where.i] : null;
        climber.setPose(poseFromTargets({ heightM: K.height, lHand: at(P.lh), rHand: at(P.rh), lFoot: at(P.lf), rFoot: at(P.rf),
                                           pelvis: [P.hip.x + dx, P.hip.y] }));
        climber.setState({ effort: live.effort, stable: live.effort < 1, movingLimb: m && where.phase !== "end" ? m.limb : null });
        climber.update(dt);
      }
      updateHud(where, st);
      // Ring on the place the moving hand or foot is going to.
      const m = where.i >= 0 ? K.moves[where.i] : null;
      if (m && where.phase !== "end") {
        const endTo = st.B.J[END_JOINT[m.limb]];
        const r = m.hold ? Math.max(m.hold.w || 30, m.hold.h || 30) * S.mpp * 0.5 + 0.05 : 0.09;
        const pulse = 1 + 0.12 * Math.sin(clock * 7);
        targetRing.visible = true;
        targetRing.position.set(endTo.x, endTo.y, 0.015);
        targetRing.scale.set(r * pulse, r * pulse, r * 0.6);
        targetRing.material.color.copy(linear(m.hard ? MAGENTA : "#ffffff")).multiplyScalar(m.hard ? 2.6 : 1.7);
        hardLabel.visible = m.hard;
        if (m.hard) hardLabel.position.set(endTo.x, endTo.y + r + 0.2, 0.2);
      } else { targetRing.visible = false; hardLabel.visible = false; }
    }

    if (following && K) {                               // keep the climber in the middle of the picture
      _w.copy(P.hip).lerp(P.head, 0.4);
      wall.localToWorld(_w).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 3));
      controls.target.add(_w);
      camera.position.add(_w);
    }
    if (swaying) {                                      // slow side-to-side drift until the user takes over
      _w.subVectors(camera.position, controls.target);
      const radius = Math.hypot(_w.x, _w.z), az = home.az + 0.2 * Math.sin(clock * 0.33);
      camera.position.set(controls.target.x + Math.sin(az) * radius, camera.position.y, controls.target.z + Math.cos(az) * radius);
    }
    controls.update();
    renderer.info.reset();
    composer.render(dt);
  }

  // ------------------------------------------------------------ public methods

  // ---- click a hold to see what it is
  const HOLD_ABOUT = {
    jug: "A deep grip you can wrap your whole hand around. The easiest kind to hold.",
    crimp: "A thin edge that only fits your fingertips. Hard on the fingers.",
    sloper: "A rounded bump with no edge. You hold it with an open hand and friction.",
    pinch: "You squeeze it between thumb and fingers.",
    pocket: "A hole that takes one to three fingers.",
    volume: "A big bolted-on shape. You press on it, stand on it, or use its edges.",
    foot: "A tiny hold meant for feet only.",
    unknown: "The app could not tell what kind of hold this is.",
  };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), _hit = new THREE.Vector3();
  const pickRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: linear(CYAN).multiplyScalar(2.6) }));
  pickRing.visible = false;
  wall.add(pickRing);
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !S) return;   // a drag turns the camera
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const surface = wallStatic.getObjectByName("surface");
    const hit = surface && ray.intersectObject(surface, false)[0];
    if (!hit) { showHold(null); return; }
    wall.worldToLocal(_hit.copy(hit.point));
    let best = null, bestD = Infinity;
    for (const h of S.holds.values()) {
      const [x, y] = S.toWall(h.x, h.y), reach = Math.max(h.w || 30, h.h || 30) * S.mpp * 0.6 + 0.04;
      const d = Math.hypot(x - _hit.x, y - _hit.y);
      if (d < reach && d < bestD) { best = h; bestD = d; }
    }
    showHold(best);
  });
  // A small 3D close-up of one hold: that patch of the photo, raised by the depth map, with the
  // hold itself puffed up from its outline so its shape reads even on a flat wall. It turns slowly;
  // drag to turn it by hand.
  let closeUp = null;
  function holdCloseUp(canvas, h) {
    closeUp?.stop();
    const W = canvas.clientWidth || 240, Hc = canvas.clientHeight || 170;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(W, Hc, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, W / Hc, 0.01, 20);
    sc.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(-1, 1.4, 1.6); sc.add(sun);
    const [cx, cy] = S.toWall(h.x, h.y);
    const hw = Math.max(h.w || 30, 8) * S.mpp / 2, hh = Math.max(h.h || 30, 8) * S.mpp / 2;
    const size = Math.max(hw, hh) * 2 * 1.9 + 0.06;
    const geo = new THREE.PlaneGeometry(size, size, 72, 72), pos = geo.attributes.position;
    const base = S.reliefAt(cx, cy), out = Math.max(reliefOf(h), 0.025);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const e = (x / hw) ** 2 + (y / hh) ** 2;                          // inside the hold's ellipse when below 1
      const dome = e < 1 ? out * Math.sqrt(1 - e) : 0;
      pos.setZ(i, 2.2 * (S.reliefAt(cx + x, cy + y) - base) + dome);    // depth is exaggerated to make the shape clear
    }
    geo.computeVertexNormals();
    let tex = null;
    if (photo) {
      tex = photo.clone();
      tex.repeat.set(size / S.wallW, size / S.wallH);
      tex.offset.set((cx - size / 2) / S.wallW + 0.5, (cy - size / 2) / S.wallH);
      tex.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0x2a3b55 }));
    sc.add(mesh);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size)), new THREE.LineBasicMaterial({ color: linear(CYAN) }));
    sc.add(edge);
    let az = 0.5, el = 0.5, dragging = null, alive = true;
    const dist = size * 1.9;
    canvas.onpointerdown = (e) => { dragging = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); };
    canvas.onpointermove = (e) => { if (!dragging) return; az -= (e.clientX - dragging[0]) * 0.012; el = clamp(el + (e.clientY - dragging[1]) * 0.01, 0.05, 1.3); dragging = [e.clientX, e.clientY]; };
    canvas.onpointerup = () => { dragging = null; };
    const tick = () => {
      if (!alive) return;
      if (!dragging) az += 0.006;
      const a = clamp(Math.sin(az) * 0.9, -0.9, 0.9);                   // swing side to side in front of the wall
      cam.position.set(dist * Math.sin(a) * Math.cos(el), dist * Math.sin(el) * 0.8, dist * Math.cos(a) * Math.cos(el) + 0.02);
      cam.lookAt(0, 0, out * 0.4);
      r.render(sc, cam);
      requestAnimationFrame(tick);
    };
    tick();
    closeUp = { stop() { alive = false; geo.dispose(); mesh.material.dispose(); tex?.dispose(); r.dispose(); closeUp = null; } };
  }

  function showHold(h) {
    const box = ui.info;
    if (!h) { box.classList.remove("on"); pickRing.visible = false; closeUp?.stop(); return; }
    const [x, y] = S.toWall(h.x, h.y), size = Math.max(h.w || 30, h.h || 30) * S.mpp;
    pickRing.position.set(x, y, S.depthAt(x, y) + reliefOf(h) + 0.02);
    pickRing.scale.set(size * 0.62 + 0.03, size * 0.62 + 0.03, 0.25);
    pickRing.visible = true;
    const role = S.start.has(h.id) ? "A start hold of this climb." : S.finish.has(h.id) ? "The top hold of this climb." : S.route.has(h.id) ? "Part of this climb." : "Not part of the climb shown.";
    const q = Number(h.quality), grip = !Number.isFinite(q) ? "" : q >= 0.75 ? "good" : q >= 0.45 ? "medium" : "poor";
    const guesses = (h.suggestions || []).map((g) => `${HOLD_LABEL[g.type] || g.type} ${Math.round(g.p * 100)}%`).join(" · ");
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    box.innerHTML = `<button class="x" title="Close">✕</button>
      <div class="bcx-tag">Hold ${esc(h.id)}</div>
      <h3>${esc(HOLD_LABEL[h.type] || "Grip")}</h3>
      <canvas class="hold3d" title="Drag to turn"></canvas>
      <div>${esc(HOLD_ABOUT[h.type] || HOLD_ABOUT.unknown)}</div>
      <div class="bcx-rule"></div>
      <div><span class="sw" style="background:${esc(h.color || "#888")}"></span>${esc(h.color_name || "colour")}${h.route !== undefined && h.route !== null ? ` · in the ${esc(h.color_name || "")} group of holds` : ""}</div>
      ${grip ? `<div>Grip: ${grip}</div>` : ""}
      <div>${role}</div>
      <div>About ${Math.round(Math.max(h.w || 0, h.h || 0) * S.mpp * 100)} cm across${relief ? `, sticks out about ${Math.round(S.depthAt(x, y) * 100 + reliefOf(h) * 100)} cm` : ""}.</div>
      ${guesses ? `<div class="bcx-note">What the app thinks it is: ${esc(guesses)}${h.needs_review ? " (not sure, so it asks)" : ""}</div>` : ""}`;
    box.querySelector(".x").onclick = () => showHold(null);
    box.classList.add("on");
    holdCloseUp(box.querySelector("canvas.hold3d"), h);
    emit("hold", h);
  }

  const api = {
    /** Show a new route and its solution. Either may be null: no request shows the bare wall, no solve shows the route only. */
    setMesh(on) { meshOn = !!on; build(); prepare(); applyView(); return api; },
    setSolve(request, response) {
      solveRequest = request || null; solve = response || null;
      build(); prepare(); buildHud();
      figure.visible = !!K;
      if (!K) following = false;
      if (!K) { for (const l of LIMBS) arrows[l].g.visible = false; comGroup.visible = false; targetRing.visible = false; hardLabel.visible = false; }
      live.tint.copy(linear(CYAN));
      emit("ready");
      return api;
    },
    play() { playing = true; stepping = false; updatePlayButton(); return api; },
    pause() { playing = false; updatePlayButton(); return api; },
    /** Jump to a move (0 is the first). While paused it plays that one move and stops; pass { animate: false } to show its end position at once. */
    seek(moveIndex, { animate = true } = {}) {
      if (!K || !timeline.length) return api;
      const i = clamp(Math.round(Number(moveIndex) || 0), 0, timeline.length - 1), s = timeline[i];
      stepping = false;
      if (playing || animate) { t = s.t0; if (!playing) stepping = { i }; }
      else t = s.t0 + s.move;
      lastMove = i;
      emit("move", i);
      return api;
    },
    setSpeed(x) { speed = clamp(Number(x) || 1, 0.1, 8); updatePlayButton(); return api; },
    /** "photo" or "schematic" (a plain dark wall with the holds only). */
    setView(mode) { viewMode = mode === "schematic" ? "schematic" : "photo"; applyView(); return api; },
    resetView() { userMoved = false; following = false; fitCamera(false); swaying = !!opts.sway; updatePlayButton(); return api; },
    /** true: move in close and keep the camera on the climber. false: back to the whole wall. */
    setFollow(on) {
      if (!on || !K) return api.resetView();
      if (!following) {
        fitCamera(false);
        _w.copy(P.hip).lerp(P.head, 0.4);
        wall.localToWorld(_w);
        camera.position.sub(controls.target).multiplyScalar(0.5).add(_w);
        controls.target.copy(_w);
      }
      following = true; userMoved = true;
      updatePlayButton();
      return api;
    },
    /** Place the camera: angles in degrees (azimuth 0 is straight on, negative is from the left), zoom 2 is twice as close, target "climber" or "wall". */
    setCamera({ azimuth = -20, elevation = 4, zoom = 1, target = "wall" } = {}) {
      fitCamera(false);
      swaying = false; userMoved = true;
      const dist = home.pos.distanceTo(home.target) / Math.max(zoom, 0.05), az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
      if (target === "climber" && K) controls.target.copy(wall.localToWorld(P.hip.clone().lerp(P.head, 0.4)));
      camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(controls.target);
      controls.update();
      return api;
    },
    /** on("move", (moveIndex) => {}) fires as each move starts. Also "ready", "loop", "end". Returns a function that removes the listener. */
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    resize() {
      const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      camera.aspect = w / h;
      const small = w < 720 || h < 460;
      root.classList.toggle("small", small);
      root.classList.toggle("mid", !small && (w < 1100 || h < 620));
      // On a wide screen, slide the picture right and up a little so the wall clears the panel on the left and the buttons.
      if (opts.hud && !small && w / h > 1.45) camera.setViewOffset(w, h, -0.1 * w, 0.025 * h, w, h);
      else if (opts.hud && small && h > w) camera.setViewOffset(w, h, 0, -0.06 * h, w, h);   // tall and narrow: slide it down, below the panel
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      fitCamera(userMoved);                             // re-frame only while the user has not moved the camera
      return api;
    },
    /** Numbers for checking performance. */
    stats() { return { fps: Math.round(fps * 10) / 10, pixelRatio, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, holds: S ? S.holds.size : 0,
                      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
    /** Where the animation is: { move, of, playing }. move is -1 before the first move. */
    state() { const w = locate(t); return { move: K ? w.i : -1, of: K ? K.moves.length : 0, progress: w.p, phase: w.phase, playing }; },
    dispose() {
      climber?.dispose();
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      freeTree(scene);
      photo?.dispose();
      activeMat.dispose(); bodyMat.dispose();
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); bloom.dispose?.();
      renderer.dispose();
      root.remove();
      listeners.clear();
    },
  };

  // ---- controls: buttons, keyboard, camera
  const step = (by) => {
    if (!K || !timeline.length) return;
    const w = locate(t);
    playing = false;
    updatePlayButton();
    let i = w.phase === "start" ? 0 : w.i + by;      // forward plays the next move, back replays the one before
    if (i >= timeline.length) i = 0;
    api.seek(Math.max(0, i));
  };
  const actions = {
    prev: () => step(-1), next: () => step(1),
    play: () => (playing ? api.pause() : api.play()),
    mesh: () => api.setMesh(!meshOn),
    reset: () => api.resetView(),
  };
  for (const [name, el] of Object.entries(buttons)) el.addEventListener("click", (e) => { e.stopPropagation(); actions[name](); });
  root.addEventListener("keydown", (e) => {
    if (e.key === " ") { actions.play(); e.preventDefault(); }
    else if (e.key === "ArrowRight") { actions.next(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { actions.prev(); e.preventDefault(); }
  });
  controls.addEventListener("start", () => { swaying = false; userMoved = true; });
  const observer = new ResizeObserver(() => api.resize());
  observer.observe(root);

  // ---- start
  build(); prepare(); buildHud();
  figure.visible = !!K;
  api.resize();
  fitCamera(false);
  if (opts.imageUrl) {
    new THREE.TextureLoader().load(opts.imageUrl, (tex) => {
      if (disposed) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      photo = tex;
      applyView();
      emit("photo");
    }, undefined, () => { console.warn("BetaCrux viewer: the wall photo could not be loaded; showing the plain wall."); applyView(); });
  }
  if (opts.reliefUrl) {
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data, data = new Float32Array(c.width * c.height);
      for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
      relief = { w: c.width, h: c.height, data };
      build(); prepare(); applyView();
      emit("relief");
    };
    img.onerror = () => console.warn("BetaCrux viewer: the relief map could not be loaded; the wall stays flat.");
    img.src = opts.reliefUrl;
  }
  raf = requestAnimationFrame(frame);
  emit("ready");
  return api;
}
