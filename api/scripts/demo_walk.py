"""Run two fake walks through POST /walks → /track → /finish against the real DB and print the results.

    cd api
    python scripts/demo_walk.py            # run, print, delete the demo user
    python scripts/demo_walk.py --keep     # leave the data to browse in Supabase → Table Editor
    python scripts/demo_walk.py --cleanup  # delete every demo user (and their walks, via cascade)
    python scripts/demo_walk.py --audio    # real audio: fixture clips → 15 s .m4a chunks → POST /chunks → BirdNET

Default mode inserts detections/photos directly. --audio needs requirements-ml.txt and ffmpeg on PATH.
Mints a local HS256 token, so it never touches real users. Needs DATABASE_URL in api/.env.
"""

import os
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["SUPABASE_JWT_SECRET"] = "demo-walk-local-secret-at-least-32-bytes"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, storage  # noqa: E402
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
        paths = [r["storage_path"] for r in conn.execute(
            "select c.storage_path from audio_chunks c join walks w on w.id = c.walk_id"
            " join auth.users u on u.id = w.user_id where u.email like %s and c.storage_path is not null",
            (f"%@{EMAIL_DOMAIN}",))]
        photo_paths = [r["storage_path"] for r in conn.execute(
            "select p.storage_path from photos p join walks w on w.id = p.walk_id"
            " join auth.users u on u.id = w.user_id where u.email like %s and p.storage_path is not null",
            (f"%@{EMAIL_DOMAIN}",))]
    if paths:
        storage.client().storage.from_("audio-chunks").remove(paths)
    if photo_paths:
        storage.client().storage.from_("photos").remove(photo_paths)
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


def run_audio_walk(client: TestClient, headers: dict) -> str:
    """Upload real fixture audio as Safari-style AAC chunks; BirdNET produces the detections."""
    fixtures = Path(__file__).resolve().parents[2] / "scripts" / "fixtures"
    clips = [(fixtures / "carolina_wren.ogg", 0), (fixtures / "carolina_wren.ogg", 15),
             (fixtures / "northern_cardinal.mp3", 0), (fixtures / "northern_cardinal.mp3", 15)]
    walk_id = client.post("/walks", headers=headers).json()["walk_id"]
    t0 = datetime.now(timezone.utc) - timedelta(minutes=5)
    points = [{"t": (t0 + timedelta(seconds=15 * i)).isoformat(), "lat": PIEDMONT[1] + 0.0003 * i,
               "lng": PIEDMONT[0] + 0.0002 * i, "accuracy_m": 8} for i in range(len(clips) + 1)]
    client.post(f"/walks/{walk_id}/track", json={"points": points}, headers=headers).raise_for_status()
    with db.connect() as conn:
        conn.execute("update walks set started_at = %s where id = %s", (t0, walk_id))
    with tempfile.TemporaryDirectory() as tmp:
        for i, (src, offset) in enumerate(clips):
            m4a = Path(tmp) / f"{i}.m4a"
            subprocess.run([get_settings().ffmpeg_bin, "-v", "error", "-y", "-ss", str(offset), "-t", "15", "-i", str(src),
                            "-c:a", "aac", "-ac", "1", str(m4a)], check=True)
            r = client.post(f"/walks/{walk_id}/chunks", headers=headers,
                            files={"file": (m4a.name, m4a.read_bytes(), "audio/mp4")},
                            data={"chunk_index": i, "started_at": (t0 + timedelta(seconds=15 * i)).isoformat(),
                                  "duration_s": 15, "mime_type": "audio/mp4"})
            r.raise_for_status()
            print(f"   chunk {i}: {src.name} @{offset}s → {r.json()['chunk_id'][:8]}…")
    with db.connect() as conn:
        for d in conn.execute("select c.chunk_index, c.status, d.common_name, round(d.confidence::numeric, 2) conf,"
                              " d.is_anomaly, d.geog is not null located from audio_chunks c"
                              " left join detections d on d.chunk_id = c.id where c.walk_id = %s"
                              " order by c.chunk_index, d.detected_at", (walk_id,)):
            print(f"   chunk {d['chunk_index']} {d['status']:<9} {d['common_name'] or '-':<20} {d['conf'] or ''}"
                  f"{'  [anomaly]' if d['is_anomaly'] else ''}{'' if d['located'] or not d['common_name'] else '  (no geog)'}")
        stored = conn.execute("select count(*) n from storage.objects where bucket_id = 'audio-chunks'"
                              " and name like %s", (f"{walk_id}/%",)).fetchone()["n"]
    print(f"   {stored} chunk files in Storage")

    with tempfile.TemporaryDirectory() as tmp:  # a stand-in "bird photo": a solid green JPEG
        jpg = Path(tmp) / "bird.jpg"
        subprocess.run([get_settings().ffmpeg_bin, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=640x480",
                        "-frames:v", "1", str(jpg)], check=True)
        r = client.post(f"/walks/{walk_id}/photos", headers=headers, files={"file": ("bird.jpg", jpg.read_bytes(), "image/jpeg")},
                        data={"captured_at": (t0 + timedelta(seconds=40)).isoformat(),
                              "lat": PIEDMONT[1] + 0.0008, "lng": PIEDMONT[0] + 0.0005})
    photo_id = r.json()["photo_id"]
    photo = client.get(f"/photos/{photo_id}", headers=headers).json()
    print(f"   photo {photo_id[:8]}… {photo['status']}; suggestions: "
          f"{[x['common_name'] for x in photo['suggestions']]}; url: {'signed' if photo['url'] else None}")
    client.post(f"/photos/{photo_id}/confirm", headers=headers, json={"species_code": "carwre"}).raise_for_status()
    print("   confirmed photo as Carolina Wren")

    client.post(f"/walks/{walk_id}/finish", headers=headers).raise_for_status()
    return walk_id


