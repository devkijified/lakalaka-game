// Lakalaka 3D simulation. A real court in perspective, a real skinned human
// (Mixamo character, one GLB mesh on a 65 bone skeleton), and a timed
// animation state machine. Every move is keyframes, parabolic travel and
// easing driven by elapsed time in the render loop, posed on the skeleton.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const canvas = document.getElementById('glcanvas');
const container = document.getElementById('court3d');
const labelLayer = document.getElementById('labelLayer');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8d7b8);
scene.fog = new THREE.Fog(0xe8d7b8, 11, 24);

const camera = new THREE.PerspectiveCamera(57, 1, 0.1, 60);
const camBase = new THREE.Vector3(0.42, 2.02, 4.28);
const camTargetBase = new THREE.Vector3(0, 0.34, -0.55);
camera.position.copy(camBase);

// Daylight: warm hemisphere plus a sun that casts real soft shadows.
scene.add(new THREE.HemisphereLight(0xd6e6f5, 0x8a6a48, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
sun.position.set(3.6, 6.2, 2.8);
// Portrait fill, only lit while the test hook's face camera is active, so
// the close up of the figure's face is readable (she is backlit at start).
const faceFill = new THREE.PointLight(0xfff1d6, 1.1, 3, 1.4);
faceFill.visible = false;
scene.add(faceFill);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4.5; sun.shadow.camera.right = 4.5;
sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 18;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 4;
scene.add(sun);

// ---------------------------------------------------------------------------
// World layout. A box is about 0.95 units, the figure is 1.75 units tall.
// Snake order on the ground: 1 bottom left, 2 bottom right, 3 middle right,
// 4 middle left, 5 top left, 6 top right, 7 the rest box across the top.
const BOXW = 0.95, GAP = 0.07;
const BOX_POS = {
  1: { x: -(BOXW + GAP) / 2, z: 1.45 }, 2: { x: (BOXW + GAP) / 2, z: 1.45 },
  4: { x: -(BOXW + GAP) / 2, z: 0.48 }, 3: { x: (BOXW + GAP) / 2, z: 0.48 },
  5: { x: -(BOXW + GAP) / 2, z: -0.49 }, 6: { x: (BOXW + GAP) / 2, z: -0.49 },
  7: { x: 0, z: -1.46 }
};
const COURT_W = BOXW * 2 + GAP;          // 1.97
const COURT_D = BOXW * 4 + GAP * 3;      // 4.01
const START = { x: 0, z: 2.66 };

// ---------------------------------------------------------------------------
// Procedural textures (canvas): worn earth and chalk lines with grain.
function earthTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#7d5a38'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 460; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 14 + Math.random() * 100;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random() > 0.55 ? '150,112,70' : (Math.random() > 0.5 ? '104,76,46' : '90,62,36');
    grad.addColorStop(0, 'rgba(' + tone + ',' + (0.16 + Math.random() * 0.16) + ')');
    grad.addColorStop(1, 'rgba(' + tone + ',0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 11000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? 'rgba(232,208,164,' + (0.05 + Math.random() * 0.13) + ')' : 'rgba(38,24,12,' + (0.05 + Math.random() * 0.13) + ')';
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2.4, 1 + Math.random() * 2.4);
  }
  // Small stones and dry flecks scattered in the earth.
  for (let i = 0; i < 700; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(196,170,130,0.35)' : 'rgba(52,36,20,0.30)';
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 0.8 + Math.random() * 1.8, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function courtTexture() {
  const W = 1024, H = 2048;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  // Worn lighter patch under the court: swept, trodden earth, mottled so the
  // court area reads as lived on ground rather than flat colour.
  g.fillStyle = 'rgba(216,186,138,0.30)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 30 + Math.random() * 130;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random() > 0.5 ? '226,198,148' : '168,132,88';
    grad.addColorStop(0, 'rgba(' + tone + ',' + (0.10 + Math.random() * 0.14) + ')');
    grad.addColorStop(1, 'rgba(' + tone + ',0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 7000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? 'rgba(238,216,172,' + (0.05 + Math.random() * 0.11) + ')' : 'rgba(70,50,28,' + (0.05 + Math.random() * 0.11) + ')';
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const px = (x) => ((x + COURT_W / 2) / COURT_W) * W;
  const py = (z) => ((z + COURT_D / 2) / COURT_D) * H; // south edge at bottom of canvas
  function chalkRect(x0, z0, x1, z1) {
    for (let pass = 0; pass < 3; pass++) {
      g.strokeStyle = 'rgba(246,240,224,' + (pass === 0 ? 0.34 : 0.85) + ')';
      g.lineWidth = pass === 0 ? 15 : 6.5;
      g.beginPath();
      const j = () => (Math.random() - 0.5) * 7;
      g.moveTo(px(x0) + j(), py(z0) + j());
      g.lineTo(px(x1) + j(), py(z0) + j());
      g.lineTo(px(x1) + j(), py(z1) + j());
      g.lineTo(px(x0) + j(), py(z1) + j());
      g.closePath(); g.stroke();
    }
  }
  for (let b = 1; b <= 7; b++) {
    const p = BOX_POS[b];
    const w = b === 7 ? COURT_W : BOXW;
    chalkRect(p.x - w / 2, p.z - BOXW / 2, p.x + w / 2, p.z + BOXW / 2);
  }
  // Chalk grain knocked out of the lines.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = 'rgba(0,0,0,' + (0.05 + Math.random() * 0.16) + ')';
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 4, 1 + Math.random() * 3);
  }
  g.globalCompositeOperation = 'source-over';
  // Numbers painted in chalk.
  g.fillStyle = 'rgba(246,240,224,0.92)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let b = 1; b <= 7; b++) {
    const p = BOX_POS[b];
    g.save();
    g.translate(px(p.x), py(p.z));
    g.rotate((Math.random() - 0.5) * 0.05);
    g.font = '700 ' + (b === 7 ? 120 : 132) + 'px "Figtree", system-ui, sans-serif';
    g.fillText(String(b), 0, 6);
    g.restore();
  }
  g.font = '700 44px "Figtree", system-ui, sans-serif';
  g.fillStyle = 'rgba(246,240,224,0.75)';
  g.fillText('R E S T', px(0), py(BOX_POS[7].z) + 118);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function dustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,244,220,0.85)');
  grad.addColorStop(0.55, 'rgba(232,205,160,0.38)');
  grad.addColorStop(1, 'rgba(232,205,160,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Scene geometry: ground, court, compound backdrop, tree.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 46),
  new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);

const court = new THREE.Mesh(
  new THREE.PlaneGeometry(COURT_W, COURT_D),
  new THREE.MeshStandardMaterial({ map: courtTexture(), transparent: true, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 })
);
court.rotation.x = -Math.PI / 2;
court.position.set(0, 0.002, -0.005);
court.receiveShadow = true;
scene.add(court);

