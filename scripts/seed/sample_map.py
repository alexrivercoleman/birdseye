"""Sample community-map usage: what the map looks like after ~6 months of Atlanta birders walking real trails.

Writes web/public/sample-map.json. The web app draws it as the whole map in mock mode, and on top of the API's
trails otherwise (web/src/api/sampleMap.ts), so demos look lived-in without putting fake walks in the database.

    cd api
    .venv/Scripts/python ../scripts/seed/sample_map.py --fetch   # cache the spots' OSM trails (public Overpass, slow)
    .venv/Scripts/python ../scripts/seed/sample_map.py           # simulate and write the JSON

Trail shapes are the real OSM trails cached in `trails` (§7.13), so the samples line up with the live map. The
simulation is seeded, so re-running it gives the same map. Times are stored as "days ago" and turned into dates in
the browser, so the sample never goes stale.
"""

import json
import math
import random
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))

from app import db  # noqa: E402
from app.trails.overpass import ensure_trails  # noqa: E402

OUT = ROOT / "web" / "public" / "sample-map.json"
DAYS = 182            # ~6 months of walks
WINDOW = 90           # the map counts the last 90 days (§7.13)
TODAY = date(2026, 9, 26)
rng = random.Random(20260926)

# name, (minLng, minLat, maxLng, maxLat), habitat (Forest, Water, Open, Urban), popularity
SPOTS = [
    ("Piedmont Park", (-84.3790, 33.7780, -84.3650, 33.7900), (0.3, 0.3, 0.5, 0.5), 10),
    ("BeltLine Eastside", (-84.3690, 33.7560, -84.3580, 33.7860), (0.1, 0.0, 0.3, 0.8), 6),
    ("Freedom Park", (-84.3620, 33.7600, -84.3350, 33.7710), (0.2, 0.0, 0.4, 0.6), 4),
    ("Kennesaw Mountain", (-84.6000, 33.9600, -84.5600, 33.9950), (0.9, 0.1, 0.4, 0.0), 9),
    ("Sweetwater Creek", (-84.6500, 33.7400, -84.6100, 33.7700), (0.8, 0.7, 0.2, 0.0), 7),
    ("Cochran Shoals", (-84.4600, 33.8950, -84.4300, 33.9150), (0.5, 0.7, 0.6, 0.1), 9),
    ("Island Ford", (-84.3450, 33.9800, -84.3250, 34.0000), (0.7, 0.7, 0.2, 0.0), 5),
    ("Morningside Nature Preserve", (-84.3600, 33.8050, -84.3450, 33.8150), (0.7, 0.5, 0.2, 0.1), 5),
    ("Fernbank Forest", (-84.3270, 33.7700, -84.3160, 33.7790), (1.0, 0.1, 0.1, 0.1), 3),
    ("Lullwater Preserve", (-84.3290, 33.7930, -84.3150, 33.8040), (0.7, 0.6, 0.2, 0.1), 5),
    ("Constitution Lakes", (-84.3450, 33.6800, -84.3300, 33.6930), (0.5, 0.9, 0.3, 0.0), 7),
    ("Arabia Mountain", (-84.1350, 33.6500, -84.1000, 33.6800), (0.5, 0.3, 0.7, 0.0), 6),
    ("Stone Mountain", (-84.1600, 33.7900, -84.1300, 33.8200), (0.6, 0.4, 0.4, 0.1), 6),
    ("Murphey Candler Park", (-84.3300, 33.9000, -84.3150, 33.9120), (0.4, 0.7, 0.4, 0.2), 4),
    ("Cascade Springs", (-84.4900, 33.7180, -84.4750, 33.7300), (0.9, 0.5, 0.1, 0.0), 4),
    ("Blue Heron Nature Preserve", (-84.3920, 33.8530, -84.3780, 33.8660), (0.5, 0.7, 0.3, 0.2), 4),
    ("Big Trees Forest Preserve", (-84.3740, 33.9400, -84.3620, 33.9520), (0.9, 0.2, 0.1, 0.1), 2),
    ("BeltLine Westside", (-84.4450, 33.7250, -84.4200, 33.7600), (0.1, 0.0, 0.4, 0.7), 3),
    ("Grant Park", (-84.3760, 33.7310, -84.3640, 33.7410), (0.3, 0.0, 0.4, 0.6), 3),
    ("Olmsted Linear Park", (-84.3350, 33.7690, -84.3100, 33.7760), (0.5, 0.1, 0.3, 0.5), 3),
    ("Georgia Tech", (-84.4130, 33.7690, -84.3880, 33.7880), (0.4, 0.1, 0.5, 0.8), 8),
]


