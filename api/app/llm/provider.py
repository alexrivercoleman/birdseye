"""LLM provider interface (§7.12). LLM_PROVIDER=meta uses Meta's OpenAI-compatible endpoint when META_LLM_* is set;
otherwise (or with LLM_PROVIDER=openai) it's OpenAI. Sync, because callers run in the finish pipeline's worker thread.
"""

import json
import re
from functools import lru_cache

from openai import OpenAI

from app.config import get_settings

DEFAULT_OPENAI_TEXT_MODEL = "gpt-5.4-mini"
TIMEOUT_S = 60


@lru_cache
def _text_client() -> tuple[OpenAI, str]:
    s = get_settings()
    if s.llm_provider == "meta" and s.meta_llm_api_key and s.meta_llm_base_url and s.meta_text_model:
        return OpenAI(api_key=s.meta_llm_api_key, base_url=s.meta_llm_base_url, timeout=TIMEOUT_S), s.meta_text_model
    if not s.openai_api_key:
        raise RuntimeError("no LLM configured: set OPENAI_API_KEY (or META_LLM_API_KEY/BASE_URL/TEXT_MODEL)")
    return OpenAI(api_key=s.openai_api_key, timeout=TIMEOUT_S), s.openai_text_model or DEFAULT_OPENAI_TEXT_MODEL


def _parse_json(text: str) -> dict:
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text)
    return json.loads(text)


def complete_json(system: str, user: str) -> dict:
    """One chat completion that must return a JSON object. Retries once on unparseable output."""
    client, model = _text_client()
    error: json.JSONDecodeError | None = None
    for _ in range(2):
        r = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
        )
        try:
            return _parse_json(r.choices[0].message.content or "")
        except json.JSONDecodeError as e:
            error = e
    raise error