{
  // Plastered compound wall across the far edge, taller now so the horizon
  // sits high in frame and the court owns the picture, plus a side return.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xa8875f, roughness: 0.95 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.55, 0.28), wallMat);
  wall.position.set(0, 0.775, -3.35); wall.castShadow = true; wall.receiveShadow = true;
  scene.add(wall);
  const wallCap = new THREE.Mesh(new THREE.BoxGeometry(11.7, 0.09, 0.4), new THREE.MeshStandardMaterial({ color: 0x8f714c, roughness: 1 }));
  wallCap.position.set(0, 1.59, -3.35); wallCap.castShadow = true;
  scene.add(wallCap);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.22, 0.32), new THREE.MeshStandardMaterial({ color: 0x7d6244, roughness: 1 }));
  plinth.position.set(0, 0.11, -3.35); plinth.receiveShadow = true;
  scene.add(plinth);
  const side = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.1, 5.4), wallMat);
  side.position.set(-3.6, 0.55, -1.2); side.castShadow = true; side.receiveShadow = true;
  scene.add(side);
  // A tree in the far corner: thick tapered trunk, a branch split, and a
  // canopy of several overlapping masses at varied heights, darker and less
  // saturated than the old single ball, with jittered smooth geometry so it
  // does not read as a faceted lollipop.
  const tree = new THREE.Group();
  tree.position.set(-3.05, 0, -3.0);
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x584129, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.21, 1.95, 10), barkMat);
  trunk.position.y = 0.97; trunk.castShadow = true;
  tree.add(trunk);
  [[0.42, 2.15, 0.1, 0.5, 0.35], [-0.38, 2.05, -0.05, -0.55, -0.3]].forEach((b) => {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.085, 0.85, 8), barkMat);
    br.position.set(b[0] / 2, b[1] - 0.35, b[2] / 2);
    br.rotation.z = b[3]; br.rotation.x = b[4] * 0.4;
    br.castShadow = true;
    tree.add(br);
  });
  const leafTones = [0x3a4c22, 0x42542a, 0x33431e, 0x47592e, 0x3d5026, 0x36491f];
  [[0, 2.85, 0, 1.02], [-0.78, 2.5, 0.18, 0.72], [0.72, 2.58, -0.14, 0.78], [-0.3, 3.3, -0.25, 0.68], [0.52, 3.12, 0.3, 0.6], [0.05, 2.45, 0.42, 0.55]].forEach((s, i) => {
    const geo = new THREE.SphereGeometry(s[3], 18, 14);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const j = 1 + (Math.sin(v * 12.9898) * 43758.5453 % 1) * 0.09;
      pos.setXYZ(v, pos.getX(v) * j, pos.getY(v) * j * 0.82, pos.getZ(v) * j);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: leafTones[i % leafTones.length], roughness: 1 }));
    m.position.set(s[0], s[1], s[2]); m.castShadow = true;
    tree.add(m);
  });
  scene.add(tree);
}

// House overlays: one tinted plane per box, owner name chalked on redraw.
const houseOverlays = {};
function makeHouseOverlay(box) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const w = box === 7 ? COURT_W - 0.06 : BOXW - 0.04;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, BOXW - 0.04),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(BOX_POS[box].x, 0.008, BOX_POS[box].z);
  m.visible = false;
  scene.add(m);
  return { mesh: m, canvas: cv, tex };
}
for (let b = 1; b <= 6; b++) houseOverlays[b] = makeHouseOverlay(b);
function drawHouse(box, owner) {
  const o = houseOverlays[box]; if (!o) return;
  const g = o.canvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  if (owner) {
    g.fillStyle = owner.color + '55';
    g.fillRect(4, 4, 248, 248);
    g.strokeStyle = owner.color; g.lineWidth = 7;
    g.strokeRect(8, 8, 240, 240);
    g.fillStyle = 'rgba(250,246,235,0.95)';
    g.font = '700 34px "Figtree", system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(owner.name.slice(0, 12), 128, 208);
    g.font = '700 22px "Figtree", system-ui, sans-serif';
    g.fillText('HOUSE', 128, 52);
    o.mesh.visible = true;
  } else o.mesh.visible = false;
  o.tex.needsUpdate = true;
}

// Next box highlight frame.
const highlight = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.strokeStyle = '#ffc857'; g.lineWidth = 9; g.strokeRect(7, 7, 114, 114);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(BOXW + 0.1, BOXW + 0.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.01; m.visible = false;
  scene.add(m);
  return m;
})();

// Invisible hit planes for raycast taps, one per box.
const hitPlanes = [];
for (let b = 1; b <= 7; b++) {
  const w = b === 7 ? COURT_W : BOXW;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, BOXW), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(BOX_POS[b].x, 0.02, BOX_POS[b].z);
  m.userData.box = b;
  scene.add(m); hitPlanes.push(m);
}

// The seed: a small grey stone.
const stone = new THREE.Mesh(
  new THREE.DodecahedronGeometry(0.062, 0),
  new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 1, flatShading: true })
);
stone.scale.set(1, 0.68, 0.85);
stone.castShadow = true;
stone.position.set(START.x + 0.3, 0.045, START.z - 0.15);
scene.add(stone);

// Dust puffs: a small pool of soft sprites.
const dustTex = dustTexture();
const dustPool = [];
for (let i = 0; i < 26; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false, color: 0xe4cda0 }));
  s.visible = false; scene.add(s);
  dustPool.push({ s, life: 0, vel: new THREE.Vector3() });
}
function puffDust(x, z, strength) {
  let n = Math.round(4 + strength * 3);
  for (const d of dustPool) {
    if (n <= 0) break;
    if (d.life > 0) continue;
    n--;
    d.life = 0.45 + Math.random() * 0.25;
    d.max = d.life;
    d.s.visible = true;
    d.s.position.set(x + (Math.random() - 0.5) * 0.14, 0.05, z + (Math.random() - 0.5) * 0.14);
    d.vel.set((Math.random() - 0.5) * 0.55, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 0.55);
    d.s.scale.setScalar(0.12 + Math.random() * 0.1);
  }
}

// ---------------------------------------------------------------------------
// The figure: a real skinned human. Michelle, a Mixamo character, ships as
// ONE skinned GLB mesh on a 65 bone skeleton (public/models/human.glb): her
// face, hair, hands, feet and clothes are the model's own geometry and
// textures. No primitive built body stands anywhere in this game, active
// player or waiting players alike.
//
// Posing runs on the skeleton. Each bone keeps its bind quaternion and a
// pose is delta rotations multiplied onto the bind pose. The delta axes
// below were measured on the actual rig (joint world positions per delta):
//   Arm x + swings the arm DOWN in the frontal plane, x - raises it.
//   Arm z swings a raised arm forward on the left (+), back on the right
//     mirrored: right forward is z -, right back is z +.
//   UpLeg x + swings the leg forward, x - back. Leg (knee) x - is knee
//     flexion (foot goes back). Foot x + lifts the toes. Spine x + bends
//     forward, y twists. Head x + pitches the face down.
// There is no idle clip in the model (only a samba dance and the bind
// pose), so idle and rest are the neutral bind pose with arms lowered by
// delta, plus breathing on the spine bones.
const FIGURE_H = 1.75;
let humanTemplate = null;
const pendingFigures = [];

function collectBones(model) {
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });
  return bones;
}

function instantiateHuman(fig) {
  if (!humanTemplate) { pendingFigures.push(fig); return; }
  const model = skeletonClone(humanTemplate);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = Math.max(0.5, box.max.y - box.min.y);
  const s = FIGURE_H / h;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  matteHumanMaterials(model);
  fig.root.add(model);
  fig.model = model;
  fig.scaleF = s;
  fig.bones = collectBones(model);
  fig.baseQuat = {};
  for (const k in fig.bones) fig.baseQuat[k] = fig.bones[k].quaternion.clone();
  fig.head = fig.bones.Head || null;
  fig.handR = fig.bones.RightHand || null;
  // Local direction on the hips bone that points along world +Y, so the
  // crouch drop (pose.pelvisY) moves the hips straight down in the world
  // whatever the bone's local axes are.
  const hips = fig.bones.Hips;
  if (hips) {
    fig.hipsBasePos = hips.position.clone();
    fig.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().extractRotation(hips.parent.matrixWorld).invert();
    fig.hipsUpLocal = new THREE.Vector3(0, 1, 0).applyMatrix4(inv).normalize();
  }
  fig.loaded = true;
  applyPose(fig, clonePose(P.idle));
}

