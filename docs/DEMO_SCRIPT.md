# 60-second demo script

**Audience:** interviewer or portfolio visitor  
**Props:** [live site](https://neelvadlamudi.github.io/cdc-outbreak-dashboard/), React Ask (`/app/ask`), optional local API

## Script

1. **Pipeline line (10s)**  
   “CDC open data into DuckDB, FastAPI, a tool-calling agent, and nightly evals. Every number in an answer has to appear in a tool result.”

2. **Ask three questions (25s)**  
   - “COVID-19 test positivity this week?” → show `status`, `as_of`, tool table.  
   - “What’s Ohio’s respiratory illness activity level?” → ARI tool.  
   - “Pediatric COVID-NET rate for week ending …?” → age_group must be `Pediatrics` (not Overall).

3. **Honesty surfaces (15s)**  
   Open Forecast backtest / Outlook: last-value is primary; LSTM/XGBoost marked experimental / underperforms baseline when they lose.

4. **Measurement (10s)**  
   Eval strip + case study: grounding `14` bug caught by nightly `grounded_answers`; baseline gate in CI when a clean artifact is present.

## Do not claim

- CDC affiliation  
- That LSTM “predicts outbreaks” (on free Render, LSTM often shows `no_model`)  
- That the free Render tier is always warm (upgrade to starter for always-on)  
- “Production,” “real-time case counts,” or unverified chat ( `/api/chat` is 410 )  
- That `/api/weekly-brief` uses LSTM/XGBoost (it is rule-based DuckDB only)
