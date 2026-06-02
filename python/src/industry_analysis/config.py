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
    return str(candidates[0])


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="IA_", env_file=".env", extra="ignore")

    # ── Data root ───────────────────────────────────────────────────────────
    # Set IA_DATA_ROOT to relocate all data off OneDrive / onto a fast drive.
    # Default: atlas-work/python/data/ (in-repo, for dev/CI use).
    # Production example: IA_DATA_ROOT=D:/quantdata/atlas
    data_root: Path = _PYTHON_ROOT / "data"

    # ── Derived paths (all relative to data_root unless explicitly overridden)
    # Override individually via IA_DB_PATH, IA_DATASOURCE_DB_PATH etc.
    db_path: Path | None = None           # graph.db + queue
    datasource_db_path: Path | None = None  # datasource.db (FTS + mentions)
    cn_filings_db_path: Path | None = None  # external A-share filings (read-only)
    us_filings_db_path: Path | None = None  # US 10-K filings cache

    # ── QuantAgent ──────────────────────────────────────────────────────────
    quantagent_cli: str = _default_quantagent_cli()
    quantagent_agents_dir: str = str(_PYTHON_ROOT / ".quantagent" / "agents")
    node_path: str = "node"
    quantagent_timeout: int = 600

    # ── Mining ──────────────────────────────────────────────────────────────
    auto_confirm_grade: str | None = None
    dashboard_port: int = 8300

    # ── Atlas Postgres ──────────────────────────────────────────────────────
    atlas_db_url: str | None = None

    # ── Resolved path helpers ───────────────────────────────────────────────

    def resolved_db_path(self) -> Path:
        return self.db_path or (self.data_root / "graph" / "graph.db")

    def resolved_datasource_db(self) -> Path | None:
        if self.datasource_db_path:
            return self.datasource_db_path
        p = self.data_root / "datasource" / "datasource.db"
        return p if p.exists() else None

    def resolved_cn_filings_db(self) -> Path | None:
        if self.cn_filings_db_path:
            return self.cn_filings_db_path
        # Check standard quantdata location first
        default = Path("D:/quantdata/markets/CN/filings.db")
        if default.exists():
            return default
        p = self.data_root / "datasource" / "CN" / "filings.db"
        return p if p.exists() else None

    def resolved_us_filings_db(self) -> Path:
        return self.us_filings_db_path or (self.data_root / "datasource" / "US" / "filings.db")


def get_settings() -> Settings:
    return Settings()