function buildFigure() {
  const root = new THREE.Group();
  scene.add(root);
  const fig = {
    root, model: null, bones: null, baseQuat: null, head: null, handR: null,
    scaleF: 1, hipsBasePos: null, hipsUpLocal: null, loaded: false, label: null, name: ''
  };
  instantiateHuman(fig);
  return fig;
}

// Matte finish for the human model. As shipped, Ch03_Body carries
// metallicFactor 0.5 plus a KHR_materials_specular lobe, which reads as
// glossy plastic under the sun and portrait fill. Zero the metalness, let
// the roughness (glossiness derived) map run at full strength, and switch
// the specular lobe off, so skin and cloth shade matte. Textures, normal
// map and colours are untouched. Applied to the template on load and again
// to every clone in instantiateHuman, so active and waiting figures match.
function matteHumanMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.metalness = 0;
      m.roughness = 1.0;
      if ('envMapIntensity' in m) m.envMapIntensity = 0.3;
      if ('specularIntensity' in m) m.specularIntensity = 0;
      if (m.specularColor && m.specularColor.setRGB) m.specularColor.setRGB(0, 0, 0);
      m.needsUpdate = true;
    }
  });
}

new GLTFLoader().load('models/human.glb', (gltf) => {
  humanTemplate = gltf.scene;
  matteHumanMaterials(humanTemplate);
  const figs = pendingFigures.splice(0);
  for (const f of figs) instantiateHuman(f);
  window.__lakalakaHuman = true;
}, undefined, (err) => { console.error('Human model failed to load', err); });

// Pose application: pose keys drive Mixamo bones, with the spine keys
// distributed across the spine chain so bends curve instead of hinging.
const BONE_MAP = [
  ['spine', [['Spine', 0.55], ['Spine1', 0.45]]],
  ['chest', [['Spine2', 0.8], ['Neck', 0.25]]],
  ['head', [['Head', 0.8]]],
  ['shL', [['LeftArm', 1]]], ['elL', [['LeftForeArm', 1]]],
  ['shR', [['RightArm', 1]]], ['elR', [['RightForeArm', 1]]],
  ['hipL', [['LeftUpLeg', 1]]], ['kneeL', [['LeftLeg', 1]]], ['ankL', [['LeftFoot', 1]]],
  ['hipR', [['RightUpLeg', 1]]], ['kneeR', [['RightLeg', 1]]], ['ankR', [['RightFoot', 1]]]
];
const _de = new THREE.Euler();
const _dq = new THREE.Quaternion();
function applyPose(fig, pose) {
  if (!fig.bones) return;
  const hips = fig.bones.Hips;
  if (hips && fig.hipsBasePos) {
    hips.position.copy(fig.hipsBasePos).addScaledVector(fig.hipsUpLocal, (pose.pelvisY || 0) / (fig.scaleF || 1));
    _de.set(0, 0, pose.pelvisZ || 0);
    hips.quaternion.copy(fig.baseQuat.Hips).multiply(_dq.setFromEuler(_de));
  }
  for (const [key, targets] of BONE_MAP) {
    const v = pose[key] || [0, 0, 0];
    for (const [boneName, f] of targets) {
      const b = fig.bones[boneName];
      if (!b) continue;
      _de.set(v[0] * f, v[1] * f, v[2] * f);
      b.quaternion.copy(fig.baseQuat[boneName]).multiply(_dq.setFromEuler(_de));
    }
  }
}

function makeLabel() {
  const d = document.createElement('div');
  d.className = 'fig-label';
  labelLayer.appendChild(d);
  return d;
}

// Poses: per joint delta rotations [x, y, z] in Mixamo bone space (see the
// measured axis table in the figure section), plus pelvisY, the hips drop
// in world units. The bind pose has arms straight out sideways, so an arm
// at rest is x about 1.3 (swung down), and arms out for balance is x near 0.
const P = {
  idle: { pelvisY: 0, pelvisZ: 0, spine: [0.03, 0, 0], chest: [0, 0, 0], head: [0.06, 0, 0], shL: [1.3, 0, -0.07], elL: [0.22, 0, 0], shR: [1.3, 0, 0.07], elR: [0.22, 0, 0], hipL: [0.02, 0, 0], kneeL: [-0.04, 0, 0], ankL: [0, 0, 0], hipR: [-0.02, 0, 0], kneeR: [-0.04, 0, 0], ankR: [0, 0, 0] },
  oneleg: { pelvisY: -0.01, pelvisZ: 0.03, spine: [0.05, 0, 0], chest: [0, 0, 0], head: [0.05, 0, 0], shL: [0.8, 0, -0.22], elL: [0.15, 0, 0], shR: [0.8, 0, 0.22], elR: [0.15, 0, 0], hipL: [0.05, 0, 0], kneeL: [-0.08, 0, 0], ankL: [-0.05, 0, 0], hipR: [-0.55, 0, 0], kneeR: [-1.45, 0, 0], ankR: [-0.3, 0, 0] },
  rest: { pelvisY: -0.005, pelvisZ: 0, spine: [0.02, 0, 0], chest: [0, 0, 0], head: [0.02, 0, 0], shL: [1.02, 0, -0.18], elL: [0.6, 0, 0], shR: [1.02, 0, 0.18], elR: [0.6, 0, 0], hipL: [0.03, 0, 0], kneeL: [-0.05, 0, 0], ankL: [0, 0, 0], hipR: [-0.03, 0, 0], kneeR: [-0.05, 0, 0], ankR: [0, 0, 0] }
};
const JOINTS = ['spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'kneeL', 'ankL', 'hipR', 'kneeR', 'ankR'];
function clonePose(p) { const o = { pelvisY: p.pelvisY || 0, pelvisZ: p.pelvisZ || 0 }; for (const j of JOINTS) o[j] = p[j] ? [...p[j]] : [0, 0, 0]; return o; }
function lerpPose(a, b, k) {
  const o = { pelvisY: a.pelvisY + (b.pelvisY - a.pelvisY) * k, pelvisZ: a.pelvisZ + (b.pelvisZ - a.pelvisZ) * k };
  for (const j of JOINTS) o[j] = [0, 1, 2].map((i) => a[j][i] + (b[j][i] - a[j][i]) * k);
  return o;
}
function mergePose(base, over) { const o = clonePose(base); o.pelvisY = over.pelvisY !== undefined ? over.pelvisY : o.pelvisY; o.pelvisZ = over.pelvisZ !== undefined ? over.pelvisZ : o.pelvisZ; for (const j of JOINTS) if (over[j]) o[j] = [...over[j]]; return o; }
const easeIO = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - Math.pow(1 - u, 3);

// ---------------------------------------------------------------------------
// Simulation state and the animation state machine.
const active = buildFigure();
active.root.position.set(START.x, 0, START.z);
active.root.rotation.y = Math.PI; // face the court (north)
active.label = makeLabel();

const waiters = new Map(); // playerId -> figure
const sim = {
  poseName: 'idle',
  stance: 'idle',           // idle | oneleg | rest
  figureBox: 0,             // 0 means the start edge
  stoneBox: 0,
  stoneInHand: false,
  faceMode: false,
  currentPose: clonePose(P.idle),
  anim: null,               // { frames, dur, t, travel, name, onDone, flags }
  queue: [],
  tweens: [],               // stone flights and camera style one offs
  turnPlayerId: null,
  phase: 'throw',
  lastRoom: null,
  lastHopTarget: null,      // box the previous hop (in call order) landed in
  lastHopDir: 0             // travel direction of that hop, for pivot detection
};

function boxCentre(box) { const p = BOX_POS[box]; return new THREE.Vector3(p.x, 0, p.z); }

function enqueue(anim) { sim.queue.push(anim); pump(); }
function pump() {
  if (sim.anim || sim.queue.length === 0) return;
  sim.anim = sim.queue.shift();
  sim.anim.t = 0;
  sim.poseName = sim.anim.name;
  if (sim.anim.onStart) sim.anim.onStart(sim.anim);
}
function poseAt(anim, k) {
  const fr = anim.frames;
  if (k <= fr[0].t) return clonePose(fr[0].pose);
  for (let i = 1; i < fr.length; i++) {
    if (k <= fr[i].t) {
      const u = (k - fr[i - 1].t) / (fr[i].t - fr[i - 1].t);
      return lerpPose(fr[i - 1].pose, fr[i].pose, easeIO(u));
    }
  }
  return clonePose(fr[fr.length - 1].pose);
}
function finishAnim() {
  const a = sim.anim; sim.anim = null;
  sim.currentPose = clonePose(a.frames[a.frames.length - 1].pose);
  sim.poseName = sim.stance;
  if (a.onDone) a.onDone();
  pump();
  if (!sim.anim && sim.queue.length === 0) reconcile();
}
// If a turn ended while the figure was busy on the court, walk it home once free.
function reconcile() {
  const room = sim.lastRoom;
  if (!room || room.status !== 'playing') return;
  if (sim.anim || sim.queue.length) return;
  if (room.phase === 'throw' && sim.figureBox !== 0) walkToStart();
}

// Turn the figure toward a travel direction during the opening of an anim.
function faceAngle(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); }
function shortArc(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d; }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); }

