import "./js/ui.js";
import "./js/upload.js";
import "./js/generate.js";
import "./js/cncjs.js";
import { loadProfiles, loadTemplateVars } from "./js/config.js";
import { initViewer } from "./js/viewer.js";

loadProfiles();
loadTemplateVars();
initViewer();
