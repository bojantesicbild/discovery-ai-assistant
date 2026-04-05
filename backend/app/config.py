from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
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

    # File uploads
    upload_max_size_mb: int = 50

    # Assistants prompts directory
    assistants_dir: str = str(Path(__file__).parent.parent.parent / "assistants")

    # Project types
    project_types: list[str] = [
        "Greenfield", "Add-on", "Feature Extension", "API", "Mobile", "Custom"
    ]

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
