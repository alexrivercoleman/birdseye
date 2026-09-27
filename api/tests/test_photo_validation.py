"""Photo classification smoke checks; no external services or credentials needed."""

import json
from contextlib import nullcontext
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from pydantic import ValidationError

from app.birds import ebird
from app.photos import pipeline, validation, vision

ON = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)
CANDIDATES = [
    {"species_code": "a", "common_name": "Bird A", "confidence": 0.60},
    {"species_code": "b", "common_name": "Bird B", "confidence": 0.52},
]


def observation(code, on, lat=33.75, lng=-84.39):
    return {"speciesCode": code, "obsDt": on.isoformat(), "lat": lat, "lng": lng}


@pytest.fixture
def bird_services(monkeypatch):
    monkeypatch.setattr(validation, "get_settings", lambda: SimpleNamespace(ebird_api_key="test"))
    monkeypatch.setattr(validation.db, "connect", lambda: nullcontext(Mock()))
    recent = Mock(return_value=[])
    hotspots = Mock(return_value=[{"locId": "L1", "lat": 33.75, "lng": -84.39}])
    history = Mock(return_value=[])
    monkeypatch.setattr(ebird, "nearby_photo_observations", recent)
    monkeypatch.setattr(ebird, "nearby_hotspots", hotspots)
    monkeypatch.setattr(ebird, "historic_photo_observations", history)
    return recent, hotspots, history


def rank(candidates=CANDIDATES, on=ON):
    return validation.rerank_candidates(candidates, 33.75, -84.39, on, today=ON.date())


def test_local_report_reranks_without_changing_confidence_or_dropping_species(bird_services):
    recent, _, _ = bird_services
    recent.return_value = [observation("b", ON.date())]
    original = json.dumps(CANDIDATES)
    assert rank() == [CANDIDATES[1], CANDIDATES[0]]
    assert json.dumps(CANDIDATES) == original


def test_seasonal_support_breaks_close_visual_match(bird_services):
    _, _, history = bird_services
    history.side_effect = lambda conn, ids, on: [observation("b", on)]
    candidates = [CANDIDATES[0] | {"confidence": 0.55}, CANDIDATES[1]]
    assert rank(candidates)[0]["species_code"] == "b"
    assert [c.args[2] for c in history.call_args_list] == validation.seasonal_dates(ON.date())


def test_no_reports_preserves_rare_candidate_and_order(bird_services):
    assert rank() == CANDIDATES


def test_future_old_and_distant_reports_do_not_boost(bird_services):
    recent, _, history = bird_services
    recent.return_value = [
        observation("b", date(2026, 9, 27)), observation("b", date(2026, 8, 1)),
        observation("b", ON.date(), lat=0, lng=0),
    ]
    history.return_value = [observation("b", date(2025, 1, 1))]
    assert rank() == CANDIDATES


def test_old_photo_uses_capture_date_history_not_current_sightings(bird_services):
    recent, _, history = bird_services
    old = ON.replace(year=2024, month=1)
    history.side_effect = lambda conn, ids, on: [observation("b", on)] if on == old.date() else []
    assert rank(on=old)[0]["species_code"] == "b"
    recent.assert_not_called()
    assert history.call_args_list[0].args[2] == old.date()
    assert all(c.args[2] <= old.date() for c in history.call_args_list)


def test_ebird_error_keeps_visual_result(bird_services):
    recent, _, _ = bird_services
    recent.side_effect = httpx.ReadTimeout("eBird timeout")
    assert rank() is CANDIDATES


def test_missing_key_location_and_future_photo_skip_requests(bird_services, monkeypatch):
    recent, hotspots, history = bird_services
    assert validation.rerank_candidates(CANDIDATES, None, None, ON) is CANDIDATES
    assert validation.rerank_candidates(CANDIDATES, float("nan"), 0, ON) is CANDIDATES
    assert rank(on=ON.replace(year=2027)) is CANDIDATES
    monkeypatch.setattr(validation, "get_settings", lambda: SimpleNamespace(ebird_api_key=""))
    assert rank() is CANDIDATES
    for call in bird_services:
        call.assert_not_called()


def test_leap_day_samples_are_valid():
    assert validation.seasonal_dates(date(2024, 2, 29)) == [date(2023, 2, 21), date(2023, 2, 28), date(2023, 3, 7)]


def test_date_and_parameters_are_part_of_cache_key(monkeypatch):
    stored = {}
    conn = Mock()
    def execute(sql, args):
        if sql.startswith("select"):
            return SimpleNamespace(fetchone=lambda: {"payload": stored[args[0]]} if args[0] in stored else None)
        stored[args[0]] = args[1].obj
    conn.execute.side_effect = execute
    get = Mock(return_value=[observation("b", ON.date()) | {"userDisplayName": "not cached"}])
    monkeypatch.setattr(ebird, "_get", get)
    first = ebird.historic_photo_observations(conn, ["L2", "L1"], ON.date())
    assert "obsDt" in first[0] and "userDisplayName" not in first[0]
    assert ebird.historic_photo_observations(conn, ["L1", "L2"], ON.date()) == first
    assert get.call_count == 1
    ebird.historic_photo_observations(conn, ["L1", "L2"], date(2025, 9, 26))
    ebird.nearby_photo_observations(conn, 33.75, -84.39, 25)
    ebird.nearby_photo_observations(conn, 33.75, -84.39, 50)
    assert get.call_count == 4
    assert get.call_args_list[0].args[0] == "/data/obs/L1/historic/2026/9/26"
    assert get.call_args_list[0].args[1]["r"] == "L1,L2"


def result(**overrides):
    return {"species": "Bird A", "scientific_name": "Genus alpha", "confidence": 0.6,
            "runner_up_candidates": [], **overrides}


