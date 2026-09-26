"""Run two fake walks through POST /walks → /track → /finish against the real DB and print the results.

    cd api
    python scripts/demo_walk.py            # run, print, delete the demo user
    python scripts/demo_walk.py --keep     # leave the data to browse in Supabase → Table Editor
    python scripts/demo_walk.py --cleanup  # delete every demo user (and their walks, via cascade)

Detections and photos are inserted directly (standing in for B's audio/photo pipelines).
Mints a local HS256 token, so it never touches real users. Needs DATABASE_URL in api/.env.
"""

import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["SUPABASE_JWT_SECRET"] = "demo-walk-local-secret-at-least-32-bytes"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

EMAIL_DOMAIN = "demo-walk.example.com"
PIEDMONT = (-84.3738, 33.7851)  # lng, lat

# (species_code, common_name, confidence, detections, is_anomaly)
HEARD = [
    ("carwre", "Carolina Wren", 0.93, 3, False),
    ("pilwoo", "Pileated Woodpecker", 0.80, 1, False),
    ("paibun", "Painted Bunting", 0.90, 1, True),
]


def cleanup() -> None:
    with db.connect() as conn:
        n = conn.execute("delete from auth.users where email like %s", (f"%@{EMAIL_DOMAIN}",)).rowcount
    print(f"deleted {n} demo user(s) and their walks")


def run_walk(client: TestClient, headers: dict, minutes_ago: int, photos: list[tuple[str, str]]) -> str:
    walk_id = client.post("/walks", headers=headers).json()["walk_id"]
    t0 = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    points = [
        {"t": (t0 + timedelta(seconds=15 * i)).isoformat(), "lat": PIEDMONT[1] + 0.0003 * i,
         "lng": PIEDMONT[0] + 0.0002 * i, "accuracy_m": 8}
        for i in range(20)
    ]
    client.post(f"/walks/{walk_id}/track", json={"points": points}, headers=headers).raise_for_status()

    with db.connect() as conn:
        conn.execute("update walks set started_at = %s where id = %s", (t0, walk_id))
        for code, name, conf, n, anomaly in HEARD:
            for k in range(n):
                conn.execute(
                    "insert into detections (walk_id, species_code, common_name, confidence, detected_at, geog,"
                    " is_anomaly, anomaly_reason) values (%s, %s, %s, %s, %s,"
                    " ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s, %s)",
                    (walk_id, code, name, conf - 0.01 * k, t0 + timedelta(minutes=k + 1),
                     PIEDMONT[0] + 0.001, PIEDMONT[1] + 0.001, anomaly,
                     "outside expected range/season" if anomaly else None),
                )
        for code, name in photos:
            conn.execute(
                "insert into photos (walk_id, captured_at, geog, status, species_code, suggestions) values"
                " (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, 'confirmed', %s,"
                " jsonb_build_array(jsonb_build_object('species_code', %s::text, 'common_name', %s::text,"
                " 'confidence', 0.8)))",
                (walk_id, t0 + timedelta(minutes=3), PIEDMONT[0] + 0.002, PIEDMONT[1] + 0.002, code, code, name),
            )

    # TestClient runs the BackgroundTask (the finish pipeline) before returning.
    client.post(f"/walks/{walk_id}/finish", headers=headers).raise_for_status()
    return walk_id


def show(walk_id: str, title: str) -> None:
    with db.connect() as conn:
        w = conn.execute(
            "select status, round(distance_m) distance_m, duration_s, species_count, points from walks where id = %s",
            (walk_id,),
        ).fetchone()
        species = conn.execute(
            "select common_name, rarity_tier, heard, photographed, points, is_anomaly from walk_species"
            " where walk_id = %s order by points desc, common_name",
            (walk_id,),
        ).fetchall()
        ledger = conn.execute(
            "select reason, amount from points_ledger where walk_id = %s order by amount desc", (walk_id,)
        ).fetchall()
    print(f"\n== {title}\n   walk {walk_id}")
    print(f"   {w['status']} · {w['distance_m']} m · {w['duration_s'] // 60} min · "
          f"{w['species_count']} species · {w['points']} pts")
    for s in species:
        how = "+".join(k for k in ("heard", "photographed") if s[k])
        flag = "  [anomaly]" if s["is_anomaly"] else ""
        print(f"   {s['points']:>4} pts  {s['common_name']:<22} {s['rarity_tier']:<8} {how}{flag}")
    print("   ledger:", ", ".join(f"{r['reason']} {r['amount']}" for r in ledger) or "(none)")


def main() -> None:
    if "--cleanup" in sys.argv:
        cleanup()
        return
    get_settings.cache_clear()
    user_id = str(uuid.uuid4())
    token = jwt.encode({"sub": user_id, "aud": "authenticated", "exp": int(time.time()) + 600},
                       os.environ["SUPABASE_JWT_SECRET"], algorithm="HS256")
    headers = {"Authorization": f"Bearer {token}"}
    with db.connect() as conn:
        conn.execute("insert into auth.users (id, email, aud, role) values (%s, %s, 'authenticated', 'authenticated')",
                     (user_id, f"{user_id[:8]}@{EMAIL_DOMAIN}"))
        conn.execute("insert into profiles (id, username, display_name) values (%s, %s, 'Demo Walker')",
                     (user_id, f"demo_{user_id[:8]}"))
    try:
        client = TestClient(app)
        w1 = run_walk(client, headers, minutes_ago=90, photos=[])
        show(w1, "Walk 1: heard only. Anomaly unconfirmed → 0 pts")
        w2 = run_walk(client, headers, minutes_ago=30, photos=[("paibun", "Painted Bunting"), ("blujay", "Blue Jay")])
        show(w2, "Walk 2, same day: repeats pay 0; photo-confirmed anomaly + photo-only Blue Jay pay")
    finally:
        if "--keep" in sys.argv:
            print(f"\nkept demo user demo_{user_id[:8]}. Browse walks / walk_species / points_ledger in "
                  "Supabase → Table Editor. Remove with: python scripts/demo_walk.py --cleanup")
        else:
            cleanup()


if __name__ == "__main__":
    main()
