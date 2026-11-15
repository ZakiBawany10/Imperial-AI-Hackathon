"""BetaCrux API. The contract is in ../contract/ and ../Documents/PLAN.md.

Run:  ./run.sh    (port 8010; PORT=9000 ./run.sh to change)
"""
import io
import multiprocessing
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

import analyze as analyze_mod
import route

HERE = os.path.dirname(os.path.abspath(__file__))


# /solve runs in its own process: the grade model (LightGBM) and the detector
# (PyTorch) crash if they share one. See route._models.
_solver = None


def _solver_pool():
    global _solver
    if _solver is None:
        _solver = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
    return _solver


@asynccontextmanager
async def lifespan(app):
    # Start the solver process and load the detector in the background so the first calls are not slow.
    # BETACRUX_WARM=0 leaves the detector (about 2 GB) unloaded until the first /analyze.
    _solver_pool().submit(route.warm)
    if os.environ.get("BETACRUX_WARM", "1") != "0":
        threading.Thread(target=analyze_mod.warm, daemon=True).start()
    yield
    _solver_pool().shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="BetaCrux", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def no_stale_pages(request, call_next):
    # The demo pages and the viewer change often: tell browsers to check for a new copy every
    # time instead of reusing an old one (which left people running old code).
    response = await call_next(request)
    if request.url.path.startswith(("/demo", "/contract", "/hold-types")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(RequestValidationError)
async def bad_request(request, exc):
    # Same {"detail": "message"} shape as every other error, not FastAPI's list of objects.
    e = exc.errors()[0]
    where = ".".join(str(p) for p in e["loc"][1:])
    return JSONResponse({"detail": f"{where}: {e['msg']}" if where else e["msg"]}, status_code=422)


class ImageSize(BaseModel):
    w: int = Field(gt=0)
    h: int = Field(gt=0)


class Hold(BaseModel):
    model_config = ConfigDict(extra="allow")   # score, suggestions etc. are accepted and ignored
    id: int
    x: float
    y: float
    w: float = 0
    h: float = 0
    type: str = "unknown"
    quality: float = Field(0.5, ge=0, le=1)
    color: Optional[str] = None


class SolveRequest(BaseModel):
    image: ImageSize
    holds: list[Hold] = Field(min_length=1)
    start: list[int]
    finish: list[int]
    climber_height_m: float = Field(1.75, ge=1.4, le=2.1)      # strict: the body model is made for this range
    strength: float = Field(1.0, ge=0.6, le=1.5)               # grip strength; 1.0 = a regular gym climber
    wall_height_m: float = Field(4.0, gt=0.5, lt=30)
    wall_angle_deg: float = Field(0, ge=-20, le=70)
    limbs: Literal["all", "hands"] = "all"   # "hands": the original hands-only answer


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/hold-types")
def get_hold_types():
    return analyze_mod.hold_types()


@app.post("/analyze")
def post_analyze(file: UploadFile = File(...)):
    try:
        image = Image.open(io.BytesIO(file.file.read()))
        image.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "That file is not a photo this server can read (use JPEG or PNG).")
    return analyze_mod.analyze(image)


@app.post("/depth")
def post_depth(file: UploadFile = File(...)):
    """A relief map of the wall photo as a greyscale PNG: black is flat wall, white sticks out most."""
    import depth
    from fastapi.responses import Response
    try:
        image = Image.open(io.BytesIO(file.file.read()))
        image.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "That file is not a photo this server can read (use JPEG or PNG).")
    return Response(depth.relief_png(image), media_type="image/png")


@app.post("/solve")
def post_solve(req: SolveRequest):
    global _solver
    try:
        return _solver_pool().submit(route.solve, req.model_dump()).result(timeout=60)
    except route.RouteError as e:
        raise HTTPException(422, str(e))
    except BrokenProcessPool:
        _solver = None                      # the next request starts a fresh solver process
        raise HTTPException(503, "The solver restarted. Send the request again.")


# A plain test page at /demo/, and the contract example files it uses at /contract/.
app.mount("/demo", StaticFiles(directory=os.path.join(HERE, "demo"), html=True), name="demo")
app.mount("/contract", StaticFiles(directory=os.path.join(HERE, "..", "contract")), name="contract-examples")

# Example pictures for the hold database, at /hold-types/<id>.svg
app.mount("/hold-types", StaticFiles(directory=os.path.join(HERE, "hold_types")), name="hold-type-images")
