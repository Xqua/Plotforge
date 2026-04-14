// Shared mutable application state
export const state = {
  svgContent: null,
  gcodeText: "",
  profiles: {},
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
