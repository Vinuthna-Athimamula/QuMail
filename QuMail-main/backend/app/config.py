from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    supabase_anon_key: str | None = None

    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    google_oauth_scopes: str = "https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/userinfo.email"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_app_url: str = "http://localhost:5173"

    sync_interval_seconds: int = 20
    gmail_query: str = "newer_than:7d"
    qkd_presence_ttl_seconds: int = 60
    qkd_session_ttl_seconds: int = 3600
    qkd_max_buffer_mb: int = 128

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def scopes(self) -> list[str]:
        scopes = [scope.strip() for scope in self.google_oauth_scopes.split(",") if scope.strip()]
        if "openid" not in scopes:
            scopes.append("openid")
        return scopes

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_auth_key(self) -> str:
        return self.supabase_anon_key or self.supabase_service_role_key


settings = Settings()
