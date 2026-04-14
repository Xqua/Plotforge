import { state } from "./state.js";

const TEMPLATE_FIELDS = [
  "document_start", "document_end",
  "layer_start", "layer_end", "layer_join",
  "line_start", "line_end", "line_join",
  "segment_first", "segment", "segment_last",
];

const TRANSFORM_FIELDS = ["unit", "scale_x", "scale_y", "offset_x", "offset_y"];
const BOOL_FIELDS = ["invert_x", "invert_y", "horizontal_flip", "vertical_flip"];

const profileSelect = document.getElementById("profile-select");
const profileInfo = document.getElementById("profile-info");
const templateVarsRef = document.getElementById("template-vars-ref");

// ---- Profile loading ----

export async function loadProfiles() {
  try {
    const resp = await fetch("/api/profiles");
    state.profiles = await resp.json();
    profileSelect.innerHTML = '<option value="">-- Custom --</option>';

    const names = Object.keys(state.profiles).sort((a, b) => {
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

    if (state.profiles["mpcnc"]) {
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
  if (name && state.profiles[name]) {
    applyProfile(name);
  }
});

function applyProfile(name) {
  const cfg = state.profiles[name];
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
    if (el && typeof cfg[key] === "boolean") el.checked = cfg[key];
  }

  profileInfo.textContent = cfg.info || "";
  syncSlidersFromTemplates(cfg);
}

function syncSlidersFromTemplates(cfg) {
  const segFirst = cfg.segment_first || "";
  const seg = cfg.segment || "";

  const cutMatch = seg.match(/F(\d+)/);
  if (cutMatch) {
    document.getElementById("feed-cut").value = cutMatch[1];
    document.getElementById("feed-cut-val").textContent = cutMatch[1];
  }

  const travelMatch = segFirst.match(/F(\d+)/);
  if (travelMatch) {
    document.getElementById("feed-travel").value = travelMatch[1];
    document.getElementById("feed-travel-val").textContent = travelMatch[1];
  }

  const zUpMatch = segFirst.match(/Z([-\d.]+)/);
  if (zUpMatch) {
    document.getElementById("pen-up").value = zUpMatch[1];
    document.getElementById("pen-up-val").textContent = zUpMatch[1];
  }

  const allZ = [...segFirst.matchAll(/Z([-\d.]+)/g)];
  if (allZ.length >= 2) {
    document.getElementById("pen-down").value = allZ[allZ.length - 1][1];
    document.getElementById("pen-down-val").textContent = allZ[allZ.length - 1][1];
  }
}

// ---- Template variables reference ----

export async function loadTemplateVars() {
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

// ---- Form gathering ----

export function gatherSettings() {
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

export function gatherVpypeOptions() {
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
