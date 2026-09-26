"""Scoring (§7.5).

Each walk_species row can earn species_heard and species_photographed independently. Each
(user, species, reason) pays at most once per local calendar day; later walks show points 0.
Anomalies pay nothing unless photo-confirmed, then rare amounts + an anomaly_confirmed bonus.

Ledger ref_id: species_heard → best detection id; species_photographed / anomaly_confirmed → photo id.
That's how the once-per-day check recovers the species from earlier walks' ledger rows.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import psycopg

TIER_POINTS = {"common": 10, "uncommon": 25, "rare": 75}
ANOMALY_BONUS = 100
BOUNTY_CLAIM_POINTS = 50

SPECIES_REASONS = ("species_heard", "species_photographed", "anomaly_confirmed")


@dataclass(frozen=True)
class ScoredSpecies:
    species_code: str
    rarity_tier: str
    heard: bool
    photographed: bool  # confirmed photo only
    is_anomaly: bool = False
    detection_id: str | None = None
    photo_id: str | None = None


@dataclass(frozen=True)
class Award:
    species_code: str
    reason: str
    amount: int
    ref_id: str | None


def score_species(species: list[ScoredSpecies], already_awarded: set[tuple[str, str]]) -> list[Award]:
    """already_awarded: {(species_code, reason)} paid out on the user's other walks the same day."""
    awards = []
    for sp in species:
        if sp.is_anomaly and not sp.photographed:
            continue
        amount = TIER_POINTS["rare" if sp.is_anomaly else sp.rarity_tier]
        candidates = []
        if sp.heard:
            candidates.append(("species_heard", amount, sp.detection_id))
        if sp.photographed:
            candidates.append(("species_photographed", amount, sp.photo_id))
        if sp.is_anomaly:
            candidates.append(("anomaly_confirmed", ANOMALY_BONUS, sp.photo_id))
        for reason, amt, ref in candidates:
            if (sp.species_code, reason) not in already_awarded:
                awards.append(Award(sp.species_code, reason, amt, ref))
    return awards


def local_day_bounds(t: datetime, lng: float | None) -> tuple[datetime, datetime]:
    """UTC [start, end) of the local calendar day containing t. Offset approximated from longitude
    (15° per hour) so it works in any region without a timezone database."""
    offset = timedelta(hours=round((lng or 0) / 15))
    local_midnight = (t.astimezone(timezone.utc) + offset).replace(hour=0, minute=0, second=0, microsecond=0)
    start = local_midnight - offset
    return start, start + timedelta(days=1)


def apply_walk_scores(conn: psycopg.Connection, walk: dict, centroid: tuple[float, float] | None) -> None:
    """Recompute this walk's species ledger rows and walk_species.points. Idempotent.
    walk: row with id, user_id, started_at. centroid: (lng, lat) or None."""
    lng = centroid[0] if centroid else None
    day_start, day_end = local_day_bounds(walk["started_at"], lng)
    already = {
        (r["species_code"], r["reason"])
        for r in conn.execute(
            """
            select d.species_code, l.reason
              from points_ledger l
              join walks w on w.id = l.walk_id
              join detections d on d.id = l.ref_id
             where l.user_id = %(u)s and l.walk_id <> %(w)s and l.reason = 'species_heard'
               and w.started_at >= %(s)s and w.started_at < %(e)s
            union
            select p.species_code, l.reason
              from points_ledger l
              join walks w on w.id = l.walk_id
              join photos p on p.id = l.ref_id
             where l.user_id = %(u)s and l.walk_id <> %(w)s
               and l.reason in ('species_photographed', 'anomaly_confirmed')
               and w.started_at >= %(s)s and w.started_at < %(e)s
            """,
            {"u": walk["user_id"], "w": walk["id"], "s": day_start, "e": day_end},
        )
    }
    species = [
        ScoredSpecies(
            species_code=r["species_code"], rarity_tier=r["rarity_tier"], heard=r["heard"],
            photographed=r["photographed"], is_anomaly=r["is_anomaly"],
            detection_id=r["best_detection_id"], photo_id=r["photo_id"],
        )
        for r in conn.execute(
            "select species_code, rarity_tier, heard, photographed, is_anomaly, best_detection_id, photo_id"
            "  from walk_species where walk_id = %s",
            (walk["id"],),
        )
    ]
    awards = score_species(species, already)

    conn.execute(
        "delete from points_ledger where walk_id = %s and reason = any(%s)", (walk["id"], list(SPECIES_REASONS))
    )
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into points_ledger (user_id, amount, reason, walk_id, ref_id, geog)
            values (%s, %s, %s, %s, %s,
                    case when %s::float8 is null then null
                         else ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography end)
            """,
            [
                (walk["user_id"], a.amount, a.reason, walk["id"], a.ref_id,
                 lng, lng, centroid[1] if centroid else None)
                for a in awards
            ],
        )
    conn.execute("update walk_species set points = 0 where walk_id = %s", (walk["id"],))
    totals: dict[str, int] = {}
    for a in awards:
        totals[a.species_code] = totals.get(a.species_code, 0) + a.amount
    with conn.cursor() as cur:
        cur.executemany(
            "update walk_species set points = %s where walk_id = %s and species_code = %s",
            [(pts, walk["id"], code) for code, pts in totals.items()],
        )
