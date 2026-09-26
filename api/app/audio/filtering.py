"""§7.2 steps 5–6 as a pure function: map BirdNET labels to eBird taxonomy and apply the thresholds."""

from dataclasses import dataclass

ANOMALY_REASON = "outside expected range/season"


@dataclass(frozen=True)
class Taxon:
    species_code: str
    common_name: str
    sci_name: str


@dataclass(frozen=True)
class KeptDetection:
    taxon: Taxon
    confidence: float
    start_time: float
    is_anomaly: bool


def keep_detections(
    raw: list[dict],
    by_sci: dict[str, Taxon],
    by_common: dict[str, Taxon],
    expected_sci: set[str],
    min_conf: float,
    anomaly_conf: float,
) -> list[KeptDetection]:
    """raw: birdnetlib detections. by_sci/by_common/expected_sci keys are lower-cased.
    Labels that don't map to eBird (human voice, dog, engine, frogs, insects…) are dropped."""
    kept = []
    for d in raw:
        taxon = by_sci.get(d["scientific_name"].lower()) or by_common.get(d["common_name"].lower())
        if taxon is None:
            continue
        conf = float(d["confidence"])
        expected = d["scientific_name"].lower() in expected_sci or taxon.sci_name.lower() in expected_sci
        if expected and conf >= min_conf:
            kept.append(KeptDetection(taxon, conf, float(d["start_time"]), False))
        elif not expected and conf >= anomaly_conf:
            kept.append(KeptDetection(taxon, conf, float(d["start_time"]), True))
    return kept
