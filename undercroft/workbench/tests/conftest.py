"""Pytest configuration to ensure project modules are importable."""
import sys
from pathlib import Path

# Tests run from the repository root in CI, but local executions may start
# inside the workbench package. Ensure the repository root (which contains the
# shared ``server`` package) is on ``sys.path`` so imports succeed consistently.
REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

