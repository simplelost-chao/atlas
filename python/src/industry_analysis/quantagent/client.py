import subprocess


class QuantAgentError(Exception):
    pass


class QuantAgentClient:
    def __init__(self, cli_path: str, agents_dir: str, node_path: str = "node", timeout: int = 600):
        self.cli_path, self.agents_dir, self.node_path, self.timeout = cli_path, agents_dir, node_path, timeout

    def run(self, agent: str, prompt: str) -> str:
        cmd = [self.node_path, self.cli_path, "--agent", agent,
               "--agents-dir", self.agents_dir, "--prompt", prompt]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout)
        if proc.returncode != 0:
            raise QuantAgentError(f"QuantAgent '{agent}' failed (rc={proc.returncode}): {proc.stderr.strip()}")
        return proc.stdout