function playAnim(name, dur, frames, travel, onDone, extra) {
  enqueue(Object.assign({ name, dur, frames, travel: travel || null, onDone, flags: {} }, extra || {}));
}

// A timed stone flight: parabola from a start point to a box, bounce,
// settle. Used by the house claim back throw only (regular throws fly
// power-true via flyStoneThrown). NOTE on units: the tick passes dt in
// seconds while dur is milliseconds, so accumulate dt * 1000. As shipped
// in v3 this line added raw seconds, which made the claim stone take
// about 12 minutes to land and wedged the resting stone logic behind
// the never-ending tween; the fix restores the authored timing only.
function flyStone(from, toBox, peak, dur, settleBox) {
  const target = boxCentre(toBox);
  target.x += (Math.random() - 0.5) * 0.2; target.z += (Math.random() - 0.5) * 0.2;
  const start = from.clone();
  sim.tweens.push({
    t: 0, dur, landed: false,
    update(dt, tw) {
      tw.t += dt * 1000;
      const k = Math.min(1, tw.t / tw.dur);
      if (!tw.landed) {
        stone.position.lerpVectors(start, new THREE.Vector3(target.x, 0.045, target.z), k);
        stone.position.y = 0.045 + Math.sin(k * Math.PI) * peak * (1 - k * 0.35);
        stone.rotation.x += dt * 7; stone.rotation.z += dt * 5;
        if (k >= 1) { tw.landed = true; tw.t = 0; tw.dur = 300; puffDust(target.x, target.z, 0.5); }
      } else {
        // Two shrinking bounces, then settle.
        const b = Math.abs(Math.sin(k * Math.PI * 2)) * 0.05 * (1 - k);
        stone.position.y = 0.045 + b;
        if (k >= 1) { stone.position.y = 0.045; sim.stoneBox = settleBox; return true; }
      }
      return false;
    }
  });
}
// Where a throw of the given power actually lands, measured from real Suwe
// footage: the seed is a gentle underhand lob and it lands true to the
// power. The landing point is the target box centre pushed along the throw
// direction (start edge to box centre) by an offset from the power's
// deviation d = power - 50: |d| up to 8 stays inside the box, hugging the
// edge more as |d| grows; |d| 8 to 15 lands ON the chalk line; beyond that
// it falls short of or sails past the box into the dirt. The spec's 0.475
// is the centre to edge distance of a box on an axial throw; here the true
// edge distance along the (slightly diagonal) throw line is computed from
// the box geometry so line landings sit on the visible chalk.
function throwLanding(targetBox, power) {
  const centre = boxCentre(targetBox);
  const dir = new THREE.Vector3(centre.x - START.x, 0, centre.z - START.z).normalize();
  const edge = Math.min(
    Math.abs(dir.x) > 1e-4 ? (BOXW / 2) / Math.abs(dir.x) : Infinity,
    Math.abs(dir.z) > 1e-4 ? (BOXW / 2) / Math.abs(dir.z) : Infinity
  );
  const d = power - 50, ad = Math.abs(d);
  let off;
  if (ad <= 15) {
    const base = ad <= 8 ? ad * (0.30 / 8) : 0.30 + (ad - 8) * (0.175 / 7);
    off = base * (edge / 0.475);
  } else {
    off = edge + (ad - 15) * 0.032;
  }
  off *= Math.sign(d);
  // Tiny deterministic sideways scatter, except on a line landing, where
  // the seed must sit squarely on the chalk.
  const isLine = ad > 8 && ad <= 15;
  const lat = isLine ? 0 : Math.sin(power * 12.9898) * 0.03;
  const land = centre.clone();
  land.x += dir.x * off - dir.z * lat;
  land.z += dir.z * off + dir.x * lat;
  land.y = 0;
  return { land, dir };
}

// The power-true stone flight for throws (the claim keeps flyStone). A low
// flat lob: release at the wrist, apex a little above release height,
// flight 0.42 to 0.72 s scaled by distance, and on dirt the seed STOPS
// DEAD, no bounce chain, no roll. Only a hard miss (|d| over 15) skids a
// few centimetres along the throw line as it stops.
function flyStoneThrown(from, targetBox, power, settleBox) {
  const { land, dir } = throwLanding(targetBox, power);
  const start = from.clone();
  const dist = Math.hypot(land.x - start.x, land.z - start.z);
  const apex = THREE.MathUtils.clamp(0.16 + dist * 0.11, 0.22, 0.55);
  const durMs = THREE.MathUtils.clamp(0.34 + dist * 0.11, 0.42, 0.72) * 1000;
  const skid = Math.abs(power - 50) > 15 ? 0.08 : 0;
  sim.tweens.push({
    t: 0, dur: durMs, landed: false,
    update(dt, tw) {
      tw.t += dt * 1000;
      if (!tw.landed) {
        const k = Math.min(1, tw.t / tw.dur);
        stone.position.x = start.x + (land.x - start.x) * k;
        stone.position.z = start.z + (land.z - start.z) * k;
        // Parabola whose crest sits exactly `apex` above the release height.
        const linY = start.y + (0.045 - start.y) * k;
        stone.position.y = linY + Math.sin(k * Math.PI) * (apex + Math.max(0, (start.y - 0.045) / 2));
        stone.rotation.x += dt * 6; stone.rotation.z += dt * 4;
        if (k >= 1) {
          stone.position.set(land.x, 0.045, land.z);
          puffDust(land.x, land.z, 0.55);
          if (!skid) { sim.stoneBox = settleBox; return true; }
          tw.landed = true; tw.t = 0; tw.dur = 150;
        }
        return false;
      }
      // Skid: continue along the throw line, decaying, then dead stop.
      const k = Math.min(1, tw.t / tw.dur);
      const e = 1 - Math.pow(1 - k, 2);
      stone.position.x = land.x + dir.x * skid * e;
      stone.position.z = land.z + dir.z * skid * e;
      stone.position.y = 0.045;
      if (k >= 1) { sim.stoneBox = settleBox; return true; }
      return false;
    }
  });
}
function wristWorld(fig) { const v = new THREE.Vector3(); if (fig.handR) fig.handR.getWorldPosition(v); else v.copy(fig.root.position).setY(1.1); return v; }
function headTopWorld(fig) { const v = new THREE.Vector3(); if (fig.head) fig.head.getWorldPosition(v); else v.copy(fig.root.position).setY(1.6); v.y += 0.24; return v; }

