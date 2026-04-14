import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

// =========================================================================
// State
// =========================================================================
let svgContent = null;
let gcodeText = "";
let profiles = {};

// DOM refs
const uploadZone = document.getElementById("upload-zone");
const fileInput = document.getElementById("file-input");
const uploadFilename = document.getElementById("upload-filename");
const profileSelect = document.getElementById("profile-select");
const profileInfo = document.getElementById("profile-info");
const svgPreview = document.getElementById("svg-preview");
const gcodeOutput = document.getElementById("gcode-output");
const btnGenerate = document.getElementById("btn-generate");
const btnCopy = document.getElementById("btn-copy-gcode");
const btnDownload = document.getElementById("btn-download-gcode");
const btnResetCam = document.getElementById("btn-reset-camera");
const statusText = document.getElementById("status-text");
const statusStats = document.getElementById("status-stats");
const viewerInfo = document.getElementById("viewer-info");
const templateVarsRef = document.getElementById("template-vars-ref");

// Template field IDs
const TEMPLATE_FIELDS = [
  "document_start", "document_end",
  "layer_start", "layer_end", "layer_join",
  "line_start", "line_end", "line_join",
  "segment_first", "segment", "segment_last",
];

const TRANSFORM_FIELDS = ["unit", "scale_x", "scale_y", "offset_x", "offset_y"];
const BOOL_FIELDS = ["invert_x", "invert_y", "horizontal_flip", "vertical_flip"];

// =========================================================================
// Accordion
// =========================================================================
window.toggleAccordion = function (header) {
  header.parentElement.classList.toggle("open");
};

// =========================================================================
// Slider value display binding
// =========================================================================
function bindSlider(sliderId, valId) {
  const slider = document.getElementById(sliderId);
  const val = document.getElementById(valId);
  if (!slider || !val) return;
  slider.addEventListener("input", () => { val.textContent = slider.value; });
}

// Feed rate sliders
bindSlider("feed-cut", "feed-cut-val");
bindSlider("feed-travel", "feed-travel-val");
bindSlider("pen-down", "pen-down-val");
bindSlider("pen-up", "pen-up-val");

// Optimization sliders
bindSlider("opt-linemerge-tol", "opt-linemerge-val");
bindSlider("opt-linesimplify-tol", "opt-linesimplify-val");
bindSlider("opt-reloop-tol", "opt-reloop-val");

// Toggle slider visibility when checkbox changes
for (const name of ["linemerge", "linesimplify", "reloop"]) {
  const cb = document.getElementById(`opt-${name}`);
  const slider = document.getElementById(`opt-${name}-slider`);
  if (cb && slider) {
    const update = () => { slider.style.opacity = cb.checked ? "1" : "0.3"; };
    cb.addEventListener("change", update);
    update();
  }
}

// =========================================================================
// Feed rate / pen Z -> rebuild templates from sliders
// =========================================================================
function rebuildTemplatesFromSliders() {
  const feedCut = document.getElementById("feed-cut").value;
  const feedTravel = document.getElementById("feed-travel").value;
  const penDown = document.getElementById("pen-down").value;
  const penUp = document.getElementById("pen-up").value;

  document.getElementById("cfg-segment_first").value =
    `G1 Z${penUp} F${feedTravel}\nG0 X{x:.3f} Y{y:.3f}\nG1 Z${penDown} F${feedTravel}\n`;

  document.getElementById("cfg-segment").value =
    `G1 X{x:.3f} Y{y:.3f} F${feedCut}\n`;

  document.getElementById("cfg-document_end").value =
    `G1 Z${penUp} F${feedTravel}\nG0 X0 Y0\nM84\n`;
}

// Wire slider changes to template rebuild
for (const id of ["feed-cut", "feed-travel", "pen-down", "pen-up"]) {
  document.getElementById(id).addEventListener("input", rebuildTemplatesFromSliders);
}

// =========================================================================
// File Upload
// =========================================================================
uploadZone.addEventListener("click", () => fileInput.click());

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith(".svg")) handleFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    svgContent = e.target.result;
    uploadFilename.textContent = file.name;
    showSvgPreview(svgContent);
    btnGenerate.disabled = false;
    setStatus(`Loaded: ${file.name}`);
  };
  reader.readAsText(file);
}

function showSvgPreview(svg) {
  svgPreview.classList.remove("empty");
  svgPreview.innerHTML = svg;
  const svgEl = svgPreview.querySelector("svg");
  if (svgEl) {
    svgEl.setAttribute("width", "100%");
    svgEl.setAttribute("height", "100%");
    svgEl.style.maxWidth = "100%";
    svgEl.style.maxHeight = "100%";
  }
}

