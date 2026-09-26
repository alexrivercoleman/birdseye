"""Demo seed (§11): wipes the test walks and fills the database with ~5 weeks of Atlanta birding by 12 fake birders,
plus the presenter's account set up for the live demo.

    cd api
    .venv/Scripts/python ../scripts/seed/bird_photos.py          # once: download the Wikimedia bird photos
    .venv/Scripts/python ../scripts/seed/demo_seed.py            # WIPES every walk, then seeds everything
    .venv/Scripts/python ../scripts/seed/demo_seed.py --me-only  # reset just the presenter (after a rehearsal)
    .venv/Scripts/python ../scripts/seed/demo_seed.py --summaries 25   # AI species summaries for the newest walks
    .venv/Scripts/python ../scripts/seed/demo_seed.py --tech-extras    # just add TECH_EXTRAS (no wipe; run once)

What it writes (all through the same finish-pipeline steps a real walk goes through, so recaps look real):
- 12 birders (emails @seed.birdseye.app, password SEED_PASSWORD) with bird-photo avatars and bios. Everyone follows
  the presenter; the presenter follows some of them back (mutual = friends = routes visible) and not others, so
  there's someone to follow on stage.
- Walks on the real OSM trails of the sample-map spots (heavier around Georgia Tech), with track points, detections,
  confirmed photos, points, public area labels, recap text, chirps, comments, replies and comment likes.
- Rare birds: RARITIES, at most one per spot, spaced across the metro (checked against the sample map's anomalies,
  since the web app draws both). Bounties for the recent ones, fuzzed anomalies for the out-of-range ones.
- The presenter (DEMO_USERNAME): history, level, 4 of 5 nests filled this month, and this week's quests almost
  done: woodpeckers 2/3, trail miles ~4.5/5, and "Photograph a Brown Thrasher" left open to complete live.
  Claiming it lays the 5th egg, which brings up the big egg.

Walk times are relative to now, so re-run it the morning of the demo for a fresh feed.
"""

import io
import json
import math
import random
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageOps  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

import sample_map as sm  # noqa: E402
from app import db, storage  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.game import finish, quests  # noqa: E402
from app.game.scoring import apply_walk_scores  # noqa: E402
from bird_photos import photos_by_species  # noqa: E402

SEED_DOMAIN = "seed.birdseye.app"
SEED_PASSWORD = "birdseye-demo-2026"
DEMO_USERNAME = "d2birder"
WEEKS = 5
EDT = timedelta(hours=-4)
MIN_RARE_SPACING_M = 3000
MIN_SPECIES = 7
NOW = datetime.now(timezone.utc)
rng = random.Random(20260927)

# username, display name, bio, avatar species, home spots, walks per week, presenter follows them
BIRDERS = [
    ("gt_birdclub", "GT Birding Club", "Georgia Tech's birding club. Campus walks Wednesdays + Saturdays, all levels welcome, binoculars to borrow.",
     "perfal", ["Georgia Tech", "Piedmont Park"], 2.5, True),
    ("tech_tanager", "Priya Raman", "ChBE '27. I bird between classes. Summer Tanager supremacy.",
     "sumtan", ["Georgia Tech", "Piedmont Park", "BeltLine Eastside"], 2.5, True),
    ("mara_warbles", "Mara Okafor", "Fall warblers or bust. Kennesaw every weekend in September.",
     "btnwar", ["Kennesaw Mountain", "Morningside Nature Preserve"], 2, True),
    ("heron_hannah", "Hannah Liu", "Wading birds, mudflats, and a very patient spouse. Constitution Lakes regular.",
     "grbher3", ["Constitution Lakes", "Cochran Shoals", "Sweetwater Creek"], 1.5, True),
    ("owl_prowl", "Marcus Bell", "Out before sunrise listening for Barred Owls. Sweetwater + Kennesaw.",
     "brdowl", ["Sweetwater Creek", "Kennesaw Mountain"], 1.5, False),
    ("beltline_birds", "Devon Price", "Birding the BeltLine on my commute. You'd be amazed what's in the kudzu.",
     "normoc", ["BeltLine Eastside", "BeltLine Westside", "Georgia Tech"], 2, True),
    ("chattahoochee_jo", "Jo Whitfield", "River trails, kingfishers, and too many photos of herons.",
     "belkin1", ["Cochran Shoals", "Sweetwater Creek"], 1.5, False),
    ("wrenegade", "Eli Brooks", "Carolina Wren appreciator. Lullwater and Piedmont most mornings.",
     "carwre", ["Lullwater Preserve", "Piedmont Park", "BeltLine Eastside"], 2, True),
    ("kinglet_kate", "Kate Nguyen", "Emory postdoc, weekend birder. Lullwater and Fernbank Forest.",
     "cedwax", ["Fernbank Forest", "Lullwater Preserve"], 1.5, False),
    ("grandpa_gus", "Gus Andersen", "40 years of birding Georgia. Still learning something every walk.",
     "pilwoo", ["Murphey Candler Park", "Blue Heron Nature Preserve", "Kennesaw Mountain"], 1.5, True),
    ("nightjar_nia", "Nia Carter", "Blue Heron Nature Preserve volunteer. Ask me about the nest boxes.",
     "easblu", ["Blue Heron Nature Preserve", "Piedmont Park"], 1.5, False),
    ("sparrowsam", "Sam Ortiz", "Granite outcrops and grassland birds. Arabia + Stone Mountain.",
     "indbun", ["Arabia Mountain", "Stone Mountain"], 1.5, False),
]