// --- Moves -----------------------------------------------------------------
function animThrow(targetBox, clean, power) {
  const p = (power === undefined || power === null || isNaN(power)) ? (clean ? 50 : 20) : power;
  const base = P.oneleg && sim.stance === 'oneleg' ? P.oneleg : P.idle;
  // Underhand drop-toss, the way the seed is really thrown in Suwe: a
  // shallow crouch (about half the old depth), the throwing arm hanging
  // down and slightly back, then sweeping LOW forward to about waist
  // height at the release frame. No overhead wind-up, small spine lean.
  // Arm z on the right swings the hanging arm: + is back, - is forward.
  const crouch = mergePose(base, { pelvisY: -0.035, spine: [0.14, 0, 0], chest: [0.05, 0, 0], head: [0.05, 0, 0], shR: [1.42, 0, 0.5], elR: [0.35, 0, 0], shL: [1.15, 0, -0.05], elL: [0.25, 0, 0], hipL: [0.18, 0, 0], kneeL: [-0.3, 0, 0], ankL: [0.12, 0, 0], hipR: [0.1, 0, 0], kneeR: [-0.26, 0, 0], ankR: [0.1, 0, 0] });
  const release = mergePose(base, { pelvisY: -0.015, spine: [0.07, -0.1, 0], chest: [0.02, -0.06, 0], head: [0.02, -0.08, 0], shR: [1.08, 0, -1.0], elR: [0.12, 0, 0], shL: [1.2, 0, 0.3], elL: [0.3, 0, 0] });
  const follow = mergePose(base, { pelvisY: -0.02, spine: [0.12, -0.04, 0], head: [0.03, -0.04, 0], shR: [0.95, 0, -0.55], elR: [0.3, 0, 0], shL: [1.25, 0, 0.15], elL: [0.3, 0, 0] });
  sim.stoneInHand = false;
  playAnim('throw', 980, [
    { t: 0, pose: clonePose(base) },
    { t: 0.2, pose: crouch },
    { t: 0.46, pose: release },
    { t: 0.72, pose: follow },
    { t: 1, pose: clonePose(base) }
  ], null, null, {
    onFrame(k, a) {
      if (k >= 0.46 && !a.flags.launched) {
        a.flags.launched = true;
        const from = wristWorld(active);
        flyStoneThrown(from, targetBox, p, clean ? targetBox : 0);
      }
    }
  });
}

function hopFrames(restLanding) {
  const base = P.oneleg;
  // Real Suwe hops are low and quick with the arms hanging at the sides:
  // no wide balance arms (that is the foul recovery only), the free leg
  // folded back, and a flat foot landing (ankle near neutral at contact).
  const crouch = mergePose(base, { pelvisY: -0.06, spine: [0.16, 0, 0], head: [0.06, 0, 0], shL: [1.15, 0, -0.2], elL: [0.25, 0, 0], shR: [1.15, 0, 0.2], elR: [0.25, 0, 0], hipL: [0.34, 0, 0], kneeL: [-0.58, 0, 0], ankL: [0.22, 0, 0] });
  const air = mergePose(base, { pelvisY: 0.01, spine: [0.05, 0, 0], head: [0.04, 0, 0], shL: [1.02, 0, -0.16], elL: [0.18, 0, 0], shR: [1.02, 0, 0.16], elR: [0.18, 0, 0], hipL: [-0.04, 0, 0], kneeL: [-0.05, 0, 0], ankL: [-0.42, 0, 0], hipR: [-0.62, 0, 0], kneeR: [-1.6, 0, 0], ankR: [-0.3, 0, 0] });
  const land = mergePose(base, { pelvisY: -0.07, spine: [0.2, 0, 0], head: [0.08, 0, 0], shL: [0.95, 0, -0.18], elL: [0.2, 0, 0], shR: [0.95, 0, 0.18], elR: [0.2, 0, 0], hipL: [0.34, 0, 0], kneeL: [-0.55, 0, 0], ankL: [0.04, 0, 0] });
  const settle = restLanding ? clonePose(P.rest) : mergePose(base, { pelvisY: -0.01, shL: [1.05, 0, -0.14], elL: [0.18, 0, 0], shR: [1.05, 0, 0.14], elR: [0.18, 0, 0] });
  return [
    { t: 0, pose: clonePose(sim.currentPose) },
    { t: 0.18, pose: crouch },
    { t: 0.45, pose: air },
    { t: 0.78, pose: land },
    { t: 1, pose: settle }
  ];
}
function animHopTo(box, restLanding, onDone) {
  const from = active.root.position.clone();
  const to = boxCentre(box);
  const fromRot = active.root.rotation.y;
  const toRot = shortArc(fromRot, faceAngle(from, to));
  // The box 7 turnaround: in real play the turn at the far box is a
  // STANDING PIVOT on two feet, never a hop spin. Detect it from the hop
  // geometry in call order (previous hop's landing box to this box): if
  // the new travel direction reverses the previous hop's direction by
  // more than about 120 degrees, first enqueue a half second pivot in
  // the rest pose, feet planted, rotating to the new facing. The snake
  // turns are 90 degrees (diagonals about 117) and never trigger it.
  let pivotFirst = false;
  if (sim.lastHopTarget) {
    const prevCentre = boxCentre(sim.lastHopTarget);
    const newDir = faceAngle(prevCentre, to);
    if (angDiff(newDir, sim.lastHopDir) > 2.09) pivotFirst = true;
    sim.lastHopDir = newDir;
  } else {
    sim.lastHopDir = faceAngle(new THREE.Vector3(START.x, 0, START.z), to);
  }
  sim.lastHopTarget = box;
  if (pivotFirst) {
    const pivotBent = mergePose(P.rest, { pelvisY: -0.05, hipL: [0.12, 0, 0], kneeL: [-0.24, 0, 0], hipR: [0.12, 0, 0], kneeR: [-0.24, 0, 0] });
    playAnim('pivot', 500, [
      { t: 0, pose: clonePose(P.rest) },
      { t: 0.5, pose: pivotBent },
      { t: 1, pose: clonePose(P.rest) }
    ], { from: from.clone(), to: from.clone(), peak: 0, fromRot, toRot, rotSpan: 0.92 }, null, {
      onStart(a) {
        // Plant the feet where the figure actually stands when the pivot
        // begins (queued hops can make call time positions stale), and
        // rotate to face along the coming hop.
        a.travel.from.copy(active.root.position);
        a.travel.to.copy(active.root.position);
        a.travel.fromRot = active.root.rotation.y;
        a.travel.toRot = shortArc(a.travel.fromRot, faceAngle(a.travel.from, to));
      }
    });
  }
  // One hop cycle is about 0.6 s with a low rise of about 0.18 units,
  // the fast, flat shuffle-hop of real Suwe.
  playAnim('hop', 600, hopFrames(restLanding), { from, to, peak: 0.18, fromRot, toRot }, () => {
    sim.figureBox = box;
    sim.stance = restLanding ? 'rest' : 'oneleg';
    if (restLanding) {
      // A beat of stillness in the rest box or a house, before any queued move.
      sim.queue.unshift({
        name: 'rest', dur: 540, t: 0, travel: null, flags: {},
        frames: [{ t: 0, pose: clonePose(P.rest) }, { t: 1, pose: clonePose(P.rest) }],
        onDone: null
      });
    }
    if (onDone) onDone();
  }, {
    onFrame(k, a) {
      if (k >= 0.78 && !a.flags.dusted) { a.flags.dusted = true; puffDust(to.x, to.z, 1); }
    },
    ...(pivotFirst ? {
      onStart(a) {
        // The pivot just turned the figure: start the hop from the true
        // position and facing instead of the stale call time values.
        a.travel.from.copy(active.root.position);
        a.travel.fromRot = active.root.rotation.y;
        a.travel.toRot = shortArc(a.travel.fromRot, faceAngle(a.travel.from, a.travel.to));
      }
    } : {})
  });
}

