import json
from typer.testing import CliRunner
from industry_analysis.cli.main import app

runner = CliRunner()

def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("IA_DB_PATH", str(tmp_path / "g.db"))

def test_theme_load_and_list_json(tmp_path, monkeypatch):
    _env(tmp_path, monkeypatch)
    assert runner.invoke(app, ["theme", "load"]).exit_code == 0
    res = runner.invoke(app, ["node", "list", "--type", "theme", "--json"])
    assert res.exit_code == 0
    data = json.loads(res.stdout)
    assert len(data) == 13

def test_chokepoints_empty(tmp_path, monkeypatch):
    _env(tmp_path, monkeypatch)
    runner.invoke(app, ["theme", "load"])
    res = runner.invoke(app, ["chokepoints", "--json"])
    assert json.loads(res.stdout) == []
