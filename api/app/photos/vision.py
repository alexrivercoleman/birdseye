"""Photo -> structured LLM candidates -> eBird taxonomy -> local/seasonal ranking."""

import base64
import logging
from datetime import datetime

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field

from app import db
from app.config import get_settings
from app.photos.prompts import PHOTO_IDENTIFICATION_SCHEMA, SYSTEM_PROMPT, build_user_prompt
from app.photos.validation import rerank_candidates

log = logging.getLogger(__name__)


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    species: str
    scientific_name: str
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)


class Identification(Candidate):
    species: str | None
    scientific_name: str | None
    runner_up_candidates: list[Candidate] = Field(max_length=2)


def classify(image: bytes, mime: str, location: str | None) -> Identification:
    """Call Responses with the actual image and enforce the prompt's JSON schema."""
    settings = get_settings()
    mime = mime.split(";")[0].strip().lower()
    if mime not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise ValueError(f"Unsupported vision image type: {mime}")
    if not image:
        raise ValueError("Photo is empty")
    if not settings.openai_api_key or not settings.openai_vision_model:
        raise ValueError("Set OPENAI_API_KEY and OPENAI_VISION_MODEL to enable photo identification")
    encoded = base64.b64encode(image).decode("ascii")
    with OpenAI(api_key=settings.openai_api_key, timeout=45, max_retries=1) as client:
        response = client.responses.create(
            model=settings.openai_vision_model,
            instructions=SYSTEM_PROMPT,
            input=[{"role": "user", "content": [
                {"type": "input_text", "text": build_user_prompt(location)},
                {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}"},
            ]}],
            text={"format": {
                "type": "json_schema", "name": "bird_identification",
                "strict": True, "schema": PHOTO_IDENTIFICATION_SCHEMA,
            }},
            store=False,
        )
    if response.status != "completed" or not response.output_text:
        raise ValueError("Photo identification did not return a completed JSON result")
    return Identification.model_validate_json(response.output_text)


def taxonomy_candidates(result: Identification, taxonomy: list[dict]) -> list[dict]:
    """Resolve exact names to canonical eBird codes; drop unknowns and duplicates."""
    if result.species is None or result.scientific_name is None:
        return []
    by_sci = {r["sci_name"].strip().casefold(): r for r in taxonomy}
    by_common = {r["common_name"].strip().casefold(): r for r in taxonomy}
    mapped = {}
    for candidate in [result, *result.runner_up_candidates]:
        taxon = by_sci.get(candidate.scientific_name.strip().casefold()) or by_common.get(candidate.species.strip().casefold())
        if taxon is None:
            log.info("Photo candidate could not be resolved to eBird taxonomy")
            continue
        code = taxon["species_code"]
        if code not in mapped or candidate.confidence > mapped[code]["confidence"]:
            mapped[code] = {"species_code": code, "common_name": taxon["common_name"], "confidence": candidate.confidence}
    return sorted(mapped.values(), key=lambda c: c["confidence"], reverse=True)


def identify(
    image: bytes, mime: str, *, lat: float | None, lng: float | None, captured_at: datetime | None,
) -> list[dict]:
    location = f"latitude {lat}, longitude {lng}" if lat is not None and lng is not None else None
    result = classify(image, mime, location)
    if result.species is None or result.scientific_name is None:
        return []
    with db.connect() as conn:
        taxonomy = conn.execute("select species_code, common_name, sci_name from ebird_taxonomy").fetchall()
    candidates = taxonomy_candidates(result, taxonomy)
    return rerank_candidates(candidates, lat, lng, captured_at)
