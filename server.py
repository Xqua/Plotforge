from __future__ import annotations

import copy
import io
import tempfile
import tomllib
from pathlib import Path

import vpype as vp
import vpype_cli
import vpype_gcode.gwrite  # noqa: F401 – registers gwrite command & loads bundled profiles
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="PlotForge")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PROFILE_KEYS_TEMPLATES = [
    "document_start",
    "document_end",
    "layer_start",
    "layer_end",
    "layer_join",
    "line_start",
    "line_end",
    "line_join",
    "segment_first",
    "segment",
    "segment_last",
]

PROFILE_KEYS_TRANSFORMS = [
    "unit",
    "scale_x",
    "scale_y",
    "offset_x",
    "offset_y",
    "invert_x",
    "invert_y",
    "horizontal_flip",
    "vertical_flip",
]

TEMPLATE_VARIABLES_DOCS = {
    "x": "Current X (float, output units)",
    "y": "Current Y (float, output units)",
    "dx": "Delta X from previous point",
    "dy": "Delta Y from previous point",
    "_x": "Negated X (-x)",
    "_y": "Negated Y (-y)",
    "_dx": "Negated delta X",
    "_dy": "Negated delta Y",
    "ix": "Integer-rounded X (accumulated)",
    "iy": "Integer-rounded Y (accumulated)",
    "idx": "Integer delta X",
    "idy": "Integer delta Y",
    "index": "Current index (0-based, context-dependent)",
    "index1": "Current index (1-based)",
    "segment_index": "Segment index within line (0-based)",
    "segment_index1": "Segment index within line (1-based)",
    "lines_index": "Line index within layer (0-based)",
    "lines_index1": "Line index within layer (1-based)",
    "layer_index": "Layer index (0-based)",
    "layer_index1": "Layer index (1-based)",
    "layer_id": "Layer integer ID",
    "filename": "Output file name",
}


def _get_bundled_profiles() -> dict:
    return {
        k: v
        for k, v in vp.config_manager.config.get("gwrite", {}).items()
        if isinstance(v, dict) and not k.startswith("_")
    }


# ---------------------------------------------------------------------------
# API Models
# ---------------------------------------------------------------------------


class ProfileSettings(BaseModel):
    # Templates
    document_start: str = ""
    document_end: str = ""
    layer_start: str = ""
    layer_end: str = ""
    layer_join: str = ""
    line_start: str = ""
    line_end: str = ""
    line_join: str = ""
    segment_first: str = ""
    segment: str = ""
    segment_last: str = ""
    # Transforms
    unit: str = "mm"
    scale_x: float = 1.0
    scale_y: float = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0
    invert_x: bool = False
    invert_y: bool = False
    horizontal_flip: bool = False
    vertical_flip: bool = False


class VpypeOptions(BaseModel):
    linemerge: bool = True
    linemerge_tolerance: float = 0.05  # mm
    linesimplify: bool = True
    linesimplify_tolerance: float = 0.05  # mm
    linesort: bool = True
    reloop: bool = True
    reloop_tolerance: float = 0.05  # mm


class GenerateRequest(BaseModel):
    svg_content: str
    profile: ProfileSettings
    vpype_options: VpypeOptions = VpypeOptions()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/profiles")
def list_profiles():
    """Return all bundled profile names and their settings."""
    profiles = _get_bundled_profiles()
    result = {}
    for name, cfg in profiles.items():
        entry = {}
        for k in PROFILE_KEYS_TEMPLATES + PROFILE_KEYS_TRANSFORMS:
            entry[k] = cfg.get(k, "")
        entry["info"] = cfg.get("info", "")
        result[name] = entry
    return result


@app.get("/api/template-variables")
def template_variables():
    return TEMPLATE_VARIABLES_DOCS


@app.post("/api/parse-profile")
async def parse_profile(file: UploadFile = File(...)):
    """Parse an uploaded TOML profile and return its settings as JSON."""
    try:
        raw = await file.read()
        data = tomllib.loads(raw.decode("utf-8"))

        # Accept both bare keys and [gwrite.name] wrapped profiles
        profile = data
        if "gwrite" in data:
            gwrite = data["gwrite"]
            # Pick the first (and likely only) profile inside [gwrite]
            for k, v in gwrite.items():
                if isinstance(v, dict):
                    profile = v
                    break

        result = {}
        for k in PROFILE_KEYS_TEMPLATES + PROFILE_KEYS_TRANSFORMS:
            if k in profile:
                result[k] = profile[k]
        if "info" in profile:
            result["info"] = profile["info"]

        return result
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@app.post("/api/upload-svg")
async def upload_svg(file: UploadFile = File(...)):
    content = await file.read()
    return {"filename": file.filename, "svg_content": content.decode("utf-8")}


@app.post("/api/generate")
def generate_gcode(req: GenerateRequest):
    """Generate G-code from SVG content using the given profile settings."""
    svg_tmp = None
    gcode_tmp = None
    try:
        # Write SVG to temp file
        with tempfile.NamedTemporaryFile(
            suffix=".svg", mode="w", delete=False
        ) as svg_f:
            svg_f.write(req.svg_content)
            svg_tmp = Path(svg_f.name)

        # Build custom profile dict
        profile_name = "_web_custom"
        profile_dict: dict = {}
        p = req.profile
        for key in PROFILE_KEYS_TEMPLATES:
            val = getattr(p, key, "")
            if val:
                profile_dict[key] = val
        profile_dict["unit"] = p.unit
        profile_dict["scale_x"] = p.scale_x
        profile_dict["scale_y"] = p.scale_y
        profile_dict["offset_x"] = p.offset_x
        profile_dict["offset_y"] = p.offset_y
        profile_dict["invert_x"] = p.invert_x
        profile_dict["invert_y"] = p.invert_y
        profile_dict["horizontal_flip"] = p.horizontal_flip
        profile_dict["vertical_flip"] = p.vertical_flip

        # Register profile into vpype config
        vp.config_manager.config.setdefault("gwrite", {})[profile_name] = profile_dict

        # Generate G-code
        with tempfile.NamedTemporaryFile(
            suffix=".gcode", mode="w", delete=False
        ) as gc_f:
            gcode_tmp = Path(gc_f.name)

        # Build vpype pipeline with optimization commands
        opts = req.vpype_options
        pipeline_parts = [f'read "{svg_tmp}"']
        if opts.linemerge:
            pipeline_parts.append(
                f"linemerge --tolerance {opts.linemerge_tolerance}mm"
            )
        if opts.linesort:
            pipeline_parts.append("linesort")
        if opts.reloop:
            pipeline_parts.append(
                f"reloop --tolerance {opts.reloop_tolerance}mm"
            )
        if opts.linesimplify:
            pipeline_parts.append(
                f"linesimplify --tolerance {opts.linesimplify_tolerance}mm"
            )
        pipeline_parts.append(f'gwrite -p {profile_name} "{gcode_tmp}"')
        pipeline = " ".join(pipeline_parts)

        vpype_cli.execute(pipeline)
        gcode_text = gcode_tmp.read_text()
        return {"gcode": gcode_text}

    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    finally:
        if svg_tmp:
            svg_tmp.unlink(missing_ok=True)
        if gcode_tmp:
            gcode_tmp.unlink(missing_ok=True)


@app.get("/")
def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")


def main():
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8080, reload=True)


if __name__ == "__main__":
    main()
