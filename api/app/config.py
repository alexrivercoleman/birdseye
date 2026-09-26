from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    ebird_api_key: str = ""
    mapbox_token: str = ""

    llm_provider: str = "meta"
    meta_llm_api_key: str = ""
    meta_llm_base_url: str = ""
    meta_text_model: str = ""
    meta_vision_model: str = ""
    openai_api_key: str = ""
    openai_text_model: str = ""
    openai_vision_model: str = ""

    min_conf: float = 0.6
    anomaly_conf: float = 0.85
    default_lat: float = 33.749
    default_lng: float = -84.388

    cors_origins: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()
