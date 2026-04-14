// Accordion toggle (exposed globally for inline onclick in HTML)
window.toggleAccordion = function (header) {
  header.parentElement.classList.toggle("open");
};

// Bind a range slider to a value display element
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

// Optimization tolerance sliders
bindSlider("opt-linemerge-tol", "opt-linemerge-val");
bindSlider("opt-linesimplify-tol", "opt-linesimplify-val");
bindSlider("opt-reloop-tol", "opt-reloop-val");

// Toggle slider visibility when optimization checkbox changes
for (const name of ["linemerge", "linesimplify", "reloop"]) {
  const cb = document.getElementById(`opt-${name}`);
  const slider = document.getElementById(`opt-${name}-slider`);
  if (cb && slider) {
    const update = () => { slider.style.opacity = cb.checked ? "1" : "0.3"; };
    cb.addEventListener("change", update);
    update();
  }
}

// Feed rate / pen Z sliders rebuild G-code templates
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

for (const id of ["feed-cut", "feed-travel", "pen-down", "pen-up"]) {
  document.getElementById(id).addEventListener("input", rebuildTemplatesFromSliders);
}
