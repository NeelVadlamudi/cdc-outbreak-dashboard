"""Mirage audit agent: explains club shelf gaps from floor, backroom and system counts.

Reads a read-only DuckDB copy of the Mirage tables (mirage/vendor) and writes only to its own
proposals and audit-log tables (mirage/state.py). It never changes a Mirage record.
"""