def test_taxonomy_resolution_deduplicates_and_drops_unknowns():
    raw = result(runner_up_candidates=[
        {"species": "Bird A alias", "scientific_name": "Genus alpha", "confidence": 0.5},
        {"species": "Invented bird", "scientific_name": "Invented species", "confidence": 0.3},
    ])
    taxonomy = [{"species_code": "a", "common_name": "Bird A", "sci_name": "Genus alpha"}]
    assert vision.taxonomy_candidates(vision.Identification.model_validate(raw), taxonomy) == [CANDIDATES[0]]
    unknown = vision.Identification.model_validate(result(species=None, scientific_name=None, confidence=0))
    assert vision.taxonomy_candidates(unknown, taxonomy) == []
    with pytest.raises(ValidationError):
        vision.Identification.model_validate(result(confidence=1.1))


def test_llm_request_sends_image_location_and_schema(monkeypatch):
    monkeypatch.setattr(vision, "get_settings", lambda: SimpleNamespace(openai_api_key="test", openai_vision_model="gpt-6-astra"))
    client = Mock()
    client.responses.create.return_value = SimpleNamespace(status="completed", output_text=json.dumps(result()))
    monkeypatch.setattr(vision, "OpenAI", lambda **kwargs: nullcontext(client))
    assert vision.classify(b"photo", "image/jpeg", "Test Park").species == "Bird A"
    request = client.responses.create.call_args.kwargs
    assert request["model"] == "gpt-6-astra"
    assert "Test Park" in request["input"][0]["content"][0]["text"]
    assert request["input"][0]["content"][1]["image_url"] == "data:image/jpeg;base64,cGhvdG8="
    assert request["text"]["format"]["strict"] is True
    client.responses.create.return_value = SimpleNamespace(status="incomplete", output_text="")
    with pytest.raises(ValueError):
        vision.classify(b"photo", "image/jpeg", "Test Park")


def test_pipeline_passes_photo_location_date_to_vision(monkeypatch):
    # The shared provider defaults to Meta; it must not disable photo vision.
    monkeypatch.setenv("LLM_PROVIDER", "meta")
    monkeypatch.setattr(pipeline.db, "connect", Mock(side_effect=AssertionError("Photo suggestions must not query audio detections")))
    identify = Mock(return_value=CANDIDATES)
    monkeypatch.setattr(vision, "identify", identify)
    assert pipeline._suggest(b"photo", "image/jpeg", lat=33.75, lng=-84.39, captured_at=ON) == CANDIDATES
    identify.assert_called_once_with(b"photo", "image/jpeg", lat=33.75, lng=-84.39, captured_at=ON)


def test_identify_runs_ebird_after_visual_classification(monkeypatch):
    events = []
    def classify(*args):
        events.append("llm")
        return vision.Identification.model_validate(result())
    def rerank(candidates, lat, lng, captured_at):
        events.append("ebird")
        assert candidates == [CANDIDATES[0]]
        assert (lat, lng, captured_at) == (33.75, -84.39, ON)
        return candidates
    conn = Mock()
    conn.execute.return_value.fetchall.return_value = [{"species_code": "a", "common_name": "Bird A", "sci_name": "Genus alpha"}]
    monkeypatch.setattr(vision.db, "connect", lambda: nullcontext(conn))
    monkeypatch.setattr(vision, "classify", classify)
    monkeypatch.setattr(vision, "rerank_candidates", rerank)
    assert vision.identify(b"photo", "image/jpeg", lat=33.75, lng=-84.39, captured_at=ON) == [CANDIDATES[0]]
    assert events == ["llm", "ebird"]


@pytest.mark.parametrize("failure", [
    ValueError("Set OPENAI_API_KEY and OPENAI_VISION_MODEL to enable photo identification"),
    RuntimeError("Vision service unavailable"),
])
def test_photo_failure_never_uses_heard_species(monkeypatch, failure):
    conn = Mock()
    photo = {"id": "photo", "storage_path": "walk/photo.jpg", "lat": 33.75, "lng": -84.39, "captured_at": ON}
    def execute(sql, args):
        assert "detections" not in sql
        assert "walk_species" not in sql
        return SimpleNamespace(fetchone=lambda: photo)
    conn.execute.side_effect = execute
    monkeypatch.setattr(pipeline.db, "connect", lambda: nullcontext(conn))
    monkeypatch.setattr(pipeline.storage, "upload", Mock())
    monkeypatch.setattr(vision, "identify", Mock(side_effect=failure))
    pipeline.process_photo("photo", b"image", "image/jpeg")
    saved = conn.execute.call_args.args[1]
    assert saved[0].obj == []
    assert saved[1] == "unidentified"


def test_photo_processed_without_any_audio_detections(monkeypatch):
    conn = Mock()
    photo = {"id": "photo", "storage_path": "walk/photo.jpg", "lat": 33.75, "lng": -84.39, "captured_at": ON}
    def execute(sql, args):
        # There is no detections table or walk species data in this fixture.
        assert "detections" not in sql and "walk_species" not in sql
        return SimpleNamespace(fetchone=lambda: photo)
    conn.execute.side_effect = execute
    monkeypatch.setattr(pipeline.db, "connect", lambda: nullcontext(conn))
    monkeypatch.setattr(pipeline.storage, "upload", Mock())
    identify = Mock(return_value=CANDIDATES)
    monkeypatch.setattr(vision, "identify", identify)
    pipeline.process_photo("photo", b"image", "image/jpeg")
    identify.assert_called_once_with(b"image", "image/jpeg", lat=33.75, lng=-84.39, captured_at=ON)
    saved = conn.execute.call_args.args[1]
    assert saved[0].obj == CANDIDATES
    assert saved[1] == "needs_confirmation"
