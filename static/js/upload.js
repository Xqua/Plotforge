import { state, dom, setStatus } from "./state.js";
import { openWizardFromRasterFile } from "./preprocess.js";

const uploadZone = document.getElementById("upload-zone");
const fileInput = document.getElementById("file-input");
const uploadFilename = document.getElementById("upload-filename");
const svgPreview = document.getElementById("svg-preview");

const ACCEPTED_VECTOR = /\.svg$/i;
const ACCEPTED_RASTER = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

fileInput.accept = ".svg,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff";

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
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  if (ACCEPTED_VECTOR.test(file.name)) {
    handleSvgFile(file);
  } else if (ACCEPTED_RASTER.test(file.name)) {
    openWizardFromRasterFile(file);
  } else {
    setStatus(`Unsupported format: ${file.name}`);
    alert(`Unsupported file format. Accepted: SVG, PNG, JPG, JPEG, WEBP, BMP, TIFF.`);
  }
}

function handleSvgFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    state.svgContent = e.target.result;
    uploadFilename.textContent = file.name;
    showSvgPreview(state.svgContent);
    dom.btnGenerate.disabled = false;
    setStatus(`Loaded: ${file.name}`);
  };
  reader.readAsText(file);
}

/**
 * Called from preprocess.js after the wizard confirms a vectorized SVG.
 */
export function acceptSvgFromWizard(svg, sourceFilename) {
  state.svgContent = svg;
  uploadFilename.textContent = sourceFilename ? `${sourceFilename} (vectorized)` : "(vectorized)";
  showSvgPreview(svg);
  dom.btnGenerate.disabled = false;
  setStatus(`Vectorized: ${sourceFilename || "image"}`);
}

function showSvgPreview(svg) {
  svgPreview.classList.remove("empty");
  svgPreview.innerHTML = svg;
  const svgEl = svgPreview.querySelector("svg");
  if (svgEl) {
    if (!svgEl.hasAttribute("viewBox")) {
      const w = parseFloat(svgEl.getAttribute("width"));
      const h = parseFloat(svgEl.getAttribute("height"));
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

    if (svgEl.querySelectorAll("text").length > 0) {
      showTextWarning();
    }
  }
}

function showTextWarning() {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="dialog">
      <h3>Warning: SVG contains &lt;text&gt; elements</h3>
      <p>Text elements cannot be converted to G-code. They will be silently ignored during generation.</p>
      <p>Please convert all text to paths first (in Inkscape: select text, then <strong>Path &rarr; Object to Path</strong>).</p>
      <button class="btn btn-primary" id="dialog-dismiss">OK, understood</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("dialog-dismiss").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}
