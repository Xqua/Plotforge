"""
Raster preprocessing pipeline: raw image -> grayscale -> contours -> binary PNG -> SVG.

Stateless endpoints: the client holds the original image as base64 and sends it
on every request. No session / no temp files on disk.
"""

from __future__ import annotations

import base64
import hashlib
import io
from collections import OrderedDict
from typing import Literal

import cv2
import numpy as np
import vtracer
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

router = APIRouter()

# Lazily-initialised rembg session (model download + load is slow).
_REMBG_SESSION = None

# Mask cache keyed on (sha1_of_resized_rgb, width, height).
# Holds the last few masks so that tweaking the blur radius does not trigger
# rembg inference again. Size 4 is enough for one wizard session.
_MASK_CACHE: "OrderedDict[tuple[str, int, int], np.ndarray]" = OrderedDict()
_MASK_CACHE_MAX = 4


def _get_rembg_session():
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        from rembg import new_session  # lazy import
        _REMBG_SESSION = new_session()
    return _REMBG_SESSION


def _cached_mask(rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    key = (hashlib.sha1(rgb.tobytes()).hexdigest(), w, h)
    if key in _MASK_CACHE:
        _MASK_CACHE.move_to_end(key)
        return _MASK_CACHE[key]

    from rembg import remove  # lazy import
    rgba = remove(rgb, session=_get_rembg_session())
    if rgba.ndim == 3 and rgba.shape[2] == 4:
        alpha = rgba[:, :, 3]
    else:
        alpha = np.full(rgb.shape[:2], 255, dtype=np.uint8)

    _MASK_CACHE[key] = alpha
    if len(_MASK_CACHE) > _MASK_CACHE_MAX:
        _MASK_CACHE.popitem(last=False)
    return alpha


def _apply_bg(bgr: np.ndarray, mode: str, blur_radius: int) -> np.ndarray:
    """Replace / blur the background based on a rembg alpha mask.

    mode = "none" -> unchanged.
    mode = "white" -> background replaced with solid white.
    mode = "blur"  -> background Gaussian-blurred (radius -> kernel = 2r+1).
    """
    if mode == "none":
        return bgr
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    alpha = _cached_mask(rgb)
    alpha_f = (alpha.astype(np.float32) / 255.0)[..., None]

    if mode == "white":
        white = np.full_like(rgb, 255)
        out_rgb = (alpha_f * rgb + (1.0 - alpha_f) * white).astype(np.uint8)
    elif mode == "blur":
        r = max(1, int(blur_radius))
        k = 2 * r + 1
        blurred = cv2.GaussianBlur(rgb, (k, k), 0)
        out_rgb = (alpha_f * rgb + (1.0 - alpha_f) * blurred).astype(np.uint8)
    else:
        return bgr

    return cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ImagePayload(BaseModel):
    image_b64: str
    max_dim: int = Field(default=720, ge=120, le=4096)
    bg_mode: Literal["none", "white", "blur"] = "none"
    bg_blur_radius: int = Field(default=15, ge=1, le=80)


class _BaseContourParams(BaseModel):
    blur_ksize: int = Field(default=5, ge=1, le=31)  # must be odd; coerced server-side
    invert: bool = True


class CannyAutoParams(_BaseContourParams):
    sigma: float = Field(default=0.33, ge=0.05, le=0.90)


class CannyStrongParams(_BaseContourParams):
    low: int = Field(default=100, ge=0, le=255)
    high: int = Field(default=200, ge=0, le=255)
    morph_close_ksize: int = Field(default=3, ge=0, le=15)


class AdaptiveThreshParams(_BaseContourParams):
    block_size: int = Field(default=11, ge=3, le=51)  # must be odd
    c_value: int = Field(default=2, ge=-20, le=40)


class ContoursAllRequest(ImagePayload):
    canny_auto: CannyAutoParams = CannyAutoParams()
    canny_strong: CannyStrongParams = CannyStrongParams()
    adaptive: AdaptiveThreshParams = AdaptiveThreshParams()


class ContourOneRequest(ImagePayload):
    variant: Literal["canny_auto", "canny_strong", "adaptive"]
    canny_auto: CannyAutoParams | None = None
    canny_strong: CannyStrongParams | None = None
    adaptive: AdaptiveThreshParams | None = None


class VectorizeRequest(BaseModel):
    png_b64: str
    filter_speckle: int = Field(default=4, ge=0, le=128)
    corner_threshold: int = Field(default=60, ge=0, le=180)
    length_threshold: float = Field(default=4.0, ge=0.0, le=20.0)
    splice_threshold: int = Field(default=45, ge=0, le=180)
    path_precision: int = Field(default=3, ge=0, le=10)
    mode: Literal["spline", "polygon"] = "spline"


# ---------------------------------------------------------------------------
# Codec helpers
# ---------------------------------------------------------------------------


def _strip_data_url(b64: str) -> str:
    if b64.startswith("data:"):
        _, _, payload = b64.partition(",")
        return payload
    return b64


def _decode_b64_to_cv2(b64: str) -> np.ndarray:
    """Decode a base64 (with or without data-URL prefix) to a BGR numpy image.

    RGBA inputs are composited onto a white background so transparent areas
    don't produce black artefacts in downstream edge detection.
    """
    raw = base64.b64decode(_strip_data_url(b64))
    pil = Image.open(io.BytesIO(raw))
    if pil.mode == "RGBA":
        bg = Image.new("RGB", pil.size, (255, 255, 255))
        bg.paste(pil, mask=pil.split()[3])
        pil = bg
    elif pil.mode != "RGB":
        pil = pil.convert("RGB")
    arr = np.asarray(pil)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _encode_cv2_to_b64_png(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _resize_max(img: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= max_dim:
        return img
    scale = max_dim / longest
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return cv2.resize(img, new_size, interpolation=cv2.INTER_AREA)


def _odd(n: int) -> int:
    n = int(n)
    return n if n % 2 == 1 else n + 1


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------


def _to_grayscale(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # Edge-preserving smoothing so fine texture doesn't get picked up by Canny.
    gray = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)
    return gray


def _blur(gray: np.ndarray, ksize: int) -> np.ndarray:
    k = max(1, _odd(ksize))
    if k <= 1:
        return gray
    return cv2.GaussianBlur(gray, (k, k), 0)


def _apply_canny_auto(gray: np.ndarray, p: CannyAutoParams) -> np.ndarray:
    blurred = _blur(gray, p.blur_ksize)
    v = float(np.median(blurred))
    low = int(max(0, (1.0 - p.sigma) * v))
    high = int(min(255, (1.0 + p.sigma) * v))
    edges = cv2.Canny(blurred, low, high)
    return _ensure_black_on_white(edges, p.invert)


def _apply_canny_strong(gray: np.ndarray, p: CannyStrongParams) -> np.ndarray:
    blurred = _blur(gray, p.blur_ksize)
    low = min(p.low, p.high)
    high = max(p.low, p.high)
    edges = cv2.Canny(blurred, low, high)
    if p.morph_close_ksize > 0:
        k = _odd(p.morph_close_ksize)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    return _ensure_black_on_white(edges, p.invert)


def _apply_adaptive(gray: np.ndarray, p: AdaptiveThreshParams) -> np.ndarray:
    blurred = _blur(gray, p.blur_ksize)
    block = _odd(max(3, p.block_size))
    # THRESH_BINARY_INV -> pixels darker than local mean become white (foreground).
    thresh = cv2.adaptiveThreshold(
        blurred,
        maxValue=255,
        adaptiveMethod=cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        thresholdType=cv2.THRESH_BINARY_INV,
        blockSize=block,
        C=p.c_value,
    )
    return _ensure_black_on_white(thresh, p.invert)


def _ensure_black_on_white(binary: np.ndarray, invert: bool) -> np.ndarray:
    """Normalize to black strokes on white background when invert=True."""
    # At this point `binary` has white (255) = foreground strokes.
    if invert:
        return cv2.bitwise_not(binary)
    return binary


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/grayscale")
def grayscale(payload: ImagePayload):
    try:
        bgr = _decode_b64_to_cv2(payload.image_b64)
        bgr = _resize_max(bgr, payload.max_dim)
        bgr = _apply_bg(bgr, payload.bg_mode, payload.bg_blur_radius)
        gray = _to_grayscale(bgr)
        h, w = gray.shape[:2]
        return {
            "png_b64": _encode_cv2_to_b64_png(gray),
            "width": w,
            "height": h,
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@router.post("/contours")
def contours_all(req: ContoursAllRequest):
    try:
        bgr = _decode_b64_to_cv2(req.image_b64)
        bgr = _resize_max(bgr, req.max_dim)
        bgr = _apply_bg(bgr, req.bg_mode, req.bg_blur_radius)
        gray = _to_grayscale(bgr)
        h, w = gray.shape[:2]
        return {
            "canny_auto": _encode_cv2_to_b64_png(_apply_canny_auto(gray, req.canny_auto)),
            "canny_strong": _encode_cv2_to_b64_png(_apply_canny_strong(gray, req.canny_strong)),
            "adaptive": _encode_cv2_to_b64_png(_apply_adaptive(gray, req.adaptive)),
            "width": w,
            "height": h,
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@router.post("/contour")
def contour_one(req: ContourOneRequest):
    try:
        bgr = _decode_b64_to_cv2(req.image_b64)
        bgr = _resize_max(bgr, req.max_dim)
        bgr = _apply_bg(bgr, req.bg_mode, req.bg_blur_radius)
        gray = _to_grayscale(bgr)
        if req.variant == "canny_auto":
            p = req.canny_auto or CannyAutoParams()
            out = _apply_canny_auto(gray, p)
        elif req.variant == "canny_strong":
            p = req.canny_strong or CannyStrongParams()
            out = _apply_canny_strong(gray, p)
        elif req.variant == "adaptive":
            p = req.adaptive or AdaptiveThreshParams()
            out = _apply_adaptive(gray, p)
        else:
            return JSONResponse(status_code=400, content={"error": f"unknown variant: {req.variant}"})
        return {"png_b64": _encode_cv2_to_b64_png(out)}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@router.post("/vectorize")
def vectorize(req: VectorizeRequest):
    try:
        png_bytes = base64.b64decode(_strip_data_url(req.png_b64))
        svg_str = vtracer.convert_raw_image_to_svg(
            png_bytes,
            img_format="png",
            colormode="binary",
            hierarchical="stacked",
            mode=req.mode,
            filter_speckle=req.filter_speckle,
            color_precision=6,
            layer_difference=16,
            corner_threshold=req.corner_threshold,
            length_threshold=req.length_threshold,
            max_iterations=10,
            splice_threshold=req.splice_threshold,
            path_precision=req.path_precision,
        )
        return {
            "svg_content": svg_str,
            "path_count": svg_str.count("<path"),
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
