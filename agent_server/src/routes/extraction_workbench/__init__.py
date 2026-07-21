"""Extraction Studio workbench routes.

Package structure:
  _core.py  — full route module (original extraction_workbench.py, 6,360 lines)
  _utils.py — geometry, normalization, dataset class helpers (1,310 lines)
  
The package structure enables gradual extraction of domain modules.
Current state: _core.py is the canonical source; _utils.py contains
standalone helpers that new code can import directly.
"""

from ._core import *  # noqa: F401, F403
