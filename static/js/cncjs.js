import { state, setStatus } from "./state.js";

const CNCJS_SETTINGS_KEY = "plotforge-cncjs";

const hostInput = document.getElementById("cncjs-host");
const portInput = document.getElementById("cncjs-port");
const userInput = document.getElementById("cncjs-user");
const passInput = document.getElementById("cncjs-pass");
const serialInput = document.getElementById("cncjs-serial");
const cncjsStatus = document.getElementById("cncjs-status");
const btnDetect = document.getElementById("btn-cncjs-detect");
const btnSend = document.getElementById("btn-send-cncjs");

// ---- Persist settings ----

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(CNCJS_SETTINGS_KEY));
    if (!s) return;
    if (s.host) hostInput.value = s.host;
    if (s.port) portInput.value = s.port;
    if (s.user) userInput.value = s.user;
    if (s.serial) serialInput.value = s.serial;
    // password not persisted for security
  } catch {}
}

function saveSettings() {
  localStorage.setItem(CNCJS_SETTINGS_KEY, JSON.stringify({
    host: hostInput.value,
    port: portInput.value,
    user: userInput.value,
    serial: serialInput.value,
  }));
}

for (const el of [hostInput, portInput, userInput, serialInput]) {
  el.addEventListener("change", saveSettings);
}

// ---- Auth ----

async function getToken() {
  const base = `http://${hostInput.value}:${portInput.value}`;
  const resp = await fetch(`${base}/api/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: userInput.value, password: passInput.value }),
  });
  if (!resp.ok) throw new Error(`CNCjs signin failed (${resp.status})`);
  const data = await resp.json();
  // If auth is disabled, token is empty but API still works
  return data.token || "";
}

// ---- Detect controllers ----

btnDetect.addEventListener("click", async () => {
  cncjsStatus.textContent = "Detecting...";
  try {
    const token = await getToken();
    const base = `http://${hostInput.value}:${portInput.value}`;
    const url = token ? `${base}/api/controllers?token=${token}` : `${base}/api/controllers`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const controllers = await resp.json();

    if (controllers.length === 0) {
      cncjsStatus.textContent = "No controllers connected in CNCjs.";
      return;
    }

    // Auto-fill the first connected port
    const port = controllers[0].port;
    serialInput.value = port;
    saveSettings();
    cncjsStatus.textContent = `Found: ${controllers.map(c => c.port).join(", ")}`;
  } catch (e) {
    cncjsStatus.textContent = `Detection failed: ${e.message}`;
  }
});

// ---- Send G-code ----

btnSend.addEventListener("click", async () => {
  if (!state.gcodeText) {
    alert("No G-code generated yet.");
    return;
  }
  if (!serialInput.value) {
    alert("Please set the serial port in CNCjs Connection settings (or click Detect).");
    return;
  }

  btnSend.disabled = true;
  btnSend.textContent = "Sending...";
  setStatus("Sending G-code to CNCjs...");

  try {
    const token = await getToken();
    const base = `http://${hostInput.value}:${portInput.value}`;
    const url = token ? `${base}/api/gcode?token=${token}` : `${base}/api/gcode`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        port: serialInput.value,
        name: "plotforge-output.gcode",
        gcode: state.gcodeText,
        context: {},
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || err.error || `HTTP ${resp.status}`);
    }

    setStatus("G-code sent to CNCjs successfully");
    cncjsStatus.textContent = "Sent successfully!";
  } catch (e) {
    setStatus(`CNCjs error: ${e.message}`);
    cncjsStatus.textContent = `Send failed: ${e.message}`;
  } finally {
    btnSend.disabled = false;
    btnSend.textContent = "Send to CNCjs";
  }
});

// ---- Init ----

loadSettings();
