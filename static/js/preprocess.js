import { state, setStatus, debounce } from "./state.js";
import { acceptSvgFromWizard } from "./upload.js";

const VARIANTS = ["canny_auto", "canny_strong", "adaptive"];

/**
 * Make an SVG scale to its container without being cropped.
 * If the SVG has width/height but no viewBox, synthesize one from them
 * (vtracer omits viewBox). Then force fluid sizing.
 */
function ensureViewBoxAndFit(svgEl) {
  if (!svgEl.hasAttribute("viewBox")) {
    const rawW = svgEl.getAttribute("width");
    const rawH = svgEl.getAttribute("height");
    const w = parseFloat(rawW);
    const h = parseFloat(rawH);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
  }
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", "100%");
  svgEl.style.maxWidth = "100%";
  svgEl.style.maxHeight = "100%";
  svgEl.style.display = "block";
}
const VARIANT_LABELS = {
  canny_auto: "Canny auto",
  canny_strong: "Canny fort",
  adaptive: "Adaptive",
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const wizard = () => document.getElementById("preprocess-wizard");
const stepBodies = () => document.querySelectorAll("#preprocess-wizard .wizard-body");
const stepChips = () => document.querySelectorAll("#preprocess-wizard .wizard-step");

// ---------------------------------------------------------------------------
// Progress bar (rembg inference)
// ---------------------------------------------------------------------------

let _progressShowTimer = null;
let _progressEscalateTimer = null;

function showProgress(label = "Isolating subject…") {
  const el = document.getElementById("wizard-progress");
  const labelEl = document.getElementById("wizard-progress-label");
  if (!el) return;
  clearTimeout(_progressShowTimer);
  clearTimeout(_progressEscalateTimer);
  // Delay first render so sub-300ms (cached-mask) requests don't flash the bar.
  _progressShowTimer = setTimeout(() => {
    labelEl.textContent = label;
    el.classList.remove("hidden");
    // After 5 s of waiting, hint at the one-time model download.
    _progressEscalateTimer = setTimeout(() => {
      labelEl.textContent = "Isolating subject… (first run downloads ~176 MB)";
    }, 5000);
  }, 250);
}

function hideProgress() {
  clearTimeout(_progressShowTimer);
  clearTimeout(_progressEscalateTimer);
  const el = document.getElementById("wizard-progress");
  if (el) el.classList.add("hidden");
}

async function withProgress(label, fn) {
  if (state.bgMode === "none") return fn();
  showProgress(label);
  try {
    return await fn();
  } finally {
    hideProgress();
  }
}

function showStep(n) {
  stepBodies().forEach((el) => el.classList.toggle("hidden", Number(el.dataset.step) !== n));
  stepChips().forEach((el) => el.classList.toggle("active", Number(el.dataset.step) === n));
  const prev = document.getElementById("wizard-prev");
  const next = document.getElementById("wizard-next");
  const confirm = document.getElementById("wizard-confirm");
  prev.classList.toggle("hidden", n === 1);
  next.classList.toggle("hidden", n === 3);
  confirm.classList.toggle("hidden", n !== 3);
  state._wizardStep = n;
}

function openWizard() { wizard().classList.remove("hidden"); }
function closeWizard() { wizard().classList.add("hidden"); }

// ---------------------------------------------------------------------------
// Public entry point (called from upload.js)
// ---------------------------------------------------------------------------

export async function openWizardFromRasterFile(file) {
  const b64 = await readFileAsDataURL(file);
  const { width, height } = await readImageSize(b64);
  state.originalImage = { b64, filename: file.name, width, height };
  document.getElementById("upload-filename").textContent = file.name;
  const origEl = document.getElementById("wizard-original-dims");
  if (origEl) origEl.textContent = `${width} × ${height} px`;
  openWizard();
  showStep(1);
  await runGrayscale();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function readImageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Step 1: grayscale
// ---------------------------------------------------------------------------

async function runGrayscale() {
  const preview = document.getElementById("wizard-gray-preview");
  preview.classList.add("loading");
  setStatus("Processing grayscale…");
  if (state.bgMode !== "none") showProgress("Isolating subject…");
  try {
    const resp = await fetch("/api/preprocess/grayscale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: state.originalImage.b64,
        max_dim: state.resizeMaxDim,
        bg_mode: state.bgMode,
        bg_blur_radius: state.bgBlurRadius,
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    state.grayscaleB64 = data.png_b64;
    preview.src = data.png_b64;
    document.getElementById("wizard-gray-dims").textContent = `${data.width} × ${data.height} px`;
    setStatus(`Grayscale ready (${data.width}×${data.height})`);
  } catch (e) {
    setStatus(`Grayscale error: ${e.message}`);
    alert(`Grayscale failed: ${e.message}`);
  } finally {
    preview.classList.remove("loading");
    hideProgress();
  }
}

const debouncedGrayscale = debounce(runGrayscale, 250);

// ---------------------------------------------------------------------------
// Step 2: contours (3 variants)
// ---------------------------------------------------------------------------

async function runContoursAll() {
  VARIANTS.forEach((v) => setCardLoading(v, true));
  setStatus("Computing contours (3 variants)…");
  if (state.bgMode !== "none") showProgress("Isolating subject…");
  try {
    const resp = await fetch("/api/preprocess/contours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: state.originalImage.b64,
        max_dim: state.resizeMaxDim,
        bg_mode: state.bgMode,
        bg_blur_radius: state.bgBlurRadius,
        canny_auto: state.variantParams.canny_auto,
        canny_strong: state.variantParams.canny_strong,
        adaptive: state.variantParams.adaptive,
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    VARIANTS.forEach((v) => {
      state.variantPngs[v] = data[v];
      document.querySelector(`.contour-card[data-variant="${v}"] img`).src = data[v];
    });
    selectVariant(state.selectedVariant || "canny_auto");
    setStatus("Contours ready");
  } catch (e) {
    setStatus(`Contours error: ${e.message}`);
    alert(`Contours failed: ${e.message}`);
  } finally {
    VARIANTS.forEach((v) => setCardLoading(v, false));
    hideProgress();
  }
}

async function regenerateVariant(name) {
  setCardLoading(name, true);
  if (state.bgMode !== "none") showProgress("Isolating subject…");
  try {
    const body = {
      image_b64: state.originalImage.b64,
      max_dim: state.resizeMaxDim,
      bg_mode: state.bgMode,
      bg_blur_radius: state.bgBlurRadius,
      variant: name,
    };
    body[name] = state.variantParams[name];
    const resp = await fetch("/api/preprocess/contour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    state.variantPngs[name] = data.png_b64;
    document.querySelector(`.contour-card[data-variant="${name}"] img`).src = data.png_b64;
  } catch (e) {
    setStatus(`${name}: ${e.message}`);
  } finally {
    setCardLoading(name, false);
    hideProgress();
  }
}

const debouncedRegen = {};
VARIANTS.forEach((v) => { debouncedRegen[v] = debounce(() => regenerateVariant(v), 250); });

function setCardLoading(name, on) {
  const card = document.querySelector(`.contour-card[data-variant="${name}"]`);
  if (card) card.classList.toggle("loading", on);
}

function selectVariant(name) {
  state.selectedVariant = name;
  document.querySelectorAll(".contour-card").forEach((c) => {
    c.classList.toggle("selected", c.dataset.variant === name);
  });
}

// ---------------------------------------------------------------------------
// Step 3: vectorize
// ---------------------------------------------------------------------------

async function runVectorize() {
  const preview = document.getElementById("wizard-svg-preview");
  preview.classList.add("loading");
  preview.innerHTML = "";
  setStatus("Vectorizing…");
  try {
    const chosenPng = state.variantPngs[state.selectedVariant];
    if (!chosenPng) throw new Error("No contour image for selected variant");
    const resp = await fetch("/api/preprocess/vectorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        png_b64: chosenPng,
        ...state.vectorizeParams,
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    state.vectorizedSvg = data.svg_content;
    preview.innerHTML = data.svg_content;
    const svgEl = preview.querySelector("svg");
    if (svgEl) ensureViewBoxAndFit(svgEl);
    document.getElementById("wizard-path-count").textContent = `${data.path_count} path(s)`;
    setStatus(`Vectorized: ${data.path_count} path(s)`);
  } catch (e) {
    setStatus(`Vectorize error: ${e.message}`);
    alert(`Vectorize failed: ${e.message}`);
  } finally {
    preview.classList.remove("loading");
  }
}

const debouncedVectorize = debounce(runVectorize, 300);

// ---------------------------------------------------------------------------
// Wizard wiring
// ---------------------------------------------------------------------------

function wireWizard() {
  document.getElementById("wizard-cancel").addEventListener("click", () => {
    closeWizard();
    state.originalImage = null;
    setStatus("Wizard cancelled");
  });

  document.getElementById("wizard-next").addEventListener("click", async () => {
    if (state._wizardStep === 1) {
      showStep(2);
      await runContoursAll();
    } else if (state._wizardStep === 2) {
      showStep(3);
      await runVectorize();
    }
  });

  document.getElementById("wizard-prev").addEventListener("click", () => {
    if (state._wizardStep === 3) showStep(2);
    else if (state._wizardStep === 2) showStep(1);
  });

  document.getElementById("wizard-confirm").addEventListener("click", () => {
    if (!state.vectorizedSvg) return;
    acceptSvgFromWizard(state.vectorizedSvg, state.originalImage?.filename);
    closeWizard();
  });

  // Background isolation (step 1)
  const bgMode = document.getElementById("wizard-bg-mode");
  const bgBlur = document.getElementById("wizard-bg-blur");
  const bgBlurVal = document.getElementById("wizard-bg-blur-val");
  const bgBlurWrap = document.getElementById("wizard-bg-blur-wrap");
  bgMode.addEventListener("change", () => {
    state.bgMode = bgMode.value;
    bgBlurWrap.classList.toggle("hidden", state.bgMode !== "blur");
    setStatus(state.bgMode === "none" ? "Background: none"
      : state.bgMode === "white" ? "Isolating subject (white bg)…"
      : "Isolating subject (blur bg)…");
    debouncedGrayscale();
  });
  bgBlur.addEventListener("input", () => {
    state.bgBlurRadius = Number(bgBlur.value);
    bgBlurVal.textContent = bgBlur.value;
    if (state.bgMode === "blur") debouncedGrayscale();
  });

  // Resize slider (step 1)
  const resize = document.getElementById("wizard-resize");
  const resizeVal = document.getElementById("wizard-resize-val");
  const resizeWarn = document.getElementById("wizard-resize-warn");
  resize.addEventListener("input", () => {
    state.resizeMaxDim = Number(resize.value);
    resizeVal.textContent = `${state.resizeMaxDim} px`;
    resizeWarn.classList.toggle("hidden", state.resizeMaxDim <= 1440);
    debouncedGrayscale();
  });

  // Variant cards (step 2)
  document.querySelectorAll(".contour-card").forEach((card) => {
    const v = card.dataset.variant;
    card.addEventListener("click", (e) => {
      // Avoid re-selecting when interacting with a slider inside the card
      if (e.target.closest("input, label")) return;
      selectVariant(v);
    });
    card.querySelectorAll("input[type=range], input[type=checkbox]").forEach((input) => {
      input.addEventListener("input", () => {
        updateVariantParamsFromInputs(v);
        debouncedRegen[v]();
      });
    });
  });

  // Vectorize sliders (step 3)
  document.querySelectorAll("#wizard-vectorize-controls input, #wizard-vectorize-controls select").forEach((el) => {
    el.addEventListener("input", () => {
      updateVectorizeParamsFromInputs();
      debouncedVectorize();
    });
  });
}

function updateVariantParamsFromInputs(variant) {
  const card = document.querySelector(`.contour-card[data-variant="${variant}"]`);
  const p = state.variantParams[variant];
  card.querySelectorAll("input[data-key]").forEach((input) => {
    const key = input.dataset.key;
    if (input.type === "checkbox") p[key] = input.checked;
    else p[key] = Number(input.value);
    const valEl = card.querySelector(`.slider-val[data-key="${key}"]`);
    if (valEl) valEl.textContent = input.value;
  });
}

function updateVectorizeParamsFromInputs() {
  document.querySelectorAll("#wizard-vectorize-controls [data-key]").forEach((input) => {
    const key = input.dataset.key;
    const v = input.type === "number" || input.type === "range" ? Number(input.value) : input.value;
    state.vectorizeParams[key] = v;
    const valEl = document.querySelector(`#wizard-vectorize-controls .slider-val[data-key="${key}"]`);
    if (valEl) valEl.textContent = input.value;
  });
}

// Wire once DOM is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireWizard);
} else {
  wireWizard();
}
