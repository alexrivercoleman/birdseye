import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import community_map, game, social, walks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


def _warm_up() -> None:
    """Load eBird taxonomy (if empty) and the BirdNET model off the request path."""
    try:
        from app.birds.ebird import ensure_taxonomy

        ensure_taxonomy()
    except Exception:
        log.exception("taxonomy load failed")
    try:
        from app.audio.birdnet import analyzer

        analyzer()
        log.info("BirdNET model loaded")
    except ImportError as e:
        log.warning("BirdNET unavailable (%s); install requirements-ml.txt", e)
    except Exception:
        log.exception("BirdNET load failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warm_up, daemon=True).start()
    yield


app = FastAPI(title="Birdseye API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (walks.router, social.router, game.router, community_map.router):
    app.include_router(r)


@app.get("/health")
async def health():
    return {"ok": True}
