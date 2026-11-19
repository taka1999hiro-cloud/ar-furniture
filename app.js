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
const images = [];         // 取り込んだ画像 { id, name, canvas, tex, aspect, flat }
let imgSeq = 0;
const cur = { kind: 'box', img: null, flat: false, solid: false, lift: 0, name: PRESETS[0].name, w: PRESETS[0].w, d: PRESETS[0].d, h: PRESETS[0].h, color: COLORS[0] };
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
const unitPlane = new THREE.PlaneGeometry(1, 1);
const planeEdges = new THREE.EdgesGeometry(unitPlane);
const isStanding = (d) => d.kind === 'img' && !d.flat && !d.solid;

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
  const size = d.kind !== 'img' || d.solid ? `${d.w} × ${d.d} × ${d.h} cm` : d.flat ? `${d.w} × ${d.d} cm` : `${d.w} × ${d.h} cm`;
  g.fillText(size, c.width / 2, 92, c.width - 30);
  sprite.material.map.needsUpdate = true;
}

function makeItem(d) {
  const g = new THREE.Group();
  const isImg = d.kind === 'img';
  let mesh;
  if (isImg && d.solid) {
    // 写真を正面に貼った箱。面の並びは 右・左・上・下・正面・背面
    const mats = [0, 1, 2, 3, 4, 5].map((i) => (i === 4 ? new THREE.MeshBasicMaterial() : new THREE.MeshLambertMaterial()));
    mesh = new THREE.Mesh(unitBox, mats);
  } else if (isImg) {
    mesh = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }));
  } else {
    mesh = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.6 }));
  }
  const edges = new THREE.LineSegments(isImg && !d.solid ? planeEdges : unitEdges, new THREE.LineBasicMaterial({ color: 0xffffff }));
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
  if (d.kind === 'img') {
    const im = images.find((x) => x.id === d.img);
    if (d.solid) {                      // 写真を貼った箱
      if (im) mesh.material.forEach((m, i) => {
        if (i === 4) { if (m.map !== im.tex) { m.map = im.tex; m.needsUpdate = true; } } else m.color.set(im.avg);
      });
      mesh.rotation.x = 0; mesh.scale.set(w, h, dp); mesh.position.y = h / 2;
      label.position.y = h + 0.12;
    } else if (im && mesh.material.map !== im.tex) { mesh.material.map = im.tex; mesh.material.needsUpdate = true; }
    if (d.solid) {
      // 上で設定済み
    } else if (d.flat) {                       // 床に敷く(ラグなど)
      mesh.rotation.x = -Math.PI / 2; mesh.scale.set(w, dp, 1); mesh.position.y = 0.004;
      label.position.y = 0.25;
    } else {                            // 立てる(カーテン・ポスターなど)
      const lift = d.lift / 100;
      mesh.rotation.x = 0; mesh.scale.set(w, h, 1); mesh.position.y = lift + h / 2;
      label.position.y = lift + h + 0.12;
    }
    // 画像は雰囲気を見るものなので、枠と寸法は選択中だけ出す
    edges.visible = label.visible = (g === selected);
  } else {
    mesh.scale.set(w, h, dp); mesh.position.y = h / 2;
    label.position.y = h + 0.12;
    mesh.material.color.set(d.color);
  }
  edges.rotation.copy(mesh.rotation); edges.scale.copy(mesh.scale); edges.position.copy(mesh.position);
  drawLabel(label, d);
}

function updateFootprint() {
  footprint.scale.set(cur.w / 100, 1, (isStanding(cur) ? 2 : cur.d) / 100);
}

function select(item) {
  const prev = selected;
  selected = item;
  if (prev) {
    prev.userData.edges.material.color.set(0xffffff);
    if (prev.userData.d.kind === 'img') prev.userData.edges.visible = prev.userData.label.visible = false;
  }
  if (item) {
    item.userData.edges.material.color.set(0xffe14d);
    item.userData.edges.visible = item.userData.label.visible = true;
    Object.assign(cur, item.userData.d);
  }
  refreshUI();
}

// ---------- 画面 ----------
// 寸法欄の3つの枠が、今どの値を指すか
function slots() {
  if (cur.kind !== 'img' || cur.solid) return [['w', '幅 cm'], ['d', '奥行 cm'], ['h', '高さ cm']];
  return cur.flat ? [['w', '幅 cm'], ['d', '奥行 cm'], null] : [['w', '幅 cm'], ['h', '高さ cm'], ['lift', '床から cm']];
}
const curKey = () => (cur.kind === 'img' ? 'i:' + cur.img : 'p:' + cur.name);

