import time

import jwt
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

SECRET = "test-secret-at-least-32-bytes-long!!"


def _client(monkeypatch) -> TestClient:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    get_settings.cache_clear()
    return TestClient(app)


def _token(**overrides) -> str:
    claims = {"sub": "00000000-0000-0000-0000-000000000001", "aud": "authenticated", "exp": int(time.time()) + 60}
    return jwt.encode(claims | overrides, SECRET, algorithm="HS256")


def test_health(monkeypatch):
    assert _client(monkeypatch).get("/health").json() == {"ok": True}


def test_requires_auth(monkeypatch):
    assert _client(monkeypatch).get("/quests/me").status_code == 401


def test_rejects_wrong_audience(monkeypatch):
    r = _client(monkeypatch).get("/quests/me", headers={"Authorization": f"Bearer {_token(aud='anon')}"})
    assert r.status_code == 401


def test_recap_stub_shape(monkeypatch):
    r = _client(monkeypatch).get("/walks/abc", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200
    body = r.json()
    assert body["walk_id"] == "abc" and body["species"][0]["rarity_tier"] in {"common", "uncommon", "rare"}
