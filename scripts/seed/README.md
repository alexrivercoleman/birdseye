# Seed data (Workstream C)

Demo seed script per spec §11: ~12 users with follows (some mutual), ~40 walks on real Atlanta trails over the past 2 weeks, detections, photos, bounties, quest progress, chirps, comments. Also prefetches Overpass trail data for the demo areas.

`sample_map.py` builds the community map's demo layer: ~6 months of simulated birding by ~45 birders on the real OSM trails of ~20 Atlanta birding spots, written to `web/public/sample-map.json` (no database writes besides the Overpass trail cache). See its docstring.
