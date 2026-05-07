import os
from pathlib import Path

from pydantic_settings import BaseSettings


# Load repo-root `.env` into os.environ before Settings is instantiated.
#
# Pydantic Settings reads .env relative to the current working
# directory — typically `backend/` when uvicorn starts. Our repo's
# .env lives at the repo root (one level up), so without this loader
# Pydantic finds nothing and `settings.anthropic_api_key` stays empty.
#
# Two consumers depend on these values:
#   1. The backend itself — Pydantic AI / SDK calls — picks them up
#      via the standard env-var path once they're in os.environ.
#   2. claude_runner.py — spawns the Claude CLI as a subprocess with
#      `env={**os.environ, ...}`. Without this loader, the subprocess
#      inherits an empty ANTHROPIC_API_KEY and the agent run fails
#      with auth error on a fresh laptop where the operator never
#      exported the key in their shell rc.
#
# Existing env vars always win — if the operator already exported
# ANTHROPIC_API_KEY in their shell, we leave it alone. Comment lines
# and blank lines in .env are ignored. Surrounding quotes (single or
# double) on values are stripped.
def _load_repo_root_dotenv() -> None:
    repo_root = Path(__file__).resolve().parent.parent.parent
    env_file = repo_root / ".env"
    if not env_file.exists():
        return
    try:
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (
                value.startswith("'") and value.endswith("'")
            ):
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        # Disk hiccup or permissions — leave os.environ alone, Settings
        # will fall back to its declared defaults.
        pass


_load_repo_root_dotenv()


class Settings(BaseSettings):
    # Server
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Database
    database_url: str = "postgresql+asyncpg://discovery_user:discovery_pass@localhost:5432/discovery_db"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # RAGFlow
    ragflow_url: str = "http://localhost:9380"
    ragflow_api_key: str = ""

    # Anthropic
    anthropic_api_key: str = ""

    # Auth
    jwt_secret: str = "change-this-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 720  # 30 days for dev

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Integrations / Connectors
    # Fernet key for encrypting connector secrets at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    integration_secret_key: str = ""
    # Google OAuth (Gmail + Drive)
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_redirect_uri: str = ""  # Derived from api_port if not set
    # Frontend URL to redirect back to after OAuth success/failure
    frontend_url: str = "http://localhost:3000"

    # Public URL of the Discovery backend (the one teammates' laptops
    # hit for /mcp + /vaults git clone). Defaults to the api_host:port
    # for dev; production deploys override this with the nginx-fronted
    # https URL via env var DISCOVERY_PUBLIC_URL.
    public_url: str = "http://localhost:8008"

    # File uploads
    upload_max_size_mb: int = 50

    # Assistants prompts directory
    assistants_dir: str = str(Path(__file__).parent.parent.parent / "assistants")

    # Project types
    project_types: list[str] = [
        "Greenfield", "Add-on", "Feature Extension", "API", "Mobile", "Custom"
    ]

    @property
    def effective_redirect_uri(self) -> str:
        if self.google_oauth_redirect_uri:
            return self.google_oauth_redirect_uri
        return f"http://localhost:{self.api_port}/api/integrations/google/callback"

    @property
    def assistants_path(self) -> Path:
        return Path(self.assistants_dir)

    @property
    def agents_path(self) -> Path:
        return self.assistants_path / ".claude" / "agents"

    @property
    def skills_path(self) -> Path:
        return self.assistants_path / ".claude" / "skills"

    @property
    def templates_path(self) -> Path:
        return self.assistants_path / ".claude" / "templates"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