# The rare birds on the map, besides the sample map's anomalies (sample_map.ANOMALIES). One per spot; bounties
# must be < 7 days old to be active. finder, code, spot, days ago, kind, photographed[, (lng, lat) to put it near]
RARITIES = [
    ("gt_birdclub", "perfal", "Georgia Tech", 2, "bounty", True),
    ("grandpa_gus", "limpki", "Murphey Candler Park", 9, "anomaly", True),
    ("beltline_birds", "swtkit", "BeltLine Westside", 16, "anomaly", True, (-84.435, 33.733)),  # away from GT
    ("wrenegade", "bkbcuc", "Lullwater Preserve", 3, "bounty", False),
    ("sparrowsam", "olsfly", "Stone Mountain", 1, "bounty", True),
    ("kinglet_kate", "merlin", "Fernbank Forest", 5, "bounty", True),
    ("mara_warbles", "cerwar", "Kennesaw Mountain", 2, "bounty", True),
    ("nightjar_nia", "conwar", "Blue Heron Nature Preserve", 6, "bounty", False),
]
RARE_TIER = {"perfal": "rare", "bkbcuc": "rare", "olsfly": "rare", "merlin": "rare",
             "cerwar": "rare", "conwar": "rare"}
ANOMALY_REASON = sm.REASON

# presenter: (spot, weeks ago (0 = this week), weekday Mon=0, local hour, target km)
DEMO_WALKS = [
    ("Georgia Tech", 5, 5, 8, 2.5), ("Piedmont Park", 4, 6, 9, 3.2), ("Georgia Tech", 4, 2, 17, 2.0),
    ("BeltLine Eastside", 3, 5, 8, 3.5), ("Lullwater Preserve", 3, 1, 18, 2.4), ("Georgia Tech", 2, 3, 7, 2.2),
    ("Piedmont Park", 2, 6, 10, 3.6), ("Kennesaw Mountain", 1, 5, 8, 4.5), ("Georgia Tech", 1, 2, 17, 2.1),
    # this week: ~4.5 trail miles, Red-bellied + Downy Woodpecker, no Brown Thrasher photo
    ("Georgia Tech", 0, 1, 8, 3.4), ("Piedmont Park", 0, 3, 17, 3.9),
]
THIS_WEEK_WOODPECKERS = {"rebwoo", "dowwoo"}

# A few hand-picked birds on the trails in and right next to Georgia Tech, which the random walks mostly miss.
# birder, trail group id (OSM), days ago, local hour, km, species heard; UNUSUAL is tiered rare but isn't a bounty
TECH_EXTRAS = [
    ("gt_birdclub", 9245986, 3, 19.2, 1.2, ("chiswi", "normoc", "carwre", "houfin", "comnig")),  # Atlantic Dr + Binary Bridge
    ("tech_tanager", 1391965560, 1, 7.6, 1.8, ("sumtan", "brnthr", "grycat", "easpho")),  # Westside Spur Trail
]
UNUSUAL = {"comnig"}  # Common Nighthawk: fall migrants over Midtown at dusk
PAST_QUEST_REWARDS = [150, 100, 75, 100]  # the 4 claims that filled this month's first 4 nests

RECAPS = [
    "{time} loop around {area}. {top0} set the tone early, and {top1} kept showing up the whole way. {n} species, not bad at all.",
    "Quiet start at {area}, then everything woke up at once. {top0}, {top1}, and {top2} all within ten minutes. {n} species total.",
    "{n} species on a {mood} {time_l} walk at {area}. Highlight: {top0}. Honorable mention to {top1} for singing nonstop.",
    "Slow walk at {area}, mostly listening. {top0} and {top1} carried the soundtrack. {n} species for the list.",
    "{area} delivered again: {n} species, with {top0} the star. {top1} and {top2} made it a great {time_l}.",
    "Took the long way around {area}. {top0} was the first bird heard and {top1} the last. {n} species in between.",
]
RARE_RECAPS = [
    "Stopped in my tracks at {area}: a {rare}! Got it {how}. Also {n} species including {top0} and {top1}. What a walk.",
    "Not every day you find a {rare} at {area}. {how_cap}, then the usual crew: {top0}, {top1}, and friends. {n} species.",
]
COMMENTS = [
    "Great list!", "Love this spot", "Nice walk! 🐦", "Jealous, I was stuck inside all day",
    "Need to get out to {area} this weekend", "That {bird} photo is gorgeous", "{bird}! Nice",
    "How was the trail? Muddy after the rain?", "Such a good morning for it", "Adding {area} to my list",
    "Heard a {bird} there last week too", "The {bird} has been so reliable lately",
    "Beautiful shot 😍", "Wow, {n} species!", "This app makes me want to walk more lol",
]
RARE_COMMENTS = [
    "A {rare}?! Heading there tomorrow morning", "Wait, {rare} at {area}??", "Congrats on the {rare}!! 🎉",
    "Chasing this after work", "That {rare} is a lifer for me, any tips on where exactly?", "Incredible find",
]
REPLIES = [
    "Thanks!", "Go early, it's quieter", "Right past the second bridge", "Come with next time!",
    "Haha it was worth it", "Appreciate it 🙌", "Near the big oak by the creek", "It was calling for like 10 minutes straight",
]


