import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

let scene, camera, renderer, controls;
let toolpathGroup = null;
let rulerGroup = null;
let viewHelper = null;
const clock = new THREE.Clock();

const controlsSelect = document.getElementById("controls-preset");
const btnResetCam = document.getElementById("btn-reset-camera");
const viewerInfo = document.getElementById("viewer-info");

// =========================================================================
// Control presets
// =========================================================================

const CONTROL_PRESETS = {
  blender: {
    hint: "Middle-drag: orbit | Shift+Middle: pan | Scroll: zoom",
    apply(ctrl, canvas) {
      ctrl.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN,
      };
      ctrl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      ctrl.enableDamping = true;
      ctrl.dampingFactor = 0.05;
      ctrl.screenSpacePanning = true;
      ctrl.zoomToCursor = true;
      ctrl.zoomSpeed = 1.0;
      ctrl.rotateSpeed = 1.0;
      ctrl.panSpeed = 1.0;

      canvas._blenderDown = (e) => {
        if (e.button === 1 && e.shiftKey) ctrl.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      };
      canvas._blenderUp = () => {
        ctrl.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
      };
      canvas.addEventListener("mousedown", canvas._blenderDown);
      canvas.addEventListener("mouseup", canvas._blenderUp);
    },
    cleanup(canvas) {
      if (canvas._blenderDown) {
        canvas.removeEventListener("mousedown", canvas._blenderDown);
        canvas.removeEventListener("mouseup", canvas._blenderUp);
        delete canvas._blenderDown;
        delete canvas._blenderUp;
      }
    },
  },

  touchpad: {
    hint: "Left-drag: orbit | Right-drag: pan | Scroll/Pinch: zoom",
    apply(ctrl) {
      ctrl.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      ctrl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      ctrl.enableDamping = true;
      ctrl.dampingFactor = 0.06;
      ctrl.screenSpacePanning = true;
      ctrl.zoomToCursor = true;
      ctrl.zoomSpeed = 0.5;
      ctrl.rotateSpeed = 1.0;
      ctrl.panSpeed = 1.0;
    },
    cleanup() {},
  },

  cad: {
    hint: "Right-drag: orbit | Middle-drag: pan | Scroll: zoom",
    apply(ctrl) {
      ctrl.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      ctrl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
      ctrl.enableDamping = true;
      ctrl.dampingFactor = 0.08;
      ctrl.screenSpacePanning = true;
      ctrl.zoomToCursor = true;
      ctrl.zoomSpeed = 1.2;
      ctrl.rotateSpeed = 1.0;
      ctrl.panSpeed = 1.0;
    },
    cleanup() {},
  },

  default: {
    hint: "Left-drag: orbit | Middle: zoom | Right-drag: pan",
    apply(ctrl) {
      ctrl.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      ctrl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      ctrl.enableDamping = true;
      ctrl.dampingFactor = 0.1;
      ctrl.screenSpacePanning = true;
      ctrl.zoomToCursor = false;
      ctrl.zoomSpeed = 1.0;
      ctrl.rotateSpeed = 1.0;
      ctrl.panSpeed = 1.0;
    },
    cleanup() {},
  },
};

function applyControlPreset(name) {
  const canvas = renderer.domElement;
  for (const preset of Object.values(CONTROL_PRESETS)) {
    preset.cleanup(canvas);
  }
  const preset = CONTROL_PRESETS[name] || CONTROL_PRESETS.blender;
  preset.apply(controls, canvas);
  viewerInfo.textContent = preset.hint;
  localStorage.setItem("controls-preset", name);
}

// =========================================================================
// Scene setup
// =========================================================================

export function initViewer() {
  const canvas = document.getElementById("viewer-canvas");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  camera.position.set(0, 0, 300);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.autoClear = false;

  controls = new OrbitControls(camera, canvas);

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const grid = new THREE.GridHelper(500, 50, 0x2a2a4a, 0x1e1e3e);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(50));
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  // Orientation gizmo
  viewHelper = new ViewHelper(camera, renderer.domElement);
  viewHelper.center = controls.target;
  canvas.addEventListener("pointerup", (e) => viewHelper.handleClick(e));

  // Controls preset
  const saved = localStorage.getItem("controls-preset") || "blender";
  controlsSelect.value = saved;
  applyControlPreset(saved);
  controlsSelect.addEventListener("change", () => applyControlPreset(controlsSelect.value));

  resizeViewer();
  animate();

  window.addEventListener("resize", resizeViewer);
  btnResetCam.addEventListener("click", resetCamera);
  new ResizeObserver(resizeViewer).observe(document.getElementById("viewer-container"));
}

