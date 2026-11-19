import * as THREE from './lib/three.module.js';

// ---------- 定番サイズ(cm・目安) ----------
const PRESETS = [
  { name: 'デスク', w: 120, d: 60, h: 72 },
  { name: 'シングルベッド', w: 100, d: 200, h: 45 },
  { name: 'セミダブル', w: 120, d: 200, h: 45 },
  { name: 'ダブルベッド', w: 140, d: 200, h: 45 },
  { name: '2人掛けソファ', w: 160, d: 85, h: 80 },
  { name: '3人掛けソファ', w: 200, d: 90, h: 80 },
  { name: 'ダイニングテーブル', w: 140, d: 80, h: 72 },
  { name: '本棚', w: 90, d: 30, h: 180 },
  { name: 'テレビ台', w: 150, d: 40, h: 45 },
  { name: '冷蔵庫', w: 60, d: 70, h: 180 },
  { name: '洗濯機', w: 60, d: 60, h: 100 },
  { name: 'カラーボックス', w: 42, d: 29, h: 88 },
];
const COLORS = ['#f5b83d', '#4da3ff', '#5fd38a', '#ff7a7a', '#c9a0ff'];
const LIMIT = { min: 5, max: 400 };

// ---------- 状態 ----------
const cur = { name: PRESETS[0].name, w: PRESETS[0].w, d: PRESETS[0].d, h: PRESETS[0].h, color: COLORS[0] };
const items = [];          // 置いた家具(THREE.Group)
let selected = null;
let session = null, refSpace = null, hitSource = null;
let reticleOk = false;
let drag = null;           // { source, item, ox, oz }
let twist = null;          // 2本指回転の直前の角度
let lastMultiTouch = 0;

const $ = (id) => document.getElementById(id);
const overlay = $('overlay'), statusEl = $('status'), placeBtn = $('placeBtn');

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 3, 2);
scene.add(sun);

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 置き場所を示す枠(家具の底面と同じ大きさ)
const reticle = new THREE.Group();
reticle.visible = false;
const footprint = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5)]),
  new THREE.LineBasicMaterial({ color: 0xffffff }));
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.04, 0.055, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff }));
reticle.add(footprint, ring);
scene.add(reticle);

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitEdges = new THREE.EdgesGeometry(unitBox);

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.56, 0.14, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function drawLabel(sprite, d) {
  const c = sprite.material.map.image, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(15,17,20,0.82)';
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, 28); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 38px system-ui, sans-serif';
  g.fillText(d.name, c.width / 2, 40, c.width - 30);
  g.font = '500 34px system-ui, sans-serif';
  g.fillText(`${d.w} × ${d.d} × ${d.h} cm`, c.width / 2, 92, c.width - 30);
  sprite.material.map.needsUpdate = true;
}

function makeItem(d) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.6 }));
  const edges = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xffffff }));
  const label = makeLabel();
  g.add(mesh, edges, label);
  g.userData = { d: { ...d }, mesh, edges, label };
  mesh.userData.item = g;
  applyDims(g);
  return g;
}

function applyDims(g) {
  const { d, mesh, edges, label } = g.userData;
  const w = d.w / 100, dp = d.d / 100, h = d.h / 100;
  mesh.scale.set(w, h, dp); mesh.position.y = h / 2;
  edges.scale.copy(mesh.scale); edges.position.y = h / 2;
  label.position.y = h + 0.12;
  mesh.material.color.set(d.color);
  drawLabel(label, d);
}

function updateFootprint() {
  footprint.scale.set(cur.w / 100, 1, cur.d / 100);
}

function select(item) {
  if (selected) selected.userData.edges.material.color.set(0xffffff);
  selected = item;
  if (item) {
    item.userData.edges.material.color.set(0xffe14d);
    Object.assign(cur, item.userData.d);
  }
  refreshUI();
}

