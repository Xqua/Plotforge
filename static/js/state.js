// Shared mutable application state
export const state = {
  svgContent: null,
  gcodeText: "",
  profiles: {},

  // ----- Raster preprocessing wizard -----
  originalImage: null,        // { b64, filename, width, height }
  resizeMaxDim: 720,
  bgMode: "none",             // "none" | "white" | "blur"
  bgBlurRadius: 15,
  grayscaleB64: null,
  selectedVariant: "canny_auto",
  variantParams: {
    canny_auto:   { sigma: 0.33, blur_ksize: 5, invert: true },
    canny_strong: { low: 100, high: 200, morph_close_ksize: 3, blur_ksize: 5, invert: true },
    adaptive:     { block_size: 11, c_value: 2, blur_ksize: 5, invert: true },
  },
  variantPngs: { canny_auto: null, canny_strong: null, adaptive: null },
  vectorizeParams: {
    filter_speckle: 4,
    corner_threshold: 60,
    length_threshold: 4.0,
    splice_threshold: 45,
    path_precision: 3,
    mode: "spline",
  },
  vectorizedSvg: null,
};

// Shared DOM refs used by multiple modules
export const dom = {
  statusText: document.getElementById("status-text"),
  statusStats: document.getElementById("status-stats"),
  gcodeOutput: document.getElementById("gcode-output"),
  btnGenerate: document.getElementById("btn-generate"),
};

export function setStatus(msg) {
  dom.statusText.textContent = msg;
}

// Small shared utility used by preprocess.js
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
