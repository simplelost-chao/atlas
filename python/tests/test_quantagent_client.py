import subprocess
import pytest
from industry_analysis.quantagent.client import QuantAgentClient, QuantAgentError

class _Done:
    def __init__(self, rc, out="", err=""):
        self.returncode, self.stdout, self.stderr = rc, out, err

def test_run_returns_stdout(monkeypatch):
    captured = {}
    def fake_run(cmd, **kw):
        captured["cmd"] = cmd
        return _Done(0, out='{"children": []}')
    monkeypatch.setattr(subprocess, "run", fake_run)
    c = QuantAgentClient(cli_path="x/cli.js", agents_dir="a", node_path="node")
    assert c.run("chain-miner", "hello") == '{"children": []}'
    assert captured["cmd"][:5] == ["node", "x/cli.js", "--agent", "chain-miner", "--agents-dir"]

def test_nonzero_raises(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: _Done(1, err="boom"))
    c = QuantAgentClient(cli_path="x", agents_dir="a")
    with pytest.raises(QuantAgentError, match="boom"):
        c.run("chain-miner", "hi")