// ---------- 画面 ----------
function refreshUI() {
  $('o_w').textContent = cur.w; $('o_d').textContent = cur.d; $('o_h').textContent = cur.h;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.textContent === cur.name));
  document.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.c === cur.color));
  $('selRow').classList.toggle('on', !!selected);
  if (selected) $('selName').textContent = `選択中:${cur.name} ${cur.w}×${cur.d}×${cur.h}cm`;
  updateFootprint();
}

// 今の設定を、選択中の家具があればそれにも反映する
function pushToSelected() {
  if (selected) { Object.assign(selected.userData.d, cur); applyDims(selected); }
  refreshUI();
}

PRESETS.forEach((p) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = p.name;
  b.onclick = () => { Object.assign(cur, { name: p.name, w: p.w, d: p.d, h: p.h }); pushToSelected(); };
  $('presets').appendChild(b);
});
COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'sw'; b.dataset.c = c; b.style.background = c; b.setAttribute('aria-label', '色');
  b.onclick = () => { cur.color = c; pushToSelected(); };
  $('colors').appendChild(b);
});
document.querySelectorAll('#dims button').forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.k;
    cur[k] = Math.min(LIMIT.max, Math.max(LIMIT.min, cur[k] + Number(b.dataset.d)));
    pushToSelected();
  };
});
$('rotL').onclick = () => { if (selected) selected.rotation.y += Math.PI / 12; };
$('rotR').onclick = () => { if (selected) selected.rotation.y -= Math.PI / 12; };
$('delBtn').onclick = () => {
  if (!selected) return;
  const it = selected;
  select(null);
  scene.remove(it);
  items.splice(items.indexOf(it), 1);
  it.userData.mesh.material.dispose();
  it.userData.label.material.map.dispose();
};
$('toggle').onclick = () => {
  const min = $('sheet').classList.toggle('min');
  $('toggle').textContent = min ? '▲ パネルをひらく' : '▼ パネルをたたむ';
};
placeBtn.onclick = () => {
  if (!reticleOk) return;
  const it = makeItem(cur);
  it.position.copy(reticle.position);
  it.rotation.y = reticle.rotation.y;
  scene.add(it); items.push(it);
  select(it);
};
$('exitBtn').onclick = () => session && session.end();

// パネル上のタッチは、AR側の「画面タップ」として扱わせない
['top', 'sheet'].forEach((id) => $(id).addEventListener('beforexrselect', (e) => e.preventDefault()));

// 2本指でひねって回転
function touchAngle(t) {
  return Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);
}
overlay.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) { twist = touchAngle(e.touches); drag = null; lastMultiTouch = performance.now(); }
}, { passive: true });
overlay.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2 || twist === null) return;
  lastMultiTouch = performance.now();
  const a = touchAngle(e.touches);
  let delta = a - twist;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  twist = a;
  if (selected) selected.rotation.y -= delta;
}, { passive: true });
const endTwist = (e) => { if (e.touches.length < 2) twist = null; };
overlay.addEventListener('touchend', endTwist, { passive: true });
overlay.addEventListener('touchcancel', endTwist, { passive: true });

// ---------- ARの入力(1本指:選択と移動) ----------
const raycaster = new THREE.Raycaster();
const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _m = new THREE.Matrix4();

function rayOf(frame, source) {
  const pose = frame.getPose(source.targetRaySpace, refSpace);
  if (!pose) return false;
  _m.fromArray(pose.transform.matrix);
  _o.setFromMatrixPosition(_m);
  _dir.set(0, 0, -1).transformDirection(_m);
  return true;
}

// 指の先が、高さyの水平面と交わる点
function floorPoint(y, out) {
  if (_dir.y > -0.02) return false;        // 上向き・ほぼ水平は無視
  const t = (y - _o.y) / _dir.y;
  if (t <= 0 || t > 12) return false;
  out.set(_o.x + _dir.x * t, y, _o.z + _dir.z * t);
  return true;
}

