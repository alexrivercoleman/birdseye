import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

from app.audio.filtering import Taxon, keep_detections

WREN = Taxon("carwre", "Carolina Wren", "Thryothorus ludovicianus")
BUNTING = Taxon("paibun", "Painted Bunting", "Passerina ciris")
BY_SCI = {t.sci_name.lower(): t for t in (WREN, BUNTING)}
BY_COMMON = {t.common_name.lower(): t for t in (WREN, BUNTING)}
FIXTURES = Path(__file__).resolve().parents[2] / "scripts" / "fixtures"


def _det(sci, common, conf, start=0.0):
    return {"scientific_name": sci, "common_name": common, "confidence": conf, "start_time": start, "end_time": start + 3}


def _keep(raw, expected=frozenset({"thryothorus ludovicianus"})):
    return keep_detections(raw, BY_SCI, BY_COMMON, set(expected), min_conf=0.6, anomaly_conf=0.85)


def test_expected_species_above_min_conf_kept():
    [k] = _keep([_det("Thryothorus ludovicianus", "Carolina Wren", 0.61, 3.0)])
    assert (k.taxon.species_code, k.is_anomaly, k.start_time) == ("carwre", False, 3.0)


def test_expected_species_below_min_conf_dropped():
    assert _keep([_det("Thryothorus ludovicianus", "Carolina Wren", 0.59)]) == []


def test_unexpected_species_needs_anomaly_conf():
    assert _keep([_det("Passerina ciris", "Painted Bunting", 0.84)]) == []
    [k] = _keep([_det("Passerina ciris", "Painted Bunting", 0.9)])
    assert k.is_anomaly


def test_non_bird_labels_dropped():
    assert _keep([_det("Human vocal", "Human vocal", 0.99), _det("Canis familiaris", "Dog", 0.99)]) == []


def test_falls_back_to_common_name_when_sci_name_renamed():
    [k] = _keep([_det("Thryothorus oldgenus", "Carolina Wren", 0.9)])
    assert k.taxon.species_code == "carwre"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")
def test_birdnet_hears_wren_fixture(tmp_path):
    pytest.importorskip("birdnetlib")
    from app.audio import birdnet

    wav = tmp_path / "wren.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(FIXTURES / "carolina_wren.ogg"), "-ac", "1", "-ar", "48000",
                    str(wav)], check=True)
    raw = birdnet.analyze(str(wav))
    expected = birdnet.location_species(33.7851, -84.3738, date(2026, 9, 25))  # Atlanta, late September
    kept = keep_detections(raw, BY_SCI, BY_COMMON, expected, min_conf=0.6, anomaly_conf=0.85)
    assert kept and all(k.taxon.species_code == "carwre" and not k.is_anomaly for k in kept)