function animPickup(seedBox) {
  animHopTo(seedBox, false, () => {
    const base = P.oneleg;
    // The signature Suwe pickup, measured from footage: balance on ONE
    // leg, fold deep from the waist until the back is near horizontal
    // (spine 1.0 plus chest 0.5 sums to about 1.5 rad through the chain),
    // the free leg extended BACK AND UP toward horizontal as a
    // counterweight, the reaching arm down to the stone, the other arm
    // flung out to the side, and a real balance wobble on the way down.
    const bent = mergePose(base, { pelvisY: -0.06, spine: [1.0, 0, 0], chest: [0.5, 0, 0], head: [0.2, 0, 0], shR: [1.25, 0, -0.55], elR: [0.05, 0, 0], shL: [0.35, 0, -0.25], elL: [0.2, 0, 0], hipL: [0.18, 0, 0], kneeL: [-0.22, 0, 0], ankL: [0.05, 0, 0], hipR: [-1.35, 0, 0], kneeR: [-0.15, 0, 0], ankR: [-0.1, 0, 0] });
    const wobbleR = mergePose(bent, { spine: [1.0, 0, 0.06], shL: [0.2, 0, -0.25] });
    const wobbleL = mergePose(bent, { spine: [1.0, 0, -0.05], shL: [0.5, 0, -0.25] });
    const rising = mergePose(base, { pelvisY: -0.03, spine: [0.35, 0, 0], chest: [0.12, 0, 0], head: [0, 0, 0], shR: [0.75, 0, -0.3], elR: [0.45, 0, 0], shL: [0.9, 0, -0.15], hipL: [0.12, 0, 0], kneeL: [-0.2, 0, 0], ankL: [0.08, 0, 0], hipR: [-0.3, 0, 0], kneeR: [-0.9, 0, 0], ankR: [-0.2, 0, 0] });
    playAnim('pickup', 1000, [
      { t: 0, pose: clonePose(sim.currentPose) },
      { t: 0.42, pose: bent },
      { t: 0.58, pose: wobbleR },
      { t: 0.72, pose: wobbleL },
      { t: 0.84, pose: bent },
      { t: 1, pose: rising }
    ], null, () => {
      sim.stoneInHand = false;
      stone.visible = false;
      sim.stoneBox = 0;
      sim.stance = 'oneleg';
      setStance('oneleg', 200);
    }, {
      onFrame(k, a) { if (k >= 0.42 && !a.flags.grabbed) { a.flags.grabbed = true; sim.stoneInHand = true; stone.visible = true; } }
    });
  });
}

function animFoul() {
  sim.lastHopTarget = null; // the walk home breaks the hop chain
  const from = active.root.position.clone();
  const to = from.clone(); to.x += 0.3; to.z += 0.18;
  const base = sim.stance === 'rest' ? P.rest : (sim.stance === 'oneleg' ? P.oneleg : P.idle);
  const tilt = mergePose(base, { pelvisY: -0.03, pelvisZ: 0.2, spine: [0.1, 0, 0.3], chest: [0, 0, 0.12], head: [0, 0, 0.2], shL: [-1.9, 0, -0.3], elL: [0.15, 0, 0], shR: [-1.7, 0, 0.3], elR: [0.15, 0, 0], hipR: [0.04, 0, 0], kneeR: [-0.06, 0, 0], ankR: [0, 0, 0] });
  const stamp = mergePose(base, { pelvisY: -0.05, pelvisZ: 0.09, spine: [0.17, 0, 0.14], head: [0.04, 0, 0.08], shL: [0.4, 0, -0.55], elL: [0.25, 0, 0], shR: [0.55, 0, 0.5], elR: [0.25, 0, 0], hipL: [0.24, 0, 0], kneeL: [-0.38, 0, 0], hipR: [0.1, 0, 0], kneeR: [-0.14, 0, 0] });
  playAnim('foul', 1150, [
    { t: 0, pose: clonePose(sim.currentPose) },
    { t: 0.3, pose: tilt },
    { t: 0.48, pose: stamp },
    { t: 0.75, pose: stamp },
    { t: 1, pose: clonePose(P.idle) }
  ], { from, to, peak: 0.03, fromRot: active.root.rotation.y, toRot: active.root.rotation.y }, () => {
    sim.stance = 'idle';
    walkToStart();
  }, {
    onFrame(k, a) {
      // Windmilling arms while the balance goes: the arm x delta sweeps
      // the arms up and down in the frontal plane, opposite each other.
      if (k > 0.08 && k < 0.46) {
        const w = Math.sin(a.t * 0.045) * 1.25;
        sim.currentPose.shL[0] = -0.9 + w; sim.currentPose.shR[0] = -0.9 - w;
      }
      if (k >= 0.48 && !a.flags.dusted) { a.flags.dusted = true; puffDust(to.x, to.z, 1.2); }
    }
  });
}

function animClaim(box) {
  const startRot = active.root.rotation.y;
  const backRot = shortArc(startRot, 0); // face the camera, back to the board
  playAnim('claimturn', 520, [
    { t: 0, pose: clonePose(sim.currentPose) },
    { t: 1, pose: mergePose(P.idle, { pelvisY: 0.01 }) }
  ], { from: active.root.position.clone(), to: active.root.position.clone(), peak: 0.07, fromRot: startRot, toRot: backRot }, () => {
    const twist = mergePose(P.idle, { spine: [0.04, 0.45, 0], chest: [0, 0.3, 0], head: [0, 0.35, 0], shR: [-2.6, 0, 0.35], elR: [0.3, 0, 0], shL: [1.1, 0, -0.3], elL: [0.4, 0, 0] });
    const release = mergePose(P.idle, { spine: [0.1, -0.22, 0], chest: [0, -0.12, 0], head: [-0.06, -0.12, 0], shR: [-3.0, 0, -0.15], elR: [0.05, 0, 0], shL: [1.3, 0, 0.25], elL: [0.25, 0, 0] });
    playAnim('claim', 900, [
      { t: 0, pose: clonePose(sim.currentPose) },
      { t: 0.4, pose: twist },
      { t: 0.58, pose: release },
      { t: 1, pose: clonePose(P.idle) }
    ], null, () => {
      const cur = active.root.rotation.y;
      playAnim('claimturn', 460, [
        { t: 0, pose: clonePose(sim.currentPose) },
        { t: 1, pose: clonePose(P.idle) }
      ], { from: active.root.position.clone(), to: active.root.position.clone(), peak: 0.05, fromRot: cur, toRot: shortArc(cur, Math.PI) }, () => { sim.stance = 'idle'; });
    }, {
      onFrame(k, a) {
        if (k >= 0.58 && !a.flags.launched) {
          a.flags.launched = true;
          flyStone(wristWorld(active), box || 3, 1.15, 720, box || 0);
        }
      }
    });
  });
}