function resizeViewer() {
  const container = document.getElementById("viewer-container");
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  const delta = clock.getDelta();
  requestAnimationFrame(animate);
  controls.update();

  if (viewHelper && viewHelper.animating) {
    viewHelper.update(delta);
    controls.update();
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (viewHelper) viewHelper.render(renderer);
}

function resetCamera() {
  let center = new THREE.Vector3(50, 50, 0);
  let dist = 200;

  if (toolpathGroup) {
    const box = new THREE.Box3().setFromObject(toolpathGroup);
    center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    dist = Math.max(size.x, size.y, size.z) * 1.5;
  }

  controls.target.copy(center);
  camera.position.set(center.x, center.y, center.z + dist);
  camera.up.set(0, 1, 0);
  controls.update();
}

// =========================================================================
// G-code parser
// =========================================================================

function parseGcode(gcode) {
  const lines = gcode.split("\n");
  const paths = [];
  let currentPath = null;
  let cx = 0, cy = 0, cz = 0;
  let isAbsolute = true;

  for (const raw of lines) {
    const line = raw.trim().replace(/;.*$/, "").replace(/\(.*?\)/g, "");
    if (!line) continue;

    if (/^G90\b/i.test(line)) { isAbsolute = true; continue; }
    if (/^G91\b/i.test(line)) { isAbsolute = false; continue; }
    if (/^G92\b/i.test(line)) {
      const xm = line.match(/X([-\d.]+)/i);
      const ym = line.match(/Y([-\d.]+)/i);
      const zm = line.match(/Z([-\d.]+)/i);
      if (xm) cx = parseFloat(xm[1]);
      if (ym) cy = parseFloat(ym[1]);
      if (zm) cz = parseFloat(zm[1]);
      continue;
    }

    const gMatch = line.match(/^G0?([01])\b/i);
    if (!gMatch) continue;

    const isRapid = gMatch[1] === "0";
    const xm = line.match(/X([-\d.]+)/i);
    const ym = line.match(/Y([-\d.]+)/i);
    const zm = line.match(/Z([-\d.]+)/i);

    let nx = cx, ny = cy, nz = cz;
    if (isAbsolute) {
      if (xm) nx = parseFloat(xm[1]);
      if (ym) ny = parseFloat(ym[1]);
      if (zm) nz = parseFloat(zm[1]);
    } else {
      if (xm) nx = cx + parseFloat(xm[1]);
      if (ym) ny = cy + parseFloat(ym[1]);
      if (zm) nz = cz + parseFloat(zm[1]);
    }

    // Z-only G1 moves (pen lifts/drops) are travel, not cuts
    const isZHop = !isRapid && zm && !xm && !ym;
    const moveType = (isRapid || isZHop) ? "rapid" : "cut";

    if (!currentPath || currentPath.type !== moveType) {
      if (currentPath && currentPath.points.length > 0) {
        paths.push(currentPath);
      }
      currentPath = { type: moveType, points: [{ x: cx, y: cy, z: cz }] };
    }

    currentPath.points.push({ x: nx, y: ny, z: nz });
    cx = nx; cy = ny; cz = nz;
  }

  if (currentPath && currentPath.points.length > 0) {
    paths.push(currentPath);
  }

  return paths;
}

// =========================================================================
// G-code 3D renderer
// =========================================================================

export function renderGcode(gcode) {
  if (toolpathGroup) {
    scene.remove(toolpathGroup);
    toolpathGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  toolpathGroup = new THREE.Group();

  const paths = parseGcode(gcode);

  const rapidMat = new THREE.LineBasicMaterial({
    color: 0x44cc66,
    transparent: true,
    opacity: 0.5,
  });

  const cutMat = new THREE.LineBasicMaterial({
    color: 0xe94560,
  });

  let totalPoints = 0;

  for (const path of paths) {
    if (path.points.length < 2) continue;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(path.points.length * 3);

    for (let i = 0; i < path.points.length; i++) {
      const p = path.points[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = -p.y;  // Negate Y: SVG Y-down → Three.js Y-up
      positions[i * 3 + 2] = p.z;
      totalPoints++;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geometry, path.type === "rapid" ? rapidMat : cutMat);
    toolpathGroup.add(line);
  }

  scene.add(toolpathGroup);
  buildRulers();
  resetCamera();

  viewerInfo.textContent = `${totalPoints} points | ${paths.length} segments`;
}

// =========================================================================
// Axis rulers with tick marks and labels
// =========================================================================

function makeTextSprite(text, color = "#999999") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontSize = 48;
  ctx.font = `${fontSize}px sans-serif`;
  const width = ctx.measureText(text).width + 8;
  canvas.width = width;
  canvas.height = fontSize + 8;
  // Re-set font after resize
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(text, 4, fontSize);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(canvas.width / 8, canvas.height / 8, 1);
  return sprite;
}

function buildRulers() {
  if (rulerGroup) {
    scene.remove(rulerGroup);
    rulerGroup.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    });
  }

  rulerGroup = new THREE.Group();

  if (!toolpathGroup) return;

  const box = new THREE.Box3().setFromObject(toolpathGroup);
  const maxX = Math.ceil(box.max.x);
  const minY = Math.floor(box.min.y);  // negative because of Y flip
  const maxY = Math.ceil(box.max.y);

  // Choose a nice tick interval based on extent
  const extentX = maxX;
  const extentY = Math.max(Math.abs(minY), Math.abs(maxY));
  const extent = Math.max(extentX, extentY);
  let step = 10; // mm
  if (extent > 500) step = 100;
  else if (extent > 200) step = 50;
  else if (extent > 50) step = 10;
  else step = 5;

  const tickLen = step * 0.15;
  const tickMat = new THREE.LineBasicMaterial({ color: 0x666688 });

  // X axis ruler (along Y=0 line, below toolpath)
  const rulerY = 0; // origin
  for (let x = step; x <= maxX + step; x += step) {
    // Tick mark
    const tickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, rulerY, 0),
      new THREE.Vector3(x, rulerY + tickLen, 0),
    ]);
    rulerGroup.add(new THREE.Line(tickGeo, tickMat));

    // Label
    const label = makeTextSprite(`${x}`);
    label.position.set(x, rulerY + tickLen + 2, 0);
    rulerGroup.add(label);
  }

  // X axis line
  const xLineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, rulerY, 0),
    new THREE.Vector3(maxX + step, rulerY, 0),
  ]);
  rulerGroup.add(new THREE.Line(xLineGeo, tickMat));

  // Y axis ruler (along X=0 line) — remember Y is negated in viewer
  const rulerX = 0;
  const yStart = Math.min(minY, 0);
  const yEnd = Math.max(maxY, 0);
  for (let y = yStart; y >= yStart - step; y -= step) {} // not needed
  for (let y = Math.ceil(yStart / step) * step; y <= yEnd; y += step) {
    if (y === 0) continue;
    // Tick mark
    const tickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(rulerX, y, 0),
      new THREE.Vector3(rulerX - tickLen, y, 0),
    ]);
    rulerGroup.add(new THREE.Line(tickGeo, tickMat));

    // Label — show positive values since they represent mm from origin
    const label = makeTextSprite(`${Math.abs(y)}`);
    label.position.set(rulerX - tickLen - 4, y, 0);
    rulerGroup.add(label);
  }

  // Y axis line
  const yLineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(rulerX, yStart, 0),
    new THREE.Vector3(rulerX, yEnd, 0),
  ]);
  rulerGroup.add(new THREE.Line(yLineGeo, tickMat));

  // Origin label
  const originLabel = makeTextSprite("0", "#888888");
  originLabel.position.set(-3, 2, 0);
  rulerGroup.add(originLabel);

  // Unit labels
  const xUnitLabel = makeTextSprite("mm", "#666688");
  xUnitLabel.position.set(maxX + step + step * 1.2, rulerY + tickLen + 2, 0);
  rulerGroup.add(xUnitLabel);

  const yUnitLabel = makeTextSprite("mm", "#666688");
  yUnitLabel.position.set(rulerX - tickLen - 4, yStart - step * 0.5, 0);
  rulerGroup.add(yUnitLabel);

  scene.add(rulerGroup);
}
