"""Collaborative multi-source data plane.

CDC SODA remains the core surveillance store. Adapters here fetch open,
citable supplements (national burden, peer-country context) into DuckDB
with explicit provenance. Fail soft — never invent numbers.
"""

from backend.sources.registry import (
    SOURCE_REGISTRY,
    list_sources,
    refresh_all_supplements,
    refresh_source,
)

__all__ = [
    "SOURCE_REGISTRY",
    "list_sources",
    "refresh_all_supplements",
    "refresh_source",
]
