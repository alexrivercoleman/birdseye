from datetime import datetime, timezone

from app.game.scoring import ScoredSpecies, local_day_bounds, score_species


def _sp(code="carwre", tier="common", heard=True, photographed=False, anomaly=False):
    return ScoredSpecies(code, tier, heard, photographed, anomaly, detection_id="d-" + code, photo_id="p-" + code)


def _total(awards):
    return sum(a.amount for a in awards)


def test_tier_amounts():
    assert _total(score_species([_sp(tier="common")], set())) == 10
    assert _total(score_species([_sp(tier="uncommon")], set())) == 20
    assert _total(score_species([_sp(tier="rare")], set())) == 50


def test_heard_and_photographed_score_independently():
    awards = score_species([_sp(tier="uncommon", photographed=True)], set())
    assert {(a.reason, a.amount, a.ref_id) for a in awards} == {
        ("species_heard", 20, "d-carwre"),
        ("species_photographed", 20, "p-carwre"),
    }


def test_once_per_day_per_reason():
    awards = score_species([_sp(photographed=True)], {("carwre", "species_heard")})
    assert [a.reason for a in awards] == ["species_photographed"]


def test_unconfirmed_anomaly_scores_zero():
    assert score_species([_sp(tier="rare", anomaly=True)], set()) == []


def test_confirmed_anomaly_scores_rare_plus_bonus():
    # tier is ignored for anomalies: always the rare amount
    awards = score_species([_sp(tier="common", photographed=True, anomaly=True)], set())
    assert _total(awards) == 50 + 50 + 100
    assert "anomaly_confirmed" in {a.reason for a in awards}


def test_multiple_species():
    awards = score_species([_sp("carwre"), _sp("pilwoo", tier="uncommon"), _sp("norcar", heard=False)], set())
    assert _total(awards) == 30  # norcar neither heard nor photographed


def test_local_day_bounds_atlanta_evening():
    # lng -84.4 → UTC-6 by longitude (real EDT is UTC-4, so the day boundary lands ~2 AM local; fine).
    # 01:30 UTC on the 26th is the evening of the 25th locally.
    start, end = local_day_bounds(datetime(2026, 9, 26, 1, 30, tzinfo=timezone.utc), -84.4)
    assert start == datetime(2026, 9, 25, 6, tzinfo=timezone.utc)
    assert end == datetime(2026, 9, 26, 6, tzinfo=timezone.utc)