# code, name, tier, habitat (F, W, O, U), chance per walk where the habitat fits, season
# seasons: res = all year, sum = breeding (Apr–mid Oct), mig = spring + fall migration, spr = April stragglers
SPECIES = [
    ("carwre", "Carolina Wren", "common", (1, .5, .6, .7), .85, "res"),
    ("norcar", "Northern Cardinal", "common", (.8, .5, .8, .9), .85, "res"),
    ("blujay", "Blue Jay", "common", (.9, .4, .6, .8), .7, "res"),
    ("amecro", "American Crow", "common", (.6, .5, .8, .9), .65, "res"),
    ("carchi", "Carolina Chickadee", "common", (1, .5, .5, .6), .7, "res"),
    ("tuftit", "Tufted Titmouse", "common", (1, .4, .4, .5), .7, "res"),
    ("normoc", "Northern Mockingbird", "common", (.1, .2, .9, 1), .6, "res"),
    ("rebwoo", "Red-bellied Woodpecker", "common", (1, .5, .5, .5), .6, "res"),
    ("dowwoo", "Downy Woodpecker", "common", (1, .5, .5, .4), .45, "res"),
    ("amerob", "American Robin", "common", (.5, .3, .9, 1), .6, "res"),
    ("moudov", "Mourning Dove", "common", (.3, .3, .9, 1), .5, "res"),
    ("eursta", "European Starling", "common", (0, .2, .6, 1), .45, "res"),
    ("houfin", "House Finch", "common", (.1, .1, .6, 1), .4, "res"),
    ("amegfi", "American Goldfinch", "common", (.4, .4, .9, .5), .4, "res"),
    ("easblu", "Eastern Bluebird", "common", (.3, .2, 1, .4), .4, "res"),
    ("brnthr", "Brown Thrasher", "common", (.8, .3, .8, .7), .4, "res"),
    ("whbnut", "White-breasted Nuthatch", "common", (1, .3, .3, .3), .35, "res"),
    ("bnhnut", "Brown-headed Nuthatch", "uncommon", (.9, .1, .5, .3), .2, "res"),
    ("pinwar", "Pine Warbler", "common", (1, .2, .4, .3), .35, "res"),
    ("pilwoo", "Pileated Woodpecker", "uncommon", (1, .5, .2, .1), .3, "res"),
    ("haiwoo", "Hairy Woodpecker", "uncommon", (1, .3, .2, .1), .15, "res"),
    ("norfli", "Northern Flicker", "uncommon", (.6, .3, .8, .4), .2, "res"),
    ("reshaw", "Red-shouldered Hawk", "uncommon", (.8, .9, .3, .3), .3, "res"),
    ("rethaw", "Red-tailed Hawk", "uncommon", (.3, .2, 1, .5), .2, "res"),
    ("coohaw", "Cooper's Hawk", "uncommon", (.6, .2, .4, .6), .12, "res"),
    ("brdowl", "Barred Owl", "uncommon", (1, .8, .1, .1), .12, "res"),
    ("turvul", "Turkey Vulture", "common", (.5, .4, 1, .3), .35, "res"),
    ("blkvul", "Black Vulture", "common", (.4, .4, .9, .5), .3, "res"),
    ("wiltur", "Wild Turkey", "uncommon", (1, .1, .6, 0), .12, "res"),
    ("grbher3", "Great Blue Heron", "uncommon", (.1, 1, .2, .2), .5, "res"),
    ("greegr", "Great Egret", "uncommon", (0, 1, .1, .1), .35, "sum"),
    ("grnher", "Green Heron", "uncommon", (.2, 1, .1, .1), .35, "sum"),
    ("ycnher", "Yellow-crowned Night Heron", "uncommon", (.2, 1, 0, .2), .2, "sum"),
    ("bcnher", "Black-crowned Night Heron", "uncommon", (0, 1, 0, .1), .1, "sum"),
    ("cangoo", "Canada Goose", "common", (0, 1, .6, .6), .6, "res"),
    ("mallar3", "Mallard", "common", (0, 1, .3, .6), .5, "res"),
    ("wooduc", "Wood Duck", "uncommon", (.4, 1, 0, 0), .3, "res"),
    ("belkin1", "Belted Kingfisher", "uncommon", (.2, 1, 0, .1), .3, "res"),
    ("osprey", "Osprey", "uncommon", (0, 1, .2, 0), .25, "res"),
    ("baleag", "Bald Eagle", "uncommon", (.2, 1, .1, 0), .1, "res"),
    ("sposan", "Spotted Sandpiper", "uncommon", (0, 1, 0, 0), .2, "mig"),
    ("solsan", "Solitary Sandpiper", "uncommon", (0, 1, 0, 0), .12, "mig"),
    ("killde", "Killdeer", "uncommon", (0, .4, 1, .4), .2, "res"),
    ("chiswi", "Chimney Swift", "common", (.2, .4, .7, 1), .6, "sum"),
    ("rthhum", "Ruby-throated Hummingbird", "common", (.7, .4, .7, .6), .35, "sum"),
    ("easpho", "Eastern Phoebe", "common", (.5, .9, .6, .4), .45, "res"),
    ("eawpew", "Eastern Wood-Pewee", "common", (1, .5, .3, .2), .5, "sum"),
    ("acafly", "Acadian Flycatcher", "uncommon", (1, .9, 0, 0), .3, "sum"),
    ("grcfly", "Great Crested Flycatcher", "uncommon", (1, .4, .4, .2), .3, "sum"),
    ("easkin", "Eastern Kingbird", "uncommon", (.1, .6, 1, .1), .25, "sum"),
    ("whevir", "White-eyed Vireo", "common", (.8, .6, .7, .2), .45, "sum"),
    ("reevir1", "Red-eyed Vireo", "common", (1, .5, .2, .2), .55, "sum"),
    ("yetvir", "Yellow-throated Vireo", "uncommon", (1, .6, .2, .1), .2, "sum"),
    ("barswa", "Barn Swallow", "common", (0, .8, 1, .4), .4, "sum"),
    ("nrwswa", "Northern Rough-winged Swallow", "uncommon", (0, 1, .5, .1), .25, "sum"),
    ("purmar", "Purple Martin", "uncommon", (0, .8, 1, .4), .15, "sum"),
    ("bnhcow", "Brown-headed Cowbird", "common", (.3, .3, .9, .7), .3, "res"),
    ("comgra", "Common Grackle", "common", (.2, .6, .8, 1), .45, "res"),
    ("rewbla", "Red-winged Blackbird", "common", (0, 1, .7, .2), .45, "res"),
    ("chispa", "Chipping Sparrow", "common", (.4, .1, .9, .8), .45, "res"),
    ("sonspa", "Song Sparrow", "common", (.2, .9, .8, .5), .4, "res"),
    ("eastow", "Eastern Towhee", "common", (1, .3, .6, .3), .5, "res"),
    ("indbun", "Indigo Bunting", "common", (.5, .3, 1, .2), .5, "sum"),
    ("blugrb1", "Blue Grosbeak", "uncommon", (.2, .2, 1, .1), .2, "sum"),
    ("sumtan", "Summer Tanager", "uncommon", (1, .4, .4, .3), .3, "sum"),
    ("scatan", "Scarlet Tanager", "uncommon", (1, .2, .1, 0), .2, "sum"),
    ("orcori", "Orchard Oriole", "uncommon", (.4, .6, .8, .3), .2, "sum"),
    ("yebcuc", "Yellow-billed Cuckoo", "uncommon", (1, .5, .4, .1), .25, "sum"),
    ("woothr", "Wood Thrush", "uncommon", (1, .4, 0, 0), .3, "sum"),
    ("grycat", "Gray Catbird", "common", (.8, .7, .6, .5), .45, "sum"),
    ("cedwax", "Cedar Waxwing", "common", (.6, .5, .7, .6), .25, "res"),
    ("norpar", "Northern Parula", "common", (1, .9, .1, .2), .45, "sum"),
    ("yetwar", "Yellow-throated Warbler", "uncommon", (1, .7, .1, .1), .25, "sum"),
    ("hoowar", "Hooded Warbler", "uncommon", (1, .4, 0, 0), .25, "sum"),
    ("kenwar", "Kentucky Warbler", "uncommon", (1, .3, 0, 0), .12, "sum"),
    ("louwat", "Louisiana Waterthrush", "uncommon", (.7, 1, 0, 0), .2, "sum"),
    ("prowar", "Prothonotary Warbler", "uncommon", (.3, 1, 0, 0), .15, "sum"),
    ("comyel", "Common Yellowthroat", "common", (.3, .8, .9, .1), .35, "sum"),
    ("yebcha", "Yellow-breasted Chat", "uncommon", (.3, .2, 1, 0), .15, "sum"),
    ("ovenbi1", "Ovenbird", "uncommon", (1, .2, 0, 0), .2, "sum"),
    ("bawwar", "Black-and-white Warbler", "uncommon", (1, .4, .1, .1), .25, "mig"),
    ("amered", "American Redstart", "uncommon", (1, .5, .2, .2), .3, "mig"),
    ("magwar", "Magnolia Warbler", "uncommon", (1, .4, .3, .3), .3, "mig"),
    ("chswar", "Chestnut-sided Warbler", "uncommon", (1, .4, .3, .2), .25, "mig"),
    ("btnwar", "Black-throated Green Warbler", "uncommon", (1, .3, .2, .2), .25, "mig"),
    ("bkbwar", "Blackburnian Warbler", "uncommon", (1, .2, .1, .1), .15, "mig"),
    ("babwar", "Bay-breasted Warbler", "uncommon", (1, .3, .1, .1), .12, "mig"),
    ("tenwar", "Tennessee Warbler", "uncommon", (1, .4, .3, .2), .2, "mig"),
    ("robgro", "Rose-breasted Grosbeak", "uncommon", (1, .3, .3, .3), .2, "mig"),
    ("balori", "Baltimore Oriole", "uncommon", (.7, .4, .5, .3), .12, "mig"),
    ("swathr", "Swainson's Thrush", "uncommon", (1, .4, .1, .1), .2, "mig"),
    ("veery", "Veery", "uncommon", (1, .4, 0, 0), .12, "mig"),
    ("cerwar", "Cerulean Warbler", "rare", (1, .1, 0, 0), .05, "mig"),
    ("gowwar", "Golden-winged Warbler", "rare", (1, .1, .1, 0), .03, "mig"),
    ("swawar", "Swainson's Warbler", "rare", (1, .8, 0, 0), .03, "sum"),
    ("miskit", "Mississippi Kite", "uncommon", (.3, .3, 1, .6), .08, "sum"),
    ("yerwar", "Yellow-rumped Warbler", "common", (.8, .5, .6, .5), .5, "spr"),
    ("ruckin", "Ruby-crowned Kinglet", "common", (1, .4, .4, .4), .35, "spr"),
    ("whtspa", "White-throated Sparrow", "common", (.8, .3, .6, .6), .45, "spr"),
]
MIGRANT_TRAP = {"Kennesaw Mountain": 2.5, "Morningside Nature Preserve": 1.4, "Piedmont Park": 1.3, "Fernbank Forest": 1.3}
KENNESAW_ONLY = {"cerwar", "gowwar"}