function walkToStart(onDone) {
  sim.lastHopTarget = null; // the walk home breaks the hop chain
  const from = active.root.position.clone();
  const to = new THREE.Vector3(START.x, 0, START.z);
  const dist = from.distanceTo(to);
  if (dist < 0.05) { sim.figureBox = 0; if (onDone) onDone(); return; }
  const dur = Math.max(380, dist * 420);
  playAnim('walk', dur, [
    { t: 0, pose: clonePose(P.idle) },
    { t: 1, pose: clonePose(P.idle) }
  ], { from, to, peak: 0, fromRot: active.root.rotation.y, toRot: shortArc(active.root.rotation.y, faceAngle(from, to)), walk: true }, () => {
    sim.figureBox = 0;
    // Turn back to face the court.
    const cur = active.root.rotation.y;
    playAnim('claimturn', 380, [{ t: 0, pose: clonePose(P.idle) }, { t: 1, pose: clonePose(P.idle) }],
      { from: to.clone(), to: to.clone(), peak: 0.04, fromRot: cur, toRot: shortArc(cur, Math.PI) },
      () => { sim.stance = 'idle'; setStance('idle', 150); if (onDone) onDone(); });
  });
}

function setStance(name, dur) {
  if (sim.anim) return;
  const target = name === 'rest' ? P.rest : name === 'oneleg' ? P.oneleg : P.idle;
  sim.stance = name;
  playAnim('stance', dur || 260, [
    { t: 0, pose: clonePose(sim.currentPose) },
    { t: 1, pose: clonePose(target) }
  ], null, null);
}

// --- Room sync ---------------------------------------------------------------
function setActiveIdentity(player) {
  if (!player) return;
  // Identity is carried by the name label and the court side, never by
  // tinting the textured human model.
  active.name = player.name;
  active.label.textContent = player.name;
  active.label.style.borderColor = player.color;
  active.label.style.color = player.color;
}
function ensureWaiters(room, turnId) {
  const others = room.players.filter((p) => p.id !== turnId);
  const seen = new Set();
  others.forEach((p, i) => {
    seen.add(p.id);
    let fig = waiters.get(p.id);
    if (!fig) {
      fig = buildFigure();
      fig.label = makeLabel();
      waiters.set(p.id, fig);
    }
    fig.name = p.name;
    fig.label.textContent = p.name + (p.connected ? '' : ' (away)');
    fig.label.style.borderColor = p.color;
    fig.label.style.color = p.color;
    fig.root.position.set(1.42, 0, -0.55 - i * 0.85);
    fig.root.rotation.y = -Math.PI / 2; // face the court
    fig.root.visible = true;
    applyPose(fig, P.idle);
  });
  for (const [id, fig] of waiters) {
    if (!seen.has(id)) { fig.root.visible = false; fig.label.style.display = 'none'; }
    else fig.label.style.display = '';
  }
}

const Sim3D = {
  setRoom(room, myId) {
    sim.lastRoom = room;
    sim.phase = room.phase;
    const turnP = room.players.find((p) => p.id === room.turnPlayerId);
    const turnChanged = sim.turnPlayerId !== room.turnPlayerId;
    sim.turnPlayerId = room.turnPlayerId;
    if (turnP) setActiveIdentity(turnP);
    ensureWaiters(room, room.turnPlayerId);
    // Houses.
    for (let b = 1; b <= 6; b++) {
      const ownerId = room.houses ? room.houses[b] : null;
      const owner = ownerId ? room.players.find((p) => p.id === ownerId) : null;
      drawHouse(b, owner);
    }
    // Next box highlight while hopping.
    if (room.status === 'playing' && room.phase === 'hop' && room.sequence && room.seqIndex < room.sequence.length) {
      const nb = room.sequence[room.seqIndex];
      highlight.position.set(BOX_POS[nb].x, 0.01, BOX_POS[nb].z);
      const w = nb === 7 ? COURT_W + 0.08 : BOXW + 0.1;
      highlight.scale.set(w / (BOXW + 0.1), 1, 1);
      highlight.visible = true;
    } else highlight.visible = false;
    // Stone resting spot when nothing is flying.
    const flying = sim.tweens.length > 0;
    if (!flying && !sim.stoneInHand) {
      if (room.status === 'playing' && room.phase === 'hop' && room.seedBox) {
        stone.visible = true;
        const c = boxCentre(room.seedBox);
        stone.position.set(c.x + 0.26, 0.045, c.z + 0.24);
        sim.stoneBox = room.seedBox;
      } else if (room.status === 'playing') {
        stone.visible = true;
        stone.position.set(START.x + 0.3, 0.045, START.z - 0.15);
        if (sim.stoneBox !== 0 && room.phase !== 'house') sim.stoneBox = 0;
      }
    }
    // A new turn with the figure stranded on the court: walk it home.
    if (turnChanged && room.status === 'playing' && !sim.anim && sim.queue.length === 0 && sim.figureBox !== 0) {
      walkToStart();
    }
    // Keep the stance honest when idle.
    if (!sim.anim && sim.queue.length === 0 && room.status === 'playing') {
      if (room.phase === 'hop' && sim.figureBox !== 0) {
        const want = (sim.figureBox === 7 || (room.houses && room.houses[sim.figureBox] === room.turnPlayerId)) ? 'rest' : 'oneleg';
        if (sim.stance !== want) setStance(want, 240);
      } else if (room.phase !== 'hop' && sim.stance !== 'idle' && sim.figureBox === 0) setStance('idle', 240);
    }
    reconcile();
  },
  playThrow(box, power) { animThrow(box, true, power); },
  playThrowFoul(box, power) { animThrow(box || 1, false, power); animFoul(); },
  playHop(box, rest) { animHopTo(box, !!rest, null); },
  playPickup(box) { animPickup(box); },
  playFoul() { animFoul(); },
  playClaim(box) { animClaim(box); },
  resetToStart() { sim.queue.length = 0; walkToStart(); },
  syncStone() { /* resting position handled in setRoom */ }
};
window.Sim3D = Sim3D;

// Test hook: pose, figure box and stone box, readable from any test page.
window.__lakalakaSim = {
  pose() { return sim.poseName; },
  figureBox() { return sim.figureBox; },
  stoneBox() { return sim.stoneBox; },
  figureY() { return active.root.position.y + 0.92; },
  humanLoaded() { return !!active.loaded; },
  faceCam(on) { sim.faceMode = !!on; },
  webgl: true,
  boxScreen(box) {
    const v = boxCentre(box); v.y = 0.05;
    v.project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  },
  tapBox(box) { if (window.LakalakaTap) window.LakalakaTap(box); },
  waiterScreen() {
    const out = [];
    for (const fig of waiters.values()) {
      if (!fig.root.visible) continue;
      const v = fig.root.position.clone(); v.y = 0.9;
      v.project(camera);
      const r = canvas.getBoundingClientRect();
      out.push({ name: fig.name, x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, nx: v.x, ny: v.y });
    }
    return out;
  }
};

