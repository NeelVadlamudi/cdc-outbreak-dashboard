# v1.0 release checklist

Tag only when Phases 1–3 exit criteria are green and the tree is clean:

```bash
git status   # should be clean on main
git tag -a v1.0 -m "v1.0: grounded agent, honest last-value outlook, live DuckDB path"
git push origin v1.0
```

Do not `--force` the tag. If Path-to-Ten changes are still uncommitted, commit/merge first, then tag.
