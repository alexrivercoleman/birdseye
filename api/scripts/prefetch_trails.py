"""Prefetch OSM trails for the demo areas (§7.13) so the community map doesn't hit rate-limited Overpass live.

    cd api
    python scripts/prefetch_trails.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.trails.overpass import ensure_trails  # noqa: E402

# minLng, minLat, maxLng, maxLat
AREAS = {
    "Piedmont Park + BeltLine Eastside": (-84.385, 33.765, -84.355, 33.795),
    "Freedom Park": (-84.365, 33.760, -84.335, 33.775),
    "Sweetwater Creek": (-84.650, 33.740, -84.610, 33.770),
    "Kennesaw Mountain": (-84.600, 33.960, -84.560, 33.995),
}

if __name__ == "__main__":
    for name, box in AREAS.items():
        with db.connect() as conn:
            ensure_trails(conn, *box, max_cells=20, attempts=4)
            n = conn.execute("select count(*) as n from trails where geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)"
                             "::geography", box).fetchone()["n"]
        print(f"{name}: {n} trail segments cached")
        time.sleep(2)  # be polite to public Overpass
