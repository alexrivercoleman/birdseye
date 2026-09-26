# Photo identification with eBird validation

Photo uploads now run this backend sequence:

1. `vision.classify` sends the photo and location prompt in `prompts.py` to OpenAI
   using the configured vision model and a strict JSON schema.
2. `vision.taxonomy_candidates` resolves the primary species and up to two
   runners-up to the existing eBird taxonomy. Unknown names and duplicates are
   filtered out. An unidentifiable photo produces no suggestions.
3. `validation.rerank_candidates` checks the photo's own coordinates and capture
   date against eBird, then reorders the candidates.
4. `pipeline.process_photo` saves the existing suggestion shape for the photo
   confirmation screen. No database migration or frontend change is needed.

## Enable it

Set these in `api/.env` on the backend (never in frontend environment variables):

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_VISION_MODEL=gpt-6-astra
EBIRD_API_KEY=your-ebird-api-key
```

The existing database and storage configuration must also be set. Taxonomy loads
at API startup if empty; to populate or refresh it manually, run from `api/`:

```sh
python -m app.birds.ebird
```

Rebuild the backend from the repository root on the deployment host:

```sh
docker compose up -d --build api
docker compose logs -f api
```

Upload a JPEG, PNG, WebP, or non-animated GIF through the app with frontend mocks
disabled. Polling the photo endpoint should reach `needs_confirmation` with up to
three species suggestions. Logs include the number of candidates matched by the
eBird check. HEIC/HEIF must be converted before this vision call; unsupported
formats or failed LLM requests leave the photo `unidentified`.

Without OpenAI configuration the original heard-on-this-walk fallback remains.
Without an eBird key, re-ranking is skipped (taxonomy must already be populated).
An eBird outage retains the LLM-derived suggestions and original confidence values.

## Location and season evidence

- Radius: **25 km**, checked again against each returned record's coordinates.
- For photos less than 30 days old, use reviewed recent observations and exclude
  records after the capture date or more than 29 days before it. eBird supplies
  only the latest record per species, so this is supporting evidence, not an
  exhaustive history of that window.
- For older photos, use historical observations on the capture date at up to
  **20 nearest public hotspots** in that radius; never compare an old photo to
  today's recent observations.
- Seasonal support samples **three dates in the previous year**: the corresponding
  calendar date and seven days either side. Leap day maps to February 28. These
  samples query the same nearby hotspots. This is a bounded seasonal plausibility
  check, not a migration/range model or a complete seasonal frequency estimate.
- Dates follow the stored capture timestamp's calendar date (normally UTC).
  Missing coordinates/date, invalid coordinates, and future dates skip validation.
- All queries are cached for **24 hours** in the existing `ebird_cache` table.
  Cache keys include endpoint, coordinates, radius, dates, and location IDs.

The internal ranking score is the original LLM confidence plus **0.10** for a
recent/capture-date match and **0.05** for any seasonal match. These initial
heuristic weights can move closely matched candidates; they need evaluation on
real labeled photos. The API's `confidence` remains the original LLM estimate,
not this ranking score or a calibrated probability. Candidates with no eBird
reports remain available, including possible rarities. Empty/sparse coverage
adds no boost. Any lookup failure preserves the original ranking.

## Checks and API references

From `api/`, run `python -m pytest tests/test_photo_validation.py`. These tests mock
both external APIs and the database; they do not make billable model calls.

Endpoint definitions verified against the official
[eBird API 2.0 documentation](https://documenter.getpostman.com/view/664302/S1ENwy59):
`/data/obs/geo/recent`, `/ref/hotspot/geo`, and
`/data/obs/{regionCode}/historic/{year}/{month}/{day}` with the `r` location list.
The historical API supports up to 50 locations per request; this implementation
uses at most 20. Only reviewed species records are requested.

The OpenAI call follows the official
[vision input guide](https://developers.openai.com/api/docs/guides/images-vision)
and [structured output guide](https://developers.openai.com/api/docs/guides/structured-outputs).
