"""Rarity tiers (§7.4): in eBird 'notable' → rare; not reported nearby in 30 days → uncommon; else common.
Anomalies are forced to rare by the finish orchestrator. Never raises: eBird down → everything common."""

import logging
from datetime import date

from app import db
from app.birds import ebird

log = logging.getLogger(__name__)


def tiers_for_walk(lat: float, lng: float, on: date, species_codes: list[str]) -> dict[str, str]:
    try:
        with db.connect() as conn:
            notable = {o["speciesCode"] for o in ebird.notable_species(conn, lat, lng)}
            recent = {o["speciesCode"] for o in ebird.recent_species(conn, lat, lng)}
    except Exception:
        log.exception("eBird unavailable; defaulting tiers to common")
        return {}
    return {
        code: "rare" if code in notable else "uncommon" if code not in recent else "common"
        for code in species_codes
    }