def show_recap(client: TestClient, walk_id: str, headers: dict, who: str) -> None:
    r = client.get(f"/walks/{walk_id}", headers=headers).json()
    sp = [f"{x['common_name']} ({x['points']} pts, pin {'yes' if x['location'] else 'hidden'})" for x in r["species"]]
    print(f"\n== GET /walks/{{id}} as {who}: precise={r['precise']}, area={r['public_area_label']!r}, "
          f"route={'%d points' % len(r['route']) if r['route'] else None}")
    print(f"   species: {', '.join(sp)}")
    print(f"   photos: {[(x['status'], 'url' if x['url'] else None, 'pin' if x['location'] else 'hidden') for x in r['photos']]}")


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


def make_user(display_name: str) -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    token = jwt.encode({"sub": user_id, "aud": "authenticated", "exp": int(time.time()) + 600},
                       os.environ["SUPABASE_JWT_SECRET"], algorithm="HS256")
    with db.connect() as conn:
        conn.execute("insert into auth.users (id, email, aud, role) values (%s, %s, 'authenticated', 'authenticated')",
                     (user_id, f"{user_id[:8]}@{EMAIL_DOMAIN}"))
        conn.execute("insert into profiles (id, username, display_name) values (%s, %s, %s)",
                     (user_id, f"demo_{user_id[:8]}", display_name))
    return user_id, {"Authorization": f"Bearer {token}"}


def main() -> None:
    if "--cleanup" in sys.argv:
        cleanup()
        return
    get_settings.cache_clear()
    user_id, headers = make_user("Demo Walker")
    try:
        client = TestClient(app)
        if "--audio" in sys.argv:
            print("\n== Audio walk: uploading chunks")
            walk_id = run_audio_walk(client, headers)
            show(walk_id, "Audio walk after finish (tiers from eBird)")
            show_recap(client, walk_id, headers, "the owner")
            _, stranger = make_user("Demo Stranger")
            show_recap(client, walk_id, stranger, "a stranger (not a mutual follow)")
            return
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
