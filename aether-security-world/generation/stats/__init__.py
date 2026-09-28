"""Token accounting and the Generation Efficiency metric (brief §19, design §11.4)."""
from __future__ import annotations

from .efficiency import GenerationStats, generation_efficiency

__all__ = ["GenerationStats", "generation_efficiency"]
