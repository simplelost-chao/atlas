from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py is at:  atlas-work/python/src/industry_analysis/config.py
_PYTHON_ROOT = Path(__file__).parent.parent.parent   # atlas-work/python/
_ATLAS_ROOT  = _PYTHON_ROOT.parent                   # atlas-work/
_QUANT_ROOT  = _ATLAS_ROOT.parent                    # quant/

# Auto-detect QuantAgent: check sibling of atlas-work first, then fallback
def _default_quantagent_cli() -> str:
    candidates = [
        _QUANT_ROOT / "QuantAgent" / "dist" / "cli.js",
        _ATLAS_ROOT / "QuantAgent" / "dist" / "cli.js",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return str(candidates[0])  # return best guess even if missing (env var overrides)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="IA_", env_file=".env", extra="ignore")

    db_path: Path = Path("data/graph.db")
    quantagent_cli: str = _default_quantagent_cli()
    # agents dir: relative to python/ root so it works regardless of CWD
    quantagent_agents_dir: str = str(_PYTHON_ROOT / ".quantagent" / "agents")
    node_path: str = "node"
    quantagent_timeout: int = 600
    dashboard_port: int = 8300
    auto_confirm_grade: str | None = None
    # Optional datasource DB path for evidence grounding in expand prompts
    datasource_db_path: Path | None = None


def get_settings() -> Settings:
    return Settings()