# Out-of-range birds (anomalies, §7.2): species, spot, days ago, photo confirmed
ANOMALIES = [
    ("rosspo1", "Roseate Spoonbill", "Constitution Lakes", 12, True),
    ("woosto", "Wood Stork", "Cochran Shoals", 34, True),
    ("sctfly", "Scissor-tailed Flycatcher", "Arabia Mountain", 58, False),
    ("anhing", "Anhinga", "Sweetwater Creek", 81, True),
    ("paibun", "Painted Bunting", "Piedmont Park", 5, False),
]
REASON = "outside expected range/season"
BOUNTY_SPOTS = {"Kennesaw Mountain", "Lullwater Preserve"}


def season(kind: str, d: date) -> float:
    doy = d.timetuple().tm_yday

    def ramp(start, peak, end):  # 0 → 1 between start and peak, back to 0 at end (days of year)
        if doy <= start or doy >= end:
            return 0.0
        return (doy - start) / (peak - start) if doy < peak else (end - doy) / (end - peak)

    if kind == "res":
        return 1.0
    if kind == "sum":
        return min(1.0, 2 * ramp(95, 150, 290))
    if kind == "mig":  # spring peak ~May 1, fall peak ~Sep 25
        return max(ramp(100, 121, 145), ramp(230, 268, 300))
    if kind == "spr":
        return ramp(60, 91, 128)
    raise ValueError(kind)