function refreshUI() {
  slots().forEach((sl, i) => {
    $('dim' + i).style.visibility = sl ? '' : 'hidden';
    if (sl) { $('l' + i).textContent = sl[1]; $('o' + i).textContent = cur[sl[0]]; }
  });
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.key === curKey()));
  document.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.c === cur.color));
  $('colors').style.visibility = cur.kind === 'img' ? 'hidden' : '';
  $('selRow').classList.toggle('on', !!selected);
  if (selected) $('selName').textContent = '選択中:' + cur.name;
  updateFootprint();
}

// 今の設定を、選択中の家具があればそれにも反映する
function pushToSelected() {
  if (selected) { Object.assign(selected.userData.d, cur); applyDims(selected); }
  refreshUI();
}

const snap5 = (v) => Math.min(LIMIT.max, Math.max(LIMIT.min, Math.round(v / 5) * 5));

function pickImage(im) {
  const sd = selected && selected.userData.d;
  if (sd && (sd.kind !== 'img' || sd.solid !== im.solid)) select(null);
  const w = im.flat ? 140 : 100, other = snap5(w / im.aspect);
  Object.assign(cur, { kind: 'img', img: im.id, flat: im.flat, solid: im.solid, name: im.name, w, lift: 0 },
    im.solid ? { h: other, d: 40 } : im.flat ? { d: other } : { h: other });
  pushToSelected();
}
function pickPreset(p) {
  if (selected && selected.userData.d.kind === 'img') select(null);
  Object.assign(cur, { kind: 'box', img: null, flat: false, solid: false, lift: 0, name: p.name, w: p.w, d: p.d, h: p.h });
  pushToSelected();
}
function rebuildChips() {
  const box = $('presets');
  box.textContent = '';
  const add = (key, text, fn) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.key = key; b.textContent = text; b.onclick = fn;
    box.appendChild(b);
  };
  images.forEach((im) => add('i:' + im.id, '🖼 ' + im.name, () => pickImage(im)));
  PRESETS.forEach((p) => add('p:' + p.name, p.name, () => pickPreset(p)));
  refreshUI();
}

// 画像の取り込み(ARを始める前の画面)
function renderImgList() {
  const list = $('imgList');
  list.textContent = '';
  images.forEach((im) => {
    const row = document.createElement('div'); row.className = 'imgRow';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = im.name;
    const mode = document.createElement('button');
    mode.textContent = im.solid ? '立体(箱)' : im.flat ? '床に敷く' : '立てる';
    mode.onclick = () => {
      // 立てる → 床に敷く → 立体(箱) の順に切り替え
      if (im.solid) { im.solid = false; } else if (im.flat) { im.flat = false; im.solid = true; } else { im.flat = true; } if (cur.kind === 'img' && cur.img === im.id) pickImage(im); renderImgList(); };
    const del = document.createElement('button'); del.textContent = '削除';
    del.onclick = () => {
      images.splice(images.indexOf(im), 1); im.tex.dispose();
      if (cur.kind === 'img' && cur.img === im.id) pickPreset(PRESETS[0]);
      renderImgList(); rebuildChips();
    };
    row.append(im.canvas, nm, mode, del);
    list.appendChild(row);
  });
}
$('imgInput').onchange = async (e) => {
  for (const f of e.target.files) {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // 側面に使う、写真全体の平均色
    const sc = document.createElement('canvas'); sc.width = sc.height = 8;
    const sg = sc.getContext('2d'); sg.drawImage(c, 0, 0, 8, 8);
    const px = sg.getImageData(0, 0, 8, 8).data;
    let r = 0, g2 = 0, b2 = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 32) continue; r += px[i]; g2 += px[i + 1]; b2 += px[i + 2]; n++; }
    const avg = n ? `rgb(${Math.round(r / n)},${Math.round(g2 / n)},${Math.round(b2 / n)})` : '#b8b8b8';
    images.push({ avg, solid: false, id: ++imgSeq, name: f.name.replace(/\.[^.]+$/, '').slice(0, 10) || '画像', canvas: c, tex, aspect: c.width / c.height, flat: false });
  }
  e.target.value = '';
  renderImgList(); rebuildChips();
};
rebuildChips();

COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'sw'; b.dataset.c = c; b.style.background = c; b.setAttribute('aria-label', '色');
  b.onclick = () => { cur.color = c; pushToSelected(); };
  $('colors').appendChild(b);
});
document.querySelectorAll('#dims button').forEach((b) => {
  b.onclick = () => {
    const sl = slots()[Number(b.dataset.s)];
    if (!sl) return;
    const k = sl[0], lo = k === 'lift' ? 0 : LIMIT.min;
    cur[k] = Math.min(LIMIT.max, Math.max(lo, cur[k] + Number(b.dataset.d)));
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
  [].concat(it.userData.mesh.material).forEach((m) => m.dispose());
  it.userData.label.material.map.dispose();
};
function setSheet(min) {
  $('sheet').classList.toggle('min', min);
  $('toggle').textContent = min ? '▲ パネルをひらく(寸法変更・回転・削除)' : '▼ パネルをたたむ';
}
$('toggle').onclick = () => setSheet(!$('sheet').classList.contains('min'));
placeBtn.onclick = () => {
  if (!reticleOk) return;
  if (cur.kind === 'img' && !images.some((x) => x.id === cur.img)) return;
  const it = makeItem(cur);
  it.position.copy(reticle.position);
  it.rotation.y = reticle.rotation.y;
  scene.add(it); items.push(it);
  select(it);
  setSheet(true);            // 置いた直後は視界を広く取る
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
  setSheet(false);
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

// ---------- 上から見た配置図 ----------
const map = $('map'), mg = map.getContext('2d');
const cam = { x: 0, z: 0, fx: 0, fz: -1, ok: false };
let lastMap = 0;
function drawMap(time) {
  if (time - lastMap < 120) return;
  lastMap = time;
  const S = map.width, cx = S / 2, cy = S * 0.72, ppm = S / 5;   // 横幅5m分を表示
  mg.clearRect(0, 0, S, S);
  if (!cam.ok) return;
  const rx = -cam.fz, rz = cam.fx;                                 // 右方向
  const toMap = (x, z) => {
    const dx = x - cam.x, dz = z - cam.z;
    return [cx + (dx * rx + dz * rz) * ppm, cy - (dx * cam.fx + dz * cam.fz) * ppm];
  };
  // 1mごとの目盛り
  mg.strokeStyle = 'rgba(255,255,255,0.12)'; mg.lineWidth = 1;
  for (let i = -5; i <= 5; i++) {
    mg.beginPath(); mg.moveTo(cx + i * ppm, 0); mg.lineTo(cx + i * ppm, S); mg.stroke();
    mg.beginPath(); mg.moveTo(0, cy + i * ppm); mg.lineTo(S, cy + i * ppm); mg.stroke();
  }
  // 家具
  for (const it of items) {
    const d = it.userData.d, t = it.rotation.y, hw = d.w / 200, hd = (isStanding(d) ? 4 : d.d) / 200;
    const ax = Math.cos(t), az = -Math.sin(t), bx = Math.sin(t), bz = Math.cos(t);
    mg.beginPath();
    [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].forEach(([u, v], i) => {
      const [px, py] = toMap(it.position.x + ax * u + bx * v, it.position.z + az * u + bz * v);
      i ? mg.lineTo(px, py) : mg.moveTo(px, py);
    });
    mg.closePath();
    mg.fillStyle = d.kind === 'img' ? (d.solid ? (images.find((x) => x.id === d.img)?.avg || '#fff') : '#ffffff') : d.color; mg.globalAlpha = 0.75; mg.fill(); mg.globalAlpha = 1;
    mg.strokeStyle = it === selected ? '#ffe14d' : '#ffffff'; mg.lineWidth = it === selected ? 4 : 2; mg.stroke();
  }
  // 自分の位置と向き
  mg.fillStyle = '#ffffff';
  mg.beginPath(); mg.moveTo(cx, cy - 16); mg.lineTo(cx - 10, cy + 8); mg.lineTo(cx + 10, cy + 8); mg.closePath(); mg.fill();
}

// ---------- 毎フレーム ----------
renderer.setAnimationLoop((time, frame) => {
  if (frame && session) {
    if (!refSpace) refSpace = renderer.xr.getReferenceSpace();
    const viewer = refSpace ? frame.getViewerPose(refSpace) : null;
    cam.ok = !!viewer;
    if (viewer) {
      _m.fromArray(viewer.transform.matrix);
      _dir.set(0, 0, -1).transformDirection(_m);
      const len = Math.hypot(_dir.x, _dir.z);
      if (len > 0.05) { cam.fx = _dir.x / len; cam.fz = _dir.z / len; }   // 真下を向いた時は直前の向きを保つ
      cam.x = viewer.transform.position.x; cam.z = viewer.transform.position.z;
    }
    if (hitSource && refSpace) {
      const pose = frame.getHitTestResults(hitSource)[0]?.getPose(refSpace);
      if (pose && viewer) {
        reticle.position.copy(pose.transform.position);
        // 家具の正面が自分の方を向くようにする
        reticle.rotation.y = Math.atan2(-cam.fx, -cam.fz);
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
  if (session) drawMap(time);
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