// =========================================================================
// Load Profiles
// =========================================================================
async function loadProfiles() {
  try {
    const resp = await fetch("/api/profiles");
    profiles = await resp.json();
    profileSelect.innerHTML = '<option value="">-- Custom --</option>';

    const names = Object.keys(profiles).sort((a, b) => {
      if (a === "mpcnc") return -1;
      if (b === "mpcnc") return 1;
      return a.localeCompare(b);
    });

    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      profileSelect.appendChild(opt);
    }

    if (profiles["mpcnc"]) {
      profileSelect.value = "mpcnc";
      applyProfile("mpcnc");
    } else if (names.length > 0) {
      profileSelect.value = names[0];
      applyProfile(names[0]);
    }
  } catch (e) {
    console.error("Failed to load profiles:", e);
  }
}

profileSelect.addEventListener("change", () => {
  const name = profileSelect.value;
  if (name && profiles[name]) {
    applyProfile(name);
  }
});

function applyProfile(name) {
  const cfg = profiles[name];
  if (!cfg) return;

  for (const key of TEMPLATE_FIELDS) {
    const el = document.getElementById(`cfg-${key}`);
    if (el) el.value = cfg[key] || "";
  }

  for (const key of TRANSFORM_FIELDS) {
    const el = document.getElementById(`cfg-${key}`);
    if (!el) continue;
    const val = cfg[key];
    if (val !== "" && val !== undefined && val !== null) {
      el.value = val;
    }
  }

  for (const key of BOOL_FIELDS) {
    const el = document.getElementById(`cfg-${key}`);
    if (el) el.checked = !!cfg[key];
  }

  profileInfo.textContent = cfg.info || "";

  // Try to extract feed rates and Z values from templates to sync sliders
  syncSlidersFromTemplates(cfg);
}

function syncSlidersFromTemplates(cfg) {
  const segFirst = cfg.segment_first || "";
  const seg = cfg.segment || "";

  // Extract cut feed rate from segment: F(\d+)
  const cutMatch = seg.match(/F(\d+)/);
  if (cutMatch) {
    const el = document.getElementById("feed-cut");
    el.value = cutMatch[1];
    document.getElementById("feed-cut-val").textContent = cutMatch[1];
  }

  // Extract travel feed and Z values from segment_first
  const travelMatch = segFirst.match(/F(\d+)/);
  if (travelMatch) {
    const el = document.getElementById("feed-travel");
    el.value = travelMatch[1];
    document.getElementById("feed-travel-val").textContent = travelMatch[1];
  }

  // Pen-up Z: first Z value in segment_first (e.g. "G1 Z5 F1000")
  const zUpMatch = segFirst.match(/Z([-\d.]+)/);
  if (zUpMatch) {
    const el = document.getElementById("pen-up");
    el.value = zUpMatch[1];
    document.getElementById("pen-up-val").textContent = zUpMatch[1];
  }

  // Pen-down Z: last Z value in segment_first (e.g. "G1 Z0 F1000")
  const allZ = [...segFirst.matchAll(/Z([-\d.]+)/g)];
  if (allZ.length >= 2) {
    const el = document.getElementById("pen-down");
    el.value = allZ[allZ.length - 1][1];
    document.getElementById("pen-down-val").textContent = allZ[allZ.length - 1][1];
  }
}

// =========================================================================
// Template Variables Reference
// =========================================================================
async function loadTemplateVars() {
  try {
    const resp = await fetch("/api/template-variables");
    const vars = await resp.json();
    let html = '<div style="font-size:0.75rem;line-height:1.7;">';
    for (const [k, v] of Object.entries(vars)) {
      html += `<div><code style="color:var(--accent);">{${k}}</code> - ${v}</div>`;
    }
    html += "</div>";
    templateVarsRef.innerHTML = html;
  } catch (e) {
    templateVarsRef.textContent = "Failed to load";
  }
}

// =========================================================================
// Gather current settings from the form
// =========================================================================
function gatherSettings() {
  const settings = {};

  for (const key of TEMPLATE_FIELDS) {
    const el = document.getElementById(`cfg-${key}`);
    settings[key] = el ? el.value : "";
  }

  settings.unit = document.getElementById("cfg-unit").value;
  settings.scale_x = parseFloat(document.getElementById("cfg-scale_x").value) || 1.0;
  settings.scale_y = parseFloat(document.getElementById("cfg-scale_y").value) || 1.0;
  settings.offset_x = parseFloat(document.getElementById("cfg-offset_x").value) || 0.0;
  settings.offset_y = parseFloat(document.getElementById("cfg-offset_y").value) || 0.0;

  for (const key of BOOL_FIELDS) {
    settings[key] = document.getElementById(`cfg-${key}`).checked;
  }

  return settings;
}

