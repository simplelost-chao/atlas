from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="IA_", env_file=".env", extra="ignore")

    db_path: Path = Path("data/graph.db")
    quantagent_cli: str = "../QuantAgent/dist/cli.js"
    quantagent_agents_dir: str = ".quantagent/agents"
    node_path: str = "node"
    quantagent_timeout: int = 600
    dashboard_port: int = 8300
    # When set (e.g. "B"), structural nodes with grade <= this auto-confirm; None keeps full manual gate.
    auto_confirm_grade: str | None = None


def get_settings() -> Settings:
    return Settings()
