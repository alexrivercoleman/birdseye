"""BirdNET via birdnetlib (API verified against birdnetlib 0.18.1 source).

The Analyzer (and its location/season SpeciesList model) loads once per process. TFLite interpreters and
the Analyzer's result state aren't thread-safe, and BackgroundTasks run in a threadpool, so calls are locked.
"""

import threading
from datetime import date
from functools import lru_cache

LOCATION_FILTER_THRESHOLD = 0.03  # birdnetlib/BirdNET-Analyzer default
WINDOW_OVERLAP_S = 1.5  # 3 s windows every 1.5 s, so a call straddling a window edge is still caught whole

_lock = threading.Lock()


@lru_cache
def analyzer():
    from birdnetlib.analyzer import Analyzer

    return Analyzer()


def analyze(wav_path: str) -> list[dict]:
    """Detections WITHOUT the location filter: [{common_name, scientific_name, start_time, end_time, confidence}]."""
    from birdnetlib import Recording

    with _lock:
        rec = Recording(analyzer(), wav_path, min_conf=0.25, overlap=WINDOW_OVERLAP_S)
        rec.analyze()
        return list(rec.detections)


def location_species(lat: float, lng: float, on: date) -> set[str]:
    """Lower-cased scientific names BirdNET's range model expects at this place and week."""
    with _lock:
        items = analyzer().species_class.return_list(lon=lng, lat=lat, date=on, threshold=LOCATION_FILTER_THRESHOLD)
    return {i["scientific_name"].lower() for i in items}
