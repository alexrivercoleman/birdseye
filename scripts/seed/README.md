# Seed data (Workstream C)

Demo seed script per spec §11: ~12 users with follows (some mutual), ~40 walks on real Atlanta trails over the past 2 weeks, detections, photos, bounties, quest progress, chirps, comments. Also prefetches Overpass trail data for the demo areas.

`sample_map.py` builds the community map's demo layer: ~6 months of simulated birding by ~45 birders on the real OSM trails of ~20 Atlanta birding spots, written to `web/public/sample-map.json` (no database writes besides the Overpass trail cache). See its docstring.

## Demo seed (`demo_seed.py`)

**Wipes every walk and all game state**, then seeds ~5 weeks of Atlanta birding by 12 fake birders
(`<username>@seed.birdseye.app` / `birdseye-demo-2026`, so a teammate can log in as one to chirp live) and sets up
the presenter (`d2birder`): 4/5 nests this month, woodpeckers 2/3, ~4.5/5 trail miles, and "Photograph a Brown
Thrasher" open, so completing it live and claiming it lays the 5th egg and brings up the big egg. See the docstring.

    cd api
    .venv/Scripts/python ../scripts/seed/bird_photos.py              # once: Wikimedia Commons photos → .photo_cache/
    .venv/Scripts/python ../scripts/seed/demo_seed.py                # full wipe + seed (re-run the morning of the demo)
    .venv/Scripts/python ../scripts/seed/demo_seed.py --me-only      # reset only the presenter after a rehearsal
    .venv/Scripts/python ../scripts/seed/demo_seed.py --summaries 25 # pre-write AI species summaries, newest walks
    .venv/Scripts/python ../scripts/seed/demo_seed.py --tech-extras  # add the Georgia Tech trail extras only (no wipe, run once)

Rare birds are placed on purpose (`RARITIES`): one per spot, ≥ 3 km apart, checked against the sample map's
anomalies. Photos are CC-licensed from Wikimedia Commons; credits are in `.photo_cache/credits.json`.
