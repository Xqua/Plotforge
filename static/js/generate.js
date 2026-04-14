import { state, dom, setStatus } from "./state.js";
import { gatherSettings, gatherVpypeOptions } from "./config.js";
import { renderGcode } from "./viewer.js";

const btnCopy = document.getElementById("btn-copy-gcode");
const btnDownload = document.getElementById("btn-download-gcode");

// ---- Generate G-code ----

dom.btnGenerate.addEventListener("click", generateGcode);

async function generateGcode() {
  if (!state.svgContent) return;

  dom.btnGenerate.disabled = true;
  dom.btnGenerate.innerHTML = '<span class="spinner"></span> Generating...';
  setStatus("Generating G-code...");

  try {
    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        svg_content: state.svgContent,
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

    state.gcodeText = data.gcode;
    dom.gcodeOutput.value = state.gcodeText;

    const lines = state.gcodeText.split("\n").length;
    const bytes = new Blob([state.gcodeText]).size;
    dom.statusStats.textContent = `${lines} lines | ${(bytes / 1024).toFixed(1)} KB`;
    setStatus("G-code generated successfully");

    renderGcode(state.gcodeText);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  } finally {
    dom.btnGenerate.disabled = false;
    dom.btnGenerate.textContent = "Generate G-code";
  }
}

// ---- Copy & Download ----

btnCopy.addEventListener("click", () => {
  if (!state.gcodeText) return;
  navigator.clipboard.writeText(state.gcodeText);
  setStatus("Copied to clipboard");
});

btnDownload.addEventListener("click", () => {
  if (!state.gcodeText) return;
  const blob = new Blob([state.gcodeText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "output.gcode";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Downloaded output.gcode");
});