function gatherVpypeOptions() {
  return {
    linemerge: document.getElementById("opt-linemerge").checked,
    linemerge_tolerance: parseFloat(document.getElementById("opt-linemerge-tol").value),
    linesimplify: document.getElementById("opt-linesimplify").checked,
    linesimplify_tolerance: parseFloat(document.getElementById("opt-linesimplify-tol").value),
    linesort: document.getElementById("opt-linesort").checked,
    reloop: document.getElementById("opt-reloop").checked,
    reloop_tolerance: parseFloat(document.getElementById("opt-reloop-tol").value),
  };
}

// =========================================================================
// Generate G-code
// =========================================================================
btnGenerate.addEventListener("click", generateGcode);

async function generateGcode() {
  if (!svgContent) return;

  btnGenerate.disabled = true;
  btnGenerate.innerHTML = '<span class="spinner"></span> Generating...';
  setStatus("Generating G-code...");

  try {
    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        svg_content: svgContent,
        profile: gatherSettings(),
        vpype_options: gatherVpypeOptions(),
      }),
    });

    const data = await resp.json();
    if (data.error) {
      setStatus(`Error: ${data.error}`);
      alert(`Generation failed:\n${data.error}`);
      return;
    }

    gcodeText = data.gcode;
    gcodeOutput.value = gcodeText;

    const lines = gcodeText.split("\n").length;
    const bytes = new Blob([gcodeText]).size;
    statusStats.textContent = `${lines} lines | ${(bytes / 1024).toFixed(1)} KB`;
    setStatus("G-code generated successfully");

    renderGcode(gcodeText);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.textContent = "Generate G-code";
  }
}

// =========================================================================
// Copy & Download
// =========================================================================
btnCopy.addEventListener("click", () => {
  if (!gcodeText) return;
  navigator.clipboard.writeText(gcodeText);
  setStatus("Copied to clipboard");
});

btnDownload.addEventListener("click", () => {
  if (!gcodeText) return;
  const blob = new Blob([gcodeText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "output.gcode";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Downloaded output.gcode");
});

// =========================================================================
// Status
// =========================================================================
function setStatus(msg) {
  statusText.textContent = msg;
}

// =========================================================================
// Three.js G-code Viewer
// =========================================================================
let scene, camera, renderer, controls;
let toolpathGroup = null;
const controlsSelect = document.getElementById("controls-preset");

// ---- Control presets ----
const CONTROL_PRESETS = {
  blender: {
    label: "Blender",
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

      // Shift+Middle → pan
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
    label: "Touchpad",
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
    label: "CAD",
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
    label: "Default",
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

  // Cleanup previous preset
  for (const preset of Object.values(CONTROL_PRESETS)) {
    preset.cleanup(canvas);
  }

  const preset = CONTROL_PRESETS[name] || CONTROL_PRESETS.blender;
  preset.apply(controls, canvas);

  viewerInfo.textContent = preset.hint;
  localStorage.setItem("controls-preset", name);
}

let viewHelper = null;
const clock = new THREE.Clock();

function initViewer() {
  const canvas = document.getElementById("viewer-canvas");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  camera.position.set(0, 0, 300);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.autoClear = false;

  controls = new OrbitControls(camera, canvas);

  // Suppress context menu on the canvas
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Grid on XY plane
  const grid = new THREE.GridHelper(500, 50, 0x2a2a4a, 0x1e1e3e);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const axes = new THREE.AxesHelper(50);
  scene.add(axes);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  // Orientation gizmo (top-right corner, default position in v0.170)
  viewHelper = new ViewHelper(camera, renderer.domElement);
  viewHelper.center = controls.target;

  // Click on gizmo axes to snap camera
  canvas.addEventListener("pointerup", (e) => {
    viewHelper.handleClick(e);
  });

  // Apply saved or default controls preset
  const saved = localStorage.getItem("controls-preset") || "blender";
  controlsSelect.value = saved;
  applyControlPreset(saved);

  controlsSelect.addEventListener("change", () => {
    applyControlPreset(controlsSelect.value);
  });

  resizeViewer();
  animate();

  window.addEventListener("resize", resizeViewer);
  btnResetCam.addEventListener("click", resetCamera);
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
// G-code Parser -> 3D paths
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

    const gMatch = line.match(/^G([01])\b/i);
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

function renderGcode(gcode) {
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
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      totalPoints++;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geometry, path.type === "rapid" ? rapidMat : cutMat);
    toolpathGroup.add(line);
  }

  scene.add(toolpathGroup);
  resetCamera();

  viewerInfo.textContent = `${totalPoints} points | ${paths.length} segments`;
}

// =========================================================================
// Init
// =========================================================================
loadProfiles();
loadTemplateVars();
initViewer();


new ResizeObserver(resizeViewer).observe(document.getElementById("viewer-container"));
