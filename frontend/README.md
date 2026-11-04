# Frontend — CDC Outbreak Dashboard

React + Vite app for the surveillance overview, map, wastewater, honest last-value outlooks, and the grounded Ask agent.

## Run locally

```bash
# from repo root: start the API first (see ../README.md)
cd frontend
npm ci
npm run dev
```

Dev server: http://localhost:5173  
Set `VITE_API_URL` (defaults to `http://localhost:8000/api`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite HMR |
| `npm run build` | Production bundle → `dist/` |
| `npm run preview` | Serve `dist/` |
| `npm run lint` | ESLint |
| `npm run test:contract` | Agent contract adapter tests (tsx) |
| `npm run smoke` | Minimal smoke: contract + build artifacts |

## Typed agent surface

- `src/agent/contract.ts` — field map + `adaptAskResponse` for `POST /api/agent/ask`
- `src/api.ts` — fetch helpers; Ask uses `askAgent` only (legacy `/api/chat` is gone)
- `src/pages/AskData.tsx` — Ask UI

Pages remain JSXuntil needed; shared state abbrev/coords live in `src/lib/states.js`.

## Deploy

GitHub Pages builds this app under `/cdc-outbreak-dashboard/app/` via `.github/workflows/pages.yml` (`APP_BASE`). The static marketing/eval site is in `../site/`.
