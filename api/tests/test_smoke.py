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


def test_rejects_malformed_walk_id(monkeypatch):
    # validated before any DB access
    r = _client(monkeypatch).get("/walks/abc", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 422


def test_birds_seen_requires_auth(monkeypatch):
    response = _client(monkeypatch).get('/walks/00000000-0000-0000-0000-000000000002/seen')
    assert response.status_code == 401


def test_birds_seen_returns_saved_sightings(monkeypatch):
    from contextlib import nullcontext
    from unittest.mock import Mock
    from app.routers import walks

    conn = Mock()
    conn.execute.return_value.fetchone.return_value = {'id': 'walk', 'status': 'active'}
    conn.execute.return_value.fetchall.return_value = [{'code': 'carwre', 'name': 'Carolina Wren', 'count': 2}]
    monkeypatch.setattr(walks.db, 'connect', lambda: nullcontext(conn))
    response = _client(monkeypatch).get(
        '/walks/00000000-0000-0000-0000-000000000002/seen',
        headers={'Authorization': f'Bearer {_token()}'},
    )
    assert response.status_code == 200
    assert response.json() == [{'code': 'carwre', 'name': 'Carolina Wren', 'count': 2}]
    assert len(conn.execute.call_args_list) == 2
    assert "p.status = 'confirmed'" in conn.execute.call_args.args[0]


def test_birds_seen_rejects_other_users_walk(monkeypatch):
    from contextlib import nullcontext
    from unittest.mock import Mock
    from app.routers import walks

    conn = Mock()
    conn.execute.return_value.fetchone.return_value = None
    monkeypatch.setattr(walks.db, 'connect', lambda: nullcontext(conn))
    response = _client(monkeypatch).get(
        '/walks/00000000-0000-0000-0000-000000000002/seen',
        headers={'Authorization': f'Bearer {_token()}'},
    )
    assert response.status_code == 404
    conn.execute.assert_called_once()