# ---- helpers ---------------------------------------------------------------

def hav(a: tuple[float, float], b: tuple[float, float]) -> float:
    """meters between (lng, lat) points"""
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def fuzz(lng: float, lat: float) -> tuple[float, float]:
    bearing, dist = rng.uniform(0, 2 * math.pi), rng.uniform(100, 200)
    return (lng + dist * math.sin(bearing) / (111_320 * math.cos(math.radians(lat))),
            lat + dist * math.cos(bearing) / 111_320)


def point(lng: float, lat: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


def local_time(days_ago: int, hour: float) -> datetime:
    """UTC instant of the given local (EDT) hour, days_ago days before today (local)."""
    today = (NOW + EDT).date()
    d = today - timedelta(days=days_ago)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(hours=hour) - EDT


def load_lines() -> dict[str, list[list[tuple[float, float]]]]:
    """Per spot: the longest merged line of each of its trail groups (≥ 400 m), as [(lng, lat)]."""
    spot_trails = sm.load_trails()
    groups = {t["group_id"]: spot for spot, ts in spot_trails.items() for t in ts}
    out: dict[str, list] = defaultdict(list)
    with db.connect() as conn:
        rows = conn.execute(
            "select group_id, ST_AsGeoJSON(ST_LineMerge(ST_Collect(geom::geometry)), 6)::json as g"
            " from trails where group_id = any(%s) group by group_id",
            (list(groups),),
        ).fetchall()
    for r in rows:
        g = r["g"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        best = max(lines, key=lambda ln: sum(hav(a, b) for a, b in zip(ln, ln[1:])))
        if sum(hav(a, b) for a, b in zip(best, best[1:])) >= 400:
            out[groups[r["group_id"]]].append([tuple(p) for p in best])
    return out


def route_along(line: list[tuple[float, float]], target_m: float) -> list[tuple[float, float]]:
    """A walk of ~target_m along the line: a stretch of it, or out and back if it's short. Resampled every ~12 m
    with a little GPS jitter."""
    if rng.random() < 0.5:
        line = line[::-1]
    cum = [0.0]
    for a, b in zip(line, line[1:]):
        cum.append(cum[-1] + hav(a, b))
    total = cum[-1]

    def at(d: float) -> tuple[float, float]:
        d = max(0.0, min(total, d))
        i = max(0, min(len(cum) - 2, next((k for k in range(1, len(cum)) if cum[k] >= d), len(cum) - 1) - 1))
        seg = cum[i + 1] - cum[i] or 1
        t = (d - cum[i]) / seg
        return (line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t)

    if total >= target_m:
        start = rng.uniform(0, total - target_m)
        dists = [start + x for x in frange(target_m)]
    else:
        out_m = min(total, target_m / 2)
        start = rng.uniform(0, total - out_m)
        dists = [start + x for x in frange(out_m)] + [start + out_m - x for x in frange(out_m)]
    return [(p[0] + rng.gauss(0, 0.00002), p[1] + rng.gauss(0, 0.00002)) for p in map(at, dists)]


def frange(length: float, step: float = 12.0) -> list[float]:
    n = max(2, int(length / step))
    return [length * i / n for i in range(n + 1)]


def pick_species(spot: str, when: datetime, exclude: set[str] = frozenset()) -> list[tuple[str, str, str]]:
    """(code, name, tier) heard on one walk, from the sample map's habitat/season model; at least MIN_SPECIES."""
    habitat = next(s[2] for s in sm.SPOTS if s[0] == spot)
    odds = []
    for code, name, tier, sh, chance, kind in sm.SPECIES:
        if code in exclude or (code in sm.KENNESAW_ONLY and spot != "Kennesaw Mountain") or tier == "rare":
            continue
        fit = max(x * y for x, y in zip(habitat, sh))
        boost = sm.MIGRANT_TRAP.get(spot, 1) if kind == "mig" else 1
        odds.append(((code, name, tier), min(0.95, 1.4 * chance * fit ** 1.8 * sm.season(kind, when.date()) * boost)))
    out = [sp for sp, p in odds if rng.random() < p]
    want = rng.randint(MIN_SPECIES, MIN_SPECIES + 4)
    for sp, _ in sorted(odds, key=lambda o: -o[1] * rng.uniform(0.6, 1)):
        if len(out) >= want:
            break
        if sp not in out:
            out.append(sp)
    return out


class Photos:
    """Hands out the cached photos round-robin per species, uploading one copy per photo row."""

    def __init__(self) -> None:
        self.files = photos_by_species()
        self.next: dict[str, int] = defaultdict(int)

    def has(self, code: str) -> bool:
        return code in self.files

    def upload(self, code: str, walk_id: str, photo_id: str) -> str:
        files = self.files[code]
        f = files[self.next[code] % len(files)]
        self.next[code] += 1
        path = f"{walk_id}/{photo_id}.jpg"
        storage.upload("photos", path, f.read_bytes(), "image/jpeg")
        return path


# ---- wipe --------------------------------------------------------------------

def wipe_all() -> None:
    with db.connect() as conn:
        n = conn.execute("select count(*) as n from walks").fetchone()["n"]
        conn.execute("delete from walks")  # cascades track points, detections, photos, species, chirps, comments, ledger
        conn.execute("delete from points_ledger")
        conn.execute("delete from user_quests")
        conn.execute("delete from quest_nests")
        conn.execute("delete from nest_hatches")
        conn.execute("delete from bounties")
        seeded = [r["id"] for r in conn.execute("select id from auth.users where email like %s", (f"%@{SEED_DOMAIN}",))]
    print(f"wiped {n} walks and all game state; deleting {len(seeded)} seeded users")
    for uid in seeded:
        storage.client().auth.admin.delete_user(str(uid))


def wipe_user(user_id: str) -> None:
    with db.connect() as conn:
        conn.execute("delete from bounties where source_user_id = %s", (user_id,))
        conn.execute("delete from walks where user_id = %s", (user_id,))
        for t in ("points_ledger", "user_quests", "quest_nests", "nest_hatches"):
            conn.execute(f"delete from {t} where user_id = %s", (user_id,))


# ---- users -------------------------------------------------------------------

def avatar(user_id: str, code: str, photos: Photos) -> str:
    im = ImageOps.fit(Image.open(photos.files[code][0]).convert("RGB"), (256, 256), centering=(0.5, 0.45))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    path = f"{user_id}/avatar.jpg"
    storage.client().storage.from_("avatars").upload(path, buf.getvalue(),
                                                     {"content-type": "image/jpeg", "upsert": "true"})
    return f"{get_settings().supabase_url}/storage/v1/object/public/avatars/{path}"


def create_birders(photos: Photos) -> dict[str, str]:
    ids = {}
    admin = storage.client().auth.admin
    for username, display, bio, av, *_ in BIRDERS:
        res = admin.create_user({"email": f"{username}@{SEED_DOMAIN}", "password": SEED_PASSWORD,
                                 "email_confirm": True})
        uid = res.user.id
        with db.connect() as conn:
            conn.execute(
                "insert into profiles (id, username, display_name, bio, avatar_url, created_at)"
                " values (%s, %s, %s, %s, %s, %s)",
                (uid, username, display, bio, avatar(uid, av, photos), NOW - timedelta(days=rng.randint(60, 200))),
            )
        ids[username] = uid
    print(f"created {len(ids)} birders")
    return ids


# ---- walks -------------------------------------------------------------------

class Seeder:
    def __init__(self) -> None:
        self.lines = load_lines()
        self.photos = Photos()
        with db.connect() as conn:
            self.tax = {r["species_code"]: r for r in conn.execute(
                "select species_code, common_name, sci_name, family_com_name from ebird_taxonomy")}
        self.labels: dict[tuple, str | None] = {}
        self.walks: list[dict] = []  # for the social pass

    def walk(self, user_id: str, spot: str, started: datetime, target_km: float, *, exclude=frozenset(),
             force: tuple[str, ...] = (), rare: tuple | None = None, photo_bias: float = 0.75,
             longest: bool = False, near: tuple[float, float] | None = None,
             line: list[tuple[float, float]] | None = None, only: tuple[str, ...] = ()) -> dict | None:
        if not line:
            lines = self.lines.get(spot)
            if not lines:
                return None
            if near:
                line = min(lines, key=lambda ln: min(hav(p, near) for p in ln))
            elif longest:
                line = max(lines, key=lambda ln: sum(hav(a, b) for a, b in zip(ln, ln[1:])))
            else:
                line = rng.choice(lines)
        route = route_along(line, target_km * 1000)
        speed = rng.uniform(0.7, 1.05)  # birders dawdle
        times = [0.0]
        for a, b in zip(route, route[1:]):
            times.append(times[-1] + hav(a, b) / speed)
        ended = started + timedelta(seconds=times[-1])
        if ended > NOW - timedelta(minutes=20):
            return None
        tier_of = {c: t for c, _, t, *_ in sm.SPECIES}
        heard = ([(c, self.tax[c]["common_name"], "rare" if c in UNUSUAL else tier_of.get(c, "common")) for c in only]
                 if only else pick_species(spot, started, exclude))
        have = {c for c, *_ in heard}
        for code in force:
            if code not in have:
                heard.append((code, self.tax[code]["common_name"], "common"))
        tiers = {c: t for c, _, t in heard}

        walk_id = str(uuid.uuid4())
        with db.connect() as conn:
            conn.execute(
                "insert into walks (id, user_id, status, started_at, ended_at, created_at)"
                " values (%s, %s, 'processing', %s, %s, %s)",
                (walk_id, user_id, started, ended, started),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into track_points (walk_id, recorded_at, geog, accuracy_m) values (%s, %s, %s, %s)",
                    [(walk_id, started + timedelta(seconds=t), point(*p), round(rng.uniform(4, 14), 1))
                     for p, t in zip(route, times)],
                )
            dets, first_det = [], {}
            for code, _, _ in heard:
                for _ in range(rng.choice([1, 1, 2, 2, 3, 4])):
                    i = rng.randrange(len(route))
                    dets.append((code, i))
            if rare:
                rcode, kind, _ = rare
                i = (min(range(len(route)), key=lambda k: hav(route[k], near)) if near
                     else rng.randrange(len(route) // 4, 3 * len(route) // 4))
                dets += [(rcode, i), (rcode, min(len(route) - 1, i + 2))]
                tiers[rcode] = "rare"
            rows = []
            for code, i in dets:
                did = str(uuid.uuid4())
                anomaly = bool(rare and code == rare[0] and rare[1] == "anomaly")
                conf = rng.uniform(0.86, 0.95) if anomaly else rng.uniform(0.62, 0.97)
                t = self.tax[code]
                rows.append((did, walk_id, code, t["common_name"], t["sci_name"], round(conf, 3),
                             started + timedelta(seconds=times[i] + rng.uniform(0, 5)), point(*route[i]), anomaly,
                             ANOMALY_REASON if anomaly else None))
                first_det.setdefault(code, (did, i))
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into detections (id, walk_id, species_code, common_name, sci_name, confidence,"
                    " detected_at, geog, is_anomaly, anomaly_reason) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    rows,
                )

            # photos: the walk's most photogenic birds (rarer first), plus the rare bird when photographed
            shots = []
            if rare and rare[2] and self.photos.has(rare[0]):
                shots.append(rare[0])
            if rng.random() < photo_bias:
                pool = [c for c, *_ in sorted(heard, key=lambda h: (h[2] != "uncommon", rng.random()))
                        if self.photos.has(c) and c not in shots and c not in exclude]
                shots += pool[:rng.choice([1, 1, 2, 2, 3])]
            for code in shots:
                pid = str(uuid.uuid4())
                i = first_det[code][1]
                t = self.tax[code]
                path = self.photos.upload(code, walk_id, pid)
                lng, lat = route[i]
                conn.execute(
                    "insert into photos (id, walk_id, captured_at, geog, storage_path, suggestions, species_code,"
                    " status) values (%s, %s, %s, %s, %s, %s, %s, 'confirmed')",
                    (pid, walk_id, started + timedelta(seconds=times[i] + 20),
                     point(lng + rng.gauss(0, 0.00003), lat + rng.gauss(0, 0.00003)), path,
                     Jsonb([{"species_code": code, "common_name": t["common_name"],
                             "confidence": round(rng.uniform(0.82, 0.97), 2)}]), code),
                )

            walk = {"id": walk_id, "user_id": user_id, "status": "processing", "started_at": started,
                    "ended_at": ended}
            stats = finish._compute_stats(conn, walk)
            finish._build_walk_species(conn, walk_id)
            with conn.cursor() as cur:
                cur.executemany(
                    "update walk_species set rarity_tier = %s where walk_id = %s and species_code = %s",
                    [(RARE_TIER.get(c, tier), walk_id, c) for c, tier in tiers.items()],
                )
            conn.execute("update walk_species set rarity_tier = 'rare' where walk_id = %s and is_anomaly", (walk_id,))
            apply_walk_scores(conn, walk, stats["centroid"])
            self._area(conn, walk_id, stats, spot)
            finish._complete(conn, walk, stats)
            conn.execute("update points_ledger set created_at = %s where walk_id = %s", (ended, walk_id))

            info = conn.execute(
                "select public_area_label as area, species_count as n, points from walks where id = %s", (walk_id,)
            ).fetchone()
            top = [r["common_name"] for r in conn.execute(
                "select common_name from walk_species where walk_id = %s and not is_anomaly"
                " order by (rarity_tier = 'uncommon') desc, photographed desc, detection_count desc", (walk_id,))]
            w = {"id": walk_id, "user_id": user_id, "ended": ended, "started": started, "spot": spot,
                 "area": info["area"] or spot, "n": info["n"], "top": top, "photos": shots,
                 "rare": (self.tax[rare[0]]["common_name"], rare) if rare else None,
                 "rare_det": first_det.get(rare[0]) if rare else None, "route": route}
            conn.execute("update walks set recap_text = %s where id = %s", (recap_text(w), walk_id))
        self.walks.append(w)
        return w

    def _area(self, conn, walk_id: str, stats: dict, spot: str) -> None:
        """Snapped public point as usual; label "<spot>, <city>" (the reverse geocode's city), e.g.
        "Piedmont Park, Atlanta", which reads better on a card than a bare "Atlanta"."""
        lng, lat = stats["centroid"]
        conn.execute(
            "update walks set public_area_geog = ST_SnapToGrid(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 0.02)::geography"
            " where id = %s", (lng, lat, walk_id))
        key = (round(lng, 2), round(lat, 2))
        if key not in self.labels:
            try:
                self.labels[key] = finish.reverse_geocode_label(lat, lng)
            except Exception as e:  # noqa: BLE001
                print(f"  reverse geocode failed ({e})")
                self.labels[key] = None
        city = (self.labels[key] or "Atlanta").split(", ")[-1]
        label = spot if city == spot else f"{spot}, {city}"
        conn.execute("update walks set public_area_label = %s where id = %s", (label, walk_id))


def recap_text(w: dict) -> str:
    top = (w["top"] + ["a Carolina Wren", "a Northern Cardinal", "a Blue Jay"])[:3]
    hour = (w["started"] + EDT).hour
    time_l = "morning" if hour < 12 else "afternoon" if hour < 16 else "evening"
    fields = {"area": w["area"].split(",")[0], "n": w["n"], "top0": top[0], "top1": top[1], "top2": top[2],
              "time": time_l.capitalize(), "time_l": time_l, "mood": rng.choice(["crisp", "breezy", "muggy", "gorgeous"])}
    if w["rare"]:
        name, (code, kind, photographed) = w["rare"]
        how = "on camera" if photographed else "by ear, a clean recording"
        return rng.choice(RARE_RECAPS).format(rare=name, how=how, how_cap=how[0].upper() + how[1:], **fields)
    return rng.choice(RECAPS).format(**fields)


# ---- schedules ----------------------------------------------------------------

def seed_birders(seeder: Seeder, ids: dict[str, str]) -> None:
    rares = {r[0]: r for r in RARITIES}
    for username, _, _, _, homes, per_week, _ in BIRDERS:
        uid = ids[username]
        n = 0
        for ago in range(WEEKS * 7, -1, -1):
            weekend = (NOW + EDT - timedelta(days=ago)).weekday() >= 5
            if rng.random() > per_week / 7 * (1.8 if weekend else 0.75):
                continue
            hour = rng.choice([7, 7.5, 8, 8.5, 9, 10]) if weekend or rng.random() < 0.6 else rng.choice([17, 17.5, 18])
            spot = rng.choices(homes, weights=[3, 2, 1][:len(homes)])[0]
            if seeder.walk(uid, spot, local_time(ago, hour + rng.uniform(0, 0.4)), rng.uniform(1.8, 5.0)):
                n += 1
        # the rare find
        _, code, spot, ago, kind, photographed, *near = rares.get(username, (None,) * 6)
        if code:
            w = seeder.walk(uid, spot, local_time(ago, rng.choice([7.2, 8.1, 17.3])), rng.uniform(2.5, 4.0),
                            rare=(code, kind, photographed), near=near[0] if near else None)
            if w:
                n += 1
        print(f"  {username}: {n} walks", flush=True)


def trail_line(group_id: int) -> list[tuple[float, float]]:
    """The longest merged line of one trail group, as [(lng, lat)]."""
    with db.connect() as conn:
        g = conn.execute("select ST_AsGeoJSON(ST_LineMerge(ST_Collect(geom::geometry)), 6)::json as g"
                         " from trails where group_id = %s", (group_id,)).fetchone()["g"]
    lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
    return [tuple(p) for p in max(lines, key=lambda ln: sum(hav(a, b) for a, b in zip(ln, ln[1:])))]


def seed_tech_extras(seeder: Seeder, ids: dict[str, str]) -> None:
    for username, group_id, ago, hour, km, species in TECH_EXTRAS:
        w = seeder.walk(ids[username], "Georgia Tech", local_time(ago, hour), km, line=trail_line(group_id),
                        only=species)
        print(f"  {username}: Georgia Tech extras, {', '.join(species)} {'ok' if w else 'SKIPPED'}")


def seed_bounties(seeder: Seeder) -> list[tuple]:
    markers = []
    with db.connect() as conn:
        for w in seeder.walks:
            if not w["rare"]:
                continue
            name, (code, kind, _) = w["rare"]
            det_id, i = w["rare_det"]
            lng, lat = w["route"][i]
            if kind == "bounty":
                c = fuzz(lng, lat)
                conn.execute(
                    "insert into bounties (species_code, common_name, source_detection_id, source_user_id,"
                    " center_geog, radius_m, expires_at, status, created_at) values (%s, %s, %s, %s, %s, 300, %s,"
                    " 'active', %s)",
                    (code, name, det_id, w["user_id"], point(*c), w["ended"] + timedelta(days=7), w["ended"]),
                )
                markers.append((f"bounty  {name}", c))
            else:
                markers.append((f"anomaly {name}", (lng, lat)))
    return markers


def check_spacing(markers: list[tuple]) -> None:
    sample = json.loads((ROOT / "web" / "public" / "sample-map.json").read_text(encoding="utf-8"))
    markers = markers + [(f"sample  {a['common_name']}", (a["center"]["lng"], a["center"]["lat"]))
                         for a in sample["anomalies"] + sample["bounties"]]
    print(f"{len(markers)} rare markers on the map:")
    for name, (lng, lat) in sorted(markers, key=lambda m: -m[1][1]):
        print(f"  {name:40s} {lat:.4f}, {lng:.4f}")
    close = [(a[0], b[0], round(hav(a[1], b[1]))) for i, a in enumerate(markers) for b in markers[i + 1:]
             if hav(a[1], b[1]) < MIN_RARE_SPACING_M]
    if close:
        print("  WARNING, markers closer than", MIN_RARE_SPACING_M, "m:", close)


def seed_demo_user(seeder: Seeder, uid: str) -> None:
    week = quests.local_week(NOW, -84.39)
    for spot, weeks_ago, weekday, hour, km in DEMO_WALKS:
        day = week.week_start - timedelta(weeks=weeks_ago) + timedelta(days=weekday)
        ago = ((NOW + EDT).date() - day).days
        if ago < 0:
            ago = 0
        this_week = weeks_ago == 0
        started = local_time(ago, hour + rng.uniform(0, 0.3))
        if this_week and started < week.start:
            started = week.start + timedelta(hours=12)
        woodpeckers = {c for c, t in seeder.tax.items() if t["family_com_name"] == "Woodpeckers"}
        exclude = (woodpeckers - THIS_WEEK_WOODPECKERS) | {"brnthr"} if this_week else frozenset()
        force = tuple(THIS_WEEK_WOODPECKERS) if this_week and spot == "Georgia Tech" else ()
        w = seeder.walk(uid, spot, started, km, exclude=exclude, force=force, photo_bias=0.75, longest=this_week)
        print(f"  {DEMO_USERNAME}: {spot} {started:%a %b %d} {'ok' if w else 'SKIPPED'}")
    with db.connect() as conn:
        for k, amount in enumerate(PAST_QUEST_REWARDS):
            ws = week.week_start - timedelta(weeks=4 - k)
            conn.execute("insert into quest_nests (user_id, week_start, month) values (%s, %s, %s)",
                         (uid, ws, week.month))
            conn.execute(
                "insert into points_ledger (user_id, amount, reason, created_at) values (%s, %s, 'quest_complete', %s)",
                (uid, amount, datetime.combine(ws, datetime.min.time(), timezone.utc) + timedelta(days=5)))
        # last month's big egg, hatched
        last_month = (week.month - timedelta(days=1)).replace(day=1)
        conn.execute("insert into nest_hatches (user_id, month, created_at) values (%s, %s, %s)",
                     (uid, last_month, datetime.combine(week.month, datetime.min.time(), timezone.utc) - timedelta(days=2)))
        conn.execute("insert into points_ledger (user_id, amount, reason, created_at) values (%s, %s, 'nest_hatch', %s)",
                     (uid, quests.NEST_HATCH_POINTS, datetime.combine(week.month, datetime.min.time(), timezone.utc) - timedelta(days=2)))
        quests.ensure_weekly(conn, uid, NOW)
        quests.refresh_progress(conn, uid, NOW)
        for q in quests.open_quests(conn, uid, NOW):
            print(f"  quest: {q['title']}: {q['progress']}/{q['target']}{' COMPLETE' if q['completed_at'] else ''}")
        print("  nests:", quests.nest_status(conn, uid, NOW))
        print("  xp:", conn.execute("select xp from profiles where id = %s", (uid,)).fetchone()["xp"])
    print(f"  quest week ends {week.end + EDT:%a %b %d %H:%M} EDT and the nests are {week.month:%B}'s;"
          " after either rolls over, re-run with --me-only")


# ---- social --------------------------------------------------------------------

def seed_follows(ids: dict[str, str], demo_id: str) -> dict[str, set[str]]:
    followers: dict[str, set[str]] = defaultdict(set)
    rows = []
    names = list(ids)
    for u in names:
        for v in rng.sample([x for x in names if x != u], k=rng.randint(4, 8)):
            rows.append((ids[u], ids[v]))
        rows.append((ids[u], demo_id))
    for username, *_, follow_back in BIRDERS:
        if follow_back:
            rows.append((demo_id, ids[username]))
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                "insert into follows (follower_id, followee_id, created_at) values (%s, %s, %s) on conflict do nothing",
                [(a, b, NOW - timedelta(days=rng.randint(10, 90))) for a, b in rows])
    for a, b in rows:
        followers[b].add(a)
    print(f"{len(rows)} follows")
    return followers


def seed_social(seeder: Seeder, followers: dict[str, set[str]], only_user: str | None = None) -> None:
    chirps, comments, likes = [], [], []
    for w in seeder.walks:
        if only_user and w["user_id"] != only_user:
            continue
        fans = sorted(followers.get(w["user_id"], set()))
        rng.shuffle(fans)
        popular = 1.6 if w["rare"] or w["photos"] else 1
        k = min(len(fans), int(rng.randint(1, 7) * popular))
        for f in fans[:k]:
            chirps.append((w["id"], f, w["ended"] + timedelta(minutes=rng.randint(5, 600))))
        n_comments = rng.choice([0, 0, 1, 1, 2, 3]) + (2 if w["rare"] else 0)
        bird = (w["top"] or ["Carolina Wren"])[0]
        if w["photos"]:
            bird = seeder.tax[w["photos"][0]]["common_name"]
        fields = {"area": w["area"].split(",")[0], "bird": bird, "n": w["n"]}
        for f in fans[:n_comments]:
            cid = str(uuid.uuid4())
            at = w["ended"] + timedelta(minutes=rng.randint(10, 900))
            if w["rare"] and rng.random() < 0.7:
                body = rng.choice(RARE_COMMENTS).format(rare=w["rare"][0], **fields)
            else:
                body = rng.choice(COMMENTS).format(**fields)
            comments.append((cid, w["id"], f, None, body, at))
            for liker in rng.sample(fans, k=min(len(fans), rng.randint(0, 3))):
                likes.append((cid, liker, at + timedelta(minutes=30)))
            if rng.random() < 0.5:
                rid = str(uuid.uuid4())
                comments.append((rid, w["id"], w["user_id"], cid, rng.choice(REPLIES), at + timedelta(minutes=rng.randint(5, 240))))
                likes.append((rid, f, at + timedelta(hours=5)))
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.executemany("insert into chirps (walk_id, user_id, created_at) values (%s, %s, %s)"
                            " on conflict do nothing", chirps)
            cur.executemany("insert into comments (id, walk_id, user_id, parent_id, body, created_at)"
                            " values (%s, %s, %s, %s, %s, %s)", comments)
            cur.executemany("insert into comment_likes (comment_id, user_id, created_at) values (%s, %s, %s)"
                            " on conflict do nothing", likes)
    print(f"{len(chirps)} chirps, {len(comments)} comments, {len(likes)} comment likes")


def seeded_ids() -> dict[str, str]:
    with db.connect() as conn:
        return {r["username"]: str(r["id"]) for r in conn.execute(
            "select p.id, p.username from profiles p join auth.users u on u.id = p.id where u.email like %s",
            (f"%@{SEED_DOMAIN}",))}


def demo_user_id() -> str:
    with db.connect() as conn:
        row = conn.execute("select id from profiles where username = %s", (DEMO_USERNAME,)).fetchone()
    if not row:
        sys.exit(f"no profile named {DEMO_USERNAME}")
    return str(row["id"])


def summaries(n: int) -> None:
    from app.llm.species_summary import write_species_summaries
    with db.connect() as conn:
        walks = [r["id"] for r in conn.execute(
            "select id from walks where status = 'complete' order by ended_at desc limit %s", (n,))]
    for wid in walks:
        with db.connect() as conn:
            try:
                print(f"  {wid}: {write_species_summaries(conn, str(wid))} summaries", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"  {wid}: failed ({e})")


def main() -> None:
    if "--summaries" in sys.argv:
        summaries(int(sys.argv[sys.argv.index("--summaries") + 1]))
        return
    demo_id = demo_user_id()
    seeder = Seeder()
    if "--tech-extras" in sys.argv:  # adds to an existing seed without wiping; run it once
        ids = seeded_ids()
        seed_tech_extras(seeder, ids)
        with db.connect() as conn:
            followers = defaultdict(set)
            for r in conn.execute("select follower_id, followee_id from follows"):
                followers[str(r["followee_id"])].add(str(r["follower_id"]))
        seed_social(seeder, followers)
        return
    if "--me-only" in sys.argv:
        wipe_user(demo_id)
        seed_demo_user(seeder, demo_id)
        ids = seeded_ids()
        followers = {demo_id: {ids[u] for u in ids}}
        seed_social(seeder, followers, only_user=demo_id)
        return
    wipe_all()
    ids = create_birders(seeder.photos)
    print("walks:")
    seed_birders(seeder, ids)
    seed_tech_extras(seeder, ids)
    seed_demo_user(seeder, demo_id)
    followers = seed_follows(ids, demo_id)
    seed_social(seeder, followers)
    check_spacing(seed_bounties(seeder))
    print(f"done: {len(seeder.walks)} walks. Seeded birders log in as <username>@{SEED_DOMAIN} / {SEED_PASSWORD}")


if __name__ == "__main__":
    main()