def load_trails() -> dict[str, list[dict]]:
    """Trail groups per spot: named, ≥ 150 m, not street-named, 14 longest; each group belongs to one spot."""
    street = r"( (Drive|Road|Street|Avenue|Lane|Way|Boulevard|Parkway|Place|Court|Circle)( |$)| (Dr|Rd|St|Ave|Ln|Blvd|Pkwy|NE|NW|SE|SW)$|Bike Lane|Sidewalk|Crosswalk|Driveway|^(abandoned|false|cut-off|detour|overgrown|unmarked|ribbon|old track|red poles|purple mark)|Splash Pad|Nature Center|entrance|vehicles only)"
    seen: set[int] = set()
    out: dict[str, list[dict]] = {}
    with db.connect() as conn:
        for name, box, _, _ in SPOTS:
            rows = conn.execute(
                f"""
                with g as (
                    select distinct group_id from trails
                     where geom && ST_MakeEnvelope(%(w)s, %(s)s, %(e)s, %(n)s, 4326)::geography and (name !~* %(street)s or name ~* '^PATH ')
                )
                select t.group_id, min(t.name) as name, sum(ST_Length(t.geom)) as length_m,
                       ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(ST_Collect(t.geom::geometry), 0.00004)), 5)::json as geometry
                  from trails t join g using (group_id)
                 group by t.group_id having sum(ST_Length(t.geom)) >= 150
                 order by length_m desc limit 14
                """,
                {"w": box[0], "s": box[1], "e": box[2], "n": box[3], "street": street},
            ).fetchall()
            out[name] = [r for r in rows if r["group_id"] not in seen]
            seen |= {r["group_id"] for r in rows}
    return out


