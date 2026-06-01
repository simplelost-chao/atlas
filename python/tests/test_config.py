from industry_analysis.config import Settings

def test_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("IA_DB_PATH", str(tmp_path / "g.db"))
    s = Settings()
    assert str(s.db_path).endswith("g.db")
    assert s.dashboard_port == 8300
    assert s.quantagent_cli.endswith("cli.js")
    assert s.auto_confirm_grade is None  # gate on by default
