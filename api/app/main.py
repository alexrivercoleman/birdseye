from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import community_map, game, social, walks

app = FastAPI(title="Birdseye API")

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
