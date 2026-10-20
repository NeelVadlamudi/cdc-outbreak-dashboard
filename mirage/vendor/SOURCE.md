# Mirage data (vendored)

These files are copied unchanged from https://github.com/NeelVadlamudi/mirage at commit `ca12b53`:

- `data/*.csv`: raw tables.
- `data/tableau/*.csv`: the extracts that `scripts/verify_*.py` check.
- `scripts/verify_kpis.py` and `scripts/verify_allocation.py`.

All figures are synthetic (see the Mirage README). The audit agent loads these files into a read-only DuckDB file (`mirage/build_db.py`). CI runs both verify scripts on this copy:

- `verify_kpis.py` must give 22.5% / 7 / 6 on the check day.
- `verify_allocation.py` must end with 98 cases: 60 allocated, 38 held, 1 transfer, 40 -> 32.
