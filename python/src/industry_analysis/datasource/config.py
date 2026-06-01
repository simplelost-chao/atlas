from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class DataSourceSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="IA_DATASOURCE_", env_file=".env", extra="ignore"
    )

    cache_dir: Path = Path("data/datasource")
    cn_filings_db: Path | None = None
    sec_user_agent: str = "IndustryAnalysis/1.0 contact@example.com"
    cn_rate_limit: float = 1.0
    sec_rate_limit: float = 0.12

    @property
    def cn_filings_db_path(self) -> Path:
        return self.cn_filings_db if self.cn_filings_db else self.cache_dir / "CN" / "filings.db"

    @property
    def us_filings_db_path(self) -> Path:
        return self.cache_dir / "US" / "filings.db"

    @property
    def datasource_db_path(self) -> Path:
        return self.cache_dir / "datasource.db"


def get_datasource_settings() -> DataSourceSettings:
    return DataSourceSettings()
