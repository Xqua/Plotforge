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

// ---- Local storage for user profiles ----

const USER_PROFILES_KEY = "plotforge-user-profiles";

function loadUserProfiles() {
  try {
    return JSON.parse(localStorage.getItem(USER_PROFILES_KEY)) || {};
  } catch { return {}; }
}

function saveUserProfiles(profiles) {
  localStorage.setItem(USER_PROFILES_KEY, JSON.stringify(profiles));
}

function addUserProfile(name, data) {
  const saved = loadUserProfiles();
  saved[name] = data;
  saveUserProfiles(saved);
}

function deleteUserProfile(name) {
  const saved = loadUserProfiles();
  delete saved[name];
  saveUserProfiles(saved);
}

// ---- Profile loading ----

state.userProfileNames = new Set();

export async function loadProfiles() {
  try {
    const resp = await fetch("/api/profiles");
    state.profiles = await resp.json();

    // Merge saved user profiles
    const userProfiles = loadUserProfiles();
    for (const [name, data] of Object.entries(userProfiles)) {
      state.profiles[name] = data;
      state.userProfileNames.add(name);
    }

    rebuildProfileDropdown();

    if (state.profiles["mpcnc"]) {
      profileSelect.value = "mpcnc";
      applyProfile("mpcnc");
    } else {
      const first = profileSelect.options[1];
      if (first) { profileSelect.value = first.value; applyProfile(first.value); }
    }
  } catch (e) {
    console.error("Failed to load profiles:", e);
  }
}

function rebuildProfileDropdown() {
  const current = profileSelect.value;
  profileSelect.innerHTML = '<option value="">-- Custom --</option>';

  const bundled = [];
  const user = [];
  for (const name of Object.keys(state.profiles)) {
    (state.userProfileNames.has(name) ? user : bundled).push(name);
  }

  bundled.sort((a, b) => {
    if (a === "mpcnc") return -1;
    if (b === "mpcnc") return 1;
    return a.localeCompare(b);
  });
  user.sort();

  for (const name of bundled) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    profileSelect.appendChild(opt);
  }

  if (user.length > 0) {
    const sep = document.createElement("option");
    sep.disabled = true;
    sep.textContent = "── Saved profiles ──";
    profileSelect.appendChild(sep);
    for (const name of user) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      profileSelect.appendChild(opt);
    }
  }

  // Restore selection if still valid
  if (current && state.profiles[current]) profileSelect.value = current;
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

// ---- Profile import / export ----

const btnExport = document.getElementById("btn-export-profile");
const btnImport = document.getElementById("btn-import-profile");
const profileFileInput = document.getElementById("profile-file-input");

btnExport.addEventListener("click", () => {
  const settings = gatherSettings();
  const name = profileSelect.value || "custom";

  let toml = `[gwrite.${name}]\n`;
  for (const key of TEMPLATE_FIELDS) {
    const val = settings[key];
    if (val) toml += `${key} = "${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"\n`;
  }
  for (const key of TRANSFORM_FIELDS) {
    const val = settings[key];
    if (val !== undefined && val !== null && val !== "") {
      toml += typeof val === "string" ? `${key} = "${val}"\n` : `${key} = ${val}\n`;
    }
  }
  for (const key of BOOL_FIELDS) {
    if (settings[key] !== undefined) toml += `${key} = ${settings[key]}\n`;
  }

  const blob = new Blob([toml], { type: "application/toml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.toml`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnImport.addEventListener("click", () => profileFileInput.click());

profileFileInput.addEventListener("change", async () => {
  const file = profileFileInput.files[0];
  if (!file) return;
  profileFileInput.value = "";

  const form = new FormData();
  form.append("file", file);

  try {
    const resp = await fetch("/api/parse-profile", { method: "POST", body: form });
    const data = await resp.json();
    if (data.error) { alert(`Failed to parse profile: ${data.error}`); return; }

    const name = file.name.replace(/\.toml$/, "").replace(/\.txt$/, "");
    state.profiles[name] = data;
    state.userProfileNames.add(name);
    addUserProfile(name, data);
    rebuildProfileDropdown();
    profileSelect.value = name;
    applyProfile(name);
  } catch (e) {
    alert(`Import failed: ${e.message}`);
  }
});

// Save current form as a named user profile
const btnSave = document.getElementById("btn-save-profile");
const btnDelete = document.getElementById("btn-delete-profile");

btnSave.addEventListener("click", () => {
  const defaultName = profileSelect.value || "my-profile";
  const name = prompt("Profile name:", defaultName);
  if (!name) return;

  const data = gatherSettings();
  state.profiles[name] = data;
  state.userProfileNames.add(name);
  addUserProfile(name, data);
  rebuildProfileDropdown();
  profileSelect.value = name;
});

btnDelete.addEventListener("click", () => {
  const name = profileSelect.value;
  if (!name || !state.userProfileNames.has(name)) {
    alert("Can only delete saved user profiles.");
    return;
  }
  if (!confirm(`Delete profile "${name}"?`)) return;

  delete state.profiles[name];
  state.userProfileNames.delete(name);
  deleteUserProfile(name);
  rebuildProfileDropdown();
  profileSelect.value = profileSelect.options[1]?.value || "";
  if (profileSelect.value) applyProfile(profileSelect.value);
});

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
