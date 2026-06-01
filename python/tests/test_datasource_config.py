from pathlib import Path
from industry_analysis.datasource.config import DataSourceSettings

def test_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("IA_DATASOURCE_CACHE_DIR", str(tmp_path / "ds"))
    s = DataSourceSettings()
    assert s.cache_dir == tmp_path / "ds"
    assert s.cn_filings_db is None
    assert s.cn_filings_db_path == tmp_path / "ds" / "CN" / "filings.db"
    assert s.us_filings_db_path == tmp_path / "ds" / "US" / "filings.db"
    assert s.datasource_db_path == tmp_path / "ds" / "datasource.db"

def test_override_cn_filings_db(tmp_path, monkeypatch):
    custom = tmp_path / "existing.db"
    monkeypatch.setenv("IA_DATASOURCE_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("IA_DATASOURCE_CN_FILINGS_DB", str(custom))
    s = DataSourceSettings()
    assert s.cn_filings_db_path == custom
