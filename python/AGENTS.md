# IndustryAnalysis

ARK-2026-theme-rooted 产业链 DAG. Mines downstream→upstream via the QuantAgent CLI.

## Architecture
- This project does NO LLM calls. All node expansion goes through QuantAgent CLI.
- SQLite (`data/graph.db`) is the single source of truth (nodes/edges/review_log/evidence_md).
- Cross-theme shared nodes (chokepoints) emerge from alias-based dedup adding extra upstream_of edges.

## Edge convention
Edge = (upstream_id, downstream_id), "upstream supplies downstream". Expanding N adds (candidate, N).

## Commands
- `pip install -e ".[dev]"` ; `pytest -v`
- `ia theme load` ; `ia expand <node> [--auto-depth N]` ; `ia review list|approve|reject|merge`
- `ia chokepoints` ; `ia export`
- `uvicorn industry_analysis.dashboard.app:app --port 8300`

## Key paths
- QuantAgent CLI: `../QuantAgent/dist/cli.js` ; agents in `.quantagent/agents/`
- Spec: `docs/superpowers/specs/2026-05-30-supply-chain-mining-design.md`
