import { state, dom, setStatus } from "./state.js";

const uploadZone = document.getElementById("upload-zone");
const fileInput = document.getElementById("file-input");
const uploadFilename = document.getElementById("upload-filename");
const svgPreview = document.getElementById("svg-preview");

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
    state.svgContent = e.target.result;
    uploadFilename.textContent = file.name;
    showSvgPreview(state.svgContent);
    dom.btnGenerate.disabled = false;
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