const _p = new THREE.Vector3();
function onSelectStart(e) {
  if (twist !== null || !rayOf(e.frame, e.inputSource)) return;
  raycaster.set(_o, _dir);
  const hit = raycaster.intersectObjects(items.map((i) => i.userData.mesh), false)[0];
  if (!hit) return;
  const it = hit.object.userData.item;
  select(it);
  if (floorPoint(it.position.y, _p)) {
    drag = { source: e.inputSource, item: it, ox: it.position.x - _p.x, oz: it.position.z - _p.z };
  }
}
function onSelectEnd(e) {
  if (drag && drag.source === e.inputSource) drag = null;
}
function onSelect(e) {
  // 何もない所をタップしたら選択を外す(2本指操作の直後は除く)
  if (performance.now() - lastMultiTouch < 500) return;
  if (!rayOf(e.frame, e.inputSource)) return;
  raycaster.set(_o, _dir);
  if (!raycaster.intersectObjects(items.map((i) => i.userData.mesh), false).length) select(null);
}

// ---------- ARの開始と終了 ----------
async function startAR() {
  $('startBtn').disabled = true;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'dom-overlay'],
      domOverlay: { root: overlay },
    });
  } catch (err) {
    $('startBtn').disabled = false;
    setCompat(`ARを開始できませんでした。カメラの許可と、「Google Play 開発者サービス(AR)」が入っているかをご確認ください。(${err.name})`, false);
    return;
  }
  await renderer.xr.setSession(session);
  refSpace = renderer.xr.getReferenceSpace();
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });

  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('selectend', onSelectEnd);
  session.addEventListener('select', onSelect);
  session.addEventListener('end', onEnd);

  $('intro').style.display = 'none';
  overlay.classList.add('on');
  refreshUI();
}

function onEnd() {
  if (hitSource) hitSource.cancel();
  session = null; hitSource = null; refSpace = null; drag = null; twist = null;
  reticle.visible = false; reticleOk = false; placeBtn.disabled = true;
  select(null);
  items.splice(0).forEach((it) => scene.remove(it));
  overlay.classList.remove('on');
  $('intro').style.display = '';
  $('startBtn').disabled = false;
}

// ---------- 毎フレーム ----------
renderer.setAnimationLoop((time, frame) => {
  if (frame && session) {
    if (!refSpace) refSpace = renderer.xr.getReferenceSpace();
    if (hitSource && refSpace) {
      const pose = frame.getHitTestResults(hitSource)[0]?.getPose(refSpace);
      const viewer = frame.getViewerPose(refSpace);
      if (pose && viewer) {
        reticle.position.copy(pose.transform.position);
        // 家具の正面が自分の方を向くようにする
        _m.fromArray(viewer.transform.matrix);
        _dir.set(0, 0, -1).transformDirection(_m);
        reticle.rotation.y = Math.atan2(-_dir.x, -_dir.z);
      }
      const ok = !!(pose && viewer);
      if (ok !== reticleOk) {
        reticleOk = ok;
        placeBtn.disabled = !ok;
        statusEl.textContent = ok
          ? '枠の位置に置けます。置いた箱は、なぞって移動・2本指で回転'
          : '床にスマホを向けて、ゆっくり動かしてください';
      }
      reticle.visible = ok && !drag;
    }
    if (drag && refSpace && rayOf(frame, drag.source) && floorPoint(drag.item.position.y, _p)) {
      drag.item.position.x = _p.x + drag.ox;
      drag.item.position.z = _p.z + drag.oz;
    }
  }
  renderer.render(scene, camera);
});

// ---------- 対応確認 ----------
function setCompat(text, ok) {
  $('compat').textContent = text;
  $('compat').classList.toggle('ng', !ok);
}
(async () => {
  refreshUI();
  if (!window.isSecureContext || !navigator.xr) {
    setCompat('このブラウザはARに対応していません。AndroidのChromeで開いてください。', false);
    return;
  }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) {
    setCompat('この端末ではARを利用できません。AndroidのChromeで開き、「Google Play 開発者サービス(AR)」が入っているかをご確認ください。', false);
    return;
  }
  setCompat('この端末はARに対応しています。', true);
  $('startBtn').disabled = false;
  $('startBtn').onclick = startAR;
})();