// --- Input: raycast taps on the 3D boxes ------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = 0;
canvas.addEventListener('pointerdown', () => { downAt = Date.now(); });
canvas.addEventListener('pointerup', (ev) => {
  if (Date.now() - downAt > 450) return;
  const r = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(hitPlanes, false);
  if (hits.length && window.LakalakaTap) window.LakalakaTap(hits[0].object.userData.box);
});

// --- Labels -------------------------------------------------------------------
const projV = new THREE.Vector3();
function placeLabel(fig, worldPos) {
  if (!fig.label) return;
  projV.copy(worldPos); projV.y += 0.32;
  projV.project(camera);
  if (projV.z > 1) { fig.label.style.display = 'none'; return; }
  if (fig.root.visible === false) { fig.label.style.display = 'none'; return; }
  fig.label.style.display = '';
  const r = container.getBoundingClientRect();
  const x = Math.max(42, Math.min(r.width - 42, (projV.x * 0.5 + 0.5) * r.width));
  const y = (-projV.y * 0.5 + 0.5) * r.height;
  fig.label.style.transform = 'translate(-50%, -100%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
}

// --- Main loop ------------------------------------------------------------------
let lastNow = performance.now();
const headWorld = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.12, (now - lastNow) / 1000);
  lastNow = now;
  const t = now;

  // Animation state machine.
  if (sim.anim) {
    const a = sim.anim;
    a.t += dt * 1000;
    const k = Math.min(1, a.t / a.dur);
    sim.currentPose = poseAt(a, k);
    if (a.travel) {
      const u = easeIO(Math.min(1, Math.max(0, (k - 0.02) / 0.96)));
      active.root.position.lerpVectors(a.travel.from, a.travel.to, u);
      let y = 0;
      if (a.travel.walk) y = Math.abs(Math.sin(k * Math.PI * 5)) * 0.035;
      else if (a.travel.peak) {
        const airK = THREE.MathUtils.clamp((k - 0.16) / 0.66, 0, 1);
        y = Math.sin(airK * Math.PI) * a.travel.peak * (k > 0.16 && k < 0.84 ? 1 : 0);
        if (a.name === 'hop') sim.poseName = y > 0.07 ? 'hop-air' : 'hop';
      }
      active.root.position.y = y;
      if (a.travel.fromRot !== undefined) {
        const rk = easeIO(Math.min(1, k / (a.travel.rotSpan || 0.3)));
        active.root.rotation.y = a.travel.fromRot + (a.travel.toRot - a.travel.fromRot) * rk;
      }
      if (a.travel.walk) {
        const sw = Math.sin(k * Math.PI * 5) * 0.4;
        sim.currentPose.hipL[0] += sw; sim.currentPose.kneeL[0] -= Math.max(0, -sw) * 0.7;
        sim.currentPose.hipR[0] -= sw; sim.currentPose.kneeR[0] -= Math.max(0, sw) * 0.7;
        // Arms hang down while walking, so they swing forward and back
        // through the shoulder z delta, opposite to the legs.
        sim.currentPose.shL[2] += sw * 0.45; sim.currentPose.shR[2] -= sw * 0.45;
      }
    }
    if (a.onFrame) a.onFrame(k, a);
    applyPose(active, sim.currentPose);
    if (k >= 1) finishAnim();
  } else {
    // Breathing and weight shift on the stance pose.
    const base = sim.stance === 'rest' ? P.rest : sim.stance === 'oneleg' ? P.oneleg : P.idle;
    const pose = clonePose(base);
    pose.spine[0] += Math.sin(t / 620) * 0.012;
    pose.pelvisZ += Math.sin(t / 2400) * 0.014;
    pose.shL[0] += Math.sin(t / 900) * 0.02;
    pose.shR[0] += Math.sin(t / 900 + 1) * 0.02;
    sim.currentPose = pose;
    applyPose(active, pose);
  }

  // Waiting figures breathe too: idle pose with a spine wobble.
  for (const fig of waiters.values()) {
    if (!fig.root.visible || !fig.bones) continue;
    const wp = clonePose(P.idle);
    wp.spine[0] += Math.sin(t / 720 + fig.root.position.z * 2) * 0.014;
    applyPose(fig, wp);
  }

  // Stone in hand follows the wrist.
  if (sim.stoneInHand) {
    const w = wristWorld(active);
    stone.position.copy(w);
  }
  // Stone flights and other tweens.
  for (let i = sim.tweens.length - 1; i >= 0; i--) {
    if (sim.tweens[i].update(dt, sim.tweens[i])) sim.tweens.splice(i, 1);
  }
  // Dust.
  for (const d of dustPool) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.s.visible = false; d.s.material.opacity = 0; continue; }
    const u = 1 - d.life / d.max;
    d.s.position.addScaledVector(d.vel, dt);
    d.s.position.y += dt * 0.12;
    d.s.scale.setScalar(d.s.scale.x + dt * 0.55);
    d.s.material.opacity = 0.5 * (1 - u);
  }
  // Highlight pulse.
  if (highlight.visible) highlight.material.opacity = 0.65 + Math.sin(t / 240) * 0.3;
  // Camera gently follows the figure north and settles back.
  const fig = active.root.position;
  if (sim.faceMode && active.head) {
    // Close portrait shot for judging the human look: stand off the
    // figure's face along her facing direction, with the fill light on.
    active.head.getWorldPosition(headWorld);
    const fx = Math.sin(active.root.rotation.y), fz = Math.cos(active.root.rotation.y);
    camera.position.set(headWorld.x + fx * 0.85, headWorld.y + 0.06, headWorld.z + fz * 0.85);
    camera.lookAt(headWorld.x, headWorld.y - 0.02, headWorld.z);
    faceFill.visible = true;
    faceFill.position.copy(camera.position);
  } else {
    faceFill.visible = false;
    if (sim.faceWas) {
      // Leaving the portrait shot: snap straight back to the follow
      // position instead of drifting home through the figure's hair.
      camera.position.set(camBase.x + fig.x * 0.14, camBase.y, camBase.z + fig.z * 0.1);
    }
    camera.position.x += ((camBase.x + fig.x * 0.14) - camera.position.x) * 0.04;
    camera.position.y += ((camBase.y) - camera.position.y) * 0.04;
    camera.position.z += ((camBase.z + fig.z * 0.1) - camera.position.z) * 0.04;
    const look = new THREE.Vector3(camTargetBase.x + fig.x * 0.3, camTargetBase.y, camTargetBase.z + fig.z * 0.42);
    camera.lookAt(look);
  }
  sim.faceWas = !!(sim.faceMode && active.head);

  // Labels.
  if (active.head) active.head.getWorldPosition(headWorld); else headWorld.copy(active.root.position).setY(1.8);
  placeLabel(active, headWorld);
  for (const fig of waiters.values()) {
    if (fig.head) fig.head.getWorldPosition(headWorld); else headWorld.copy(fig.root.position).setY(1.8);
    placeLabel(fig, headWorld);
  }

  renderer.render(scene, camera);
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();
tick();