def point_on(geometry: dict) -> tuple[float, float]:
    """Random point along a MultiLineString, jittered ~15 m (lng, lat)."""
    segs = [(a, b) for line in geometry["coordinates"] for a, b in zip(line, line[1:])]
    lengths = [math.dist(a, b) for a, b in segs]
    a, b = rng.choices(segs, weights=lengths)[0]
    t = rng.random()
    return (a[0] + (b[0] - a[0]) * t + rng.gauss(0, 0.00015), a[1] + (b[1] - a[1]) * t + rng.gauss(0, 0.00012))


def fuzz(lng: float, lat: float) -> dict:  # §7.6: 100–200 m on a random bearing
    bearing, dist = rng.uniform(0, 2 * math.pi), rng.uniform(100, 200)
    return {"lat": round(lat + dist * math.cos(bearing) / 111_320, 5),
            "lng": round(lng + dist * math.sin(bearing) / (111_320 * math.cos(math.radians(lat))), 5)}


def simulate(trails: dict[str, list[dict]]) -> dict:
    spots = [s for s in SPOTS if trails[s[0]]]
    habitat = {s[0]: s[2] for s in spots}
    birders = []
    for i in range(46):
        homes = rng.sample(spots, k=rng.choice([2, 3, 3, 4]))
        birders.append({"id": i, "homes": homes, "per_week": rng.choice([0.4, 0.7, 1, 1, 1.5, 2, 3])})

    # per trail: species → {walks, users, last}; heat: cell → set((walk, species))
    stats: dict[int, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"walks": set(), "users": set(), "last": 999}))
    heat: dict[tuple[int, int], set] = defaultdict(set)
    recent_rare: list[tuple] = []
    walk_id = 0
    for ago in range(DAYS, -1, -1):
        d = TODAY - timedelta(days=ago)
        weekend = 1.7 if d.weekday() >= 5 else 0.85
        for b in birders:
            if rng.random() > b["per_week"] / 7 * weekend:
                continue
            walk_id += 1
            spot = rng.choices(b["homes"], weights=[s[3] for s in b["homes"]])[0][0]
            walked = rng.sample(trails[spot], k=min(len(trails[spot]), rng.choice([1, 1, 2, 3])))
            h = habitat[spot]
            for code, name, tier, sh, chance, kind in SPECIES:
                if code in KENNESAW_ONLY and spot != "Kennesaw Mountain":
                    continue
                fit = max(x * y for x, y in zip(h, sh))  # best habitat match, so generalists stay common
                boost = MIGRANT_TRAP.get(spot, 1) if kind == "mig" else 1
                # fit ** 1.8: birds rarely turn up in habitat that barely suits them
                if rng.random() >= min(0.95, chance * fit ** 1.8 * season(kind, d) * boost * 0.7):
                    continue
                t = rng.choice(walked)
                if ago <= WINDOW:
                    s = stats[t["group_id"]][code]
                    s["walks"].add(walk_id), s["users"].add(b["id"])
                    s["last"] = min(s["last"], ago)
                    lng, lat = point_on(t["geometry"])
                    heat[(math.floor(lat / 0.0025), math.floor(lng / 0.0025))].add((walk_id, code))
                if tier == "rare" and ago <= 6:
                    recent_rare.append((code, name, t, ago, spot))
    names = {c: (n, tier) for c, n, tier, *_ in SPECIES}

    out_trails = []
    for spot, ts in trails.items():
        for t in ts:
            sp = stats.get(t["group_id"], {})
            top = sorted(sp.items(), key=lambda kv: (-len(kv[1]["walks"]), -len(kv[1]["users"]), kv[1]["last"]))[:15]
            out_trails.append({
                "trail_id": f"sample-{t['group_id']}", "name": t["name"], "species_total": len(sp),
                "geometry": t["geometry"],
                "top_species": [{"species_code": c, "common_name": names[c][0], "rarity_tier": names[c][1],
                                 "walks": len(v["walks"]), "users": len(v["users"]), "last_heard_days_ago": v["last"]}
                                for c, v in top],
            })

    anomalies = []
    for code, name, spot, ago, photo in ANOMALIES:
        if trails.get(spot):
            lng, lat = point_on(rng.choice(trails[spot])["geometry"])
            anomalies.append({"species_code": code, "common_name": name, "center": fuzz(lng, lat), "radius_m": 300,
                              "days_ago": ago, "reason": REASON, "photo_confirmed": photo})
    # At most one bounty per spot, and only at BOUNTY_SPOTS: the anomalies and the demo seed's own rare birds
    # (scripts/seed/demo_seed.py) cover the other spots, and overlapping circles look like a bug.
    bounties, seen = [], set()
    for code, name, t, ago, spot in sorted(recent_rare, key=lambda r: r[3]):
        if spot not in BOUNTY_SPOTS or spot in seen:
            continue
        seen.add(spot)
        lng, lat = point_on(t["geometry"])
        bounties.append({"bounty_id": f"sample-bounty-{code}", "species_code": code, "common_name": name,
                         "center": fuzz(lng, lat), "radius_m": 300, "expires_in_days": 7 - ago, "claimed_by_me": False})

    cells = [{"lat": round((i + 0.5) * 0.0025, 5), "lng": round((j + 0.5) * 0.0025, 5), "weight": len(v)}
             for (i, j), v in heat.items()]
    print(f"{walk_id} walks by {len(birders)} birders; {len(out_trails)} trails "
          f"({sum(1 for t in out_trails if t['species_total'])} with birds in the last {WINDOW} days); "
          f"{len(cells)} heat cells; {len(anomalies)} anomalies; {len(bounties)} bounties")
    return {"generated": TODAY.isoformat(), "trails": out_trails, "heat": cells, "anomalies": anomalies,
            "bounties": bounties}


def fetch() -> None:
    for name, box, _, _ in SPOTS:
        with db.connect() as conn:
            ensure_trails(conn, *box, max_cells=20, attempts=4)
            names = conn.execute(
                "select distinct name from trails where geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)::geography"
                " order by name", box).fetchall()
        print(f"{name}: {len(names)} named trails, e.g. {[r['name'] for r in names[:8]]}", flush=True)


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        fetch()
    else:
        trails = load_trails()
        for spot, ts in trails.items():
            print(f"  {spot}: {[t['name'] for t in ts]}")
        data = simulate(trails)
        OUT.write_text(json.dumps(data, separators=(",", ":")))
        print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
