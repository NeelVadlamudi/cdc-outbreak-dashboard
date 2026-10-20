# Phase 2 findings

## Wastewater source

CDC stopped adding records to the NWSS SARS-CoV-2 metric dataset `2ew6-ywp6`
after 2025-09-07. The app now ingests `atcp-73re`, "CDC Wastewater Viral Activity
Level for SARS-CoV-2, Influenza A and RSV", which is updated weekly (latest week
2026-10-10 when checked on 2026-10-20). It reports, per site, week and pathogen,
the Wastewater Viral Activity Level (WVAL) and its category.

Both datasets are stored in `wastewater_sites`, told apart by `source_dataset`.
The current dataset has no county FIPS, 15-day percent change or percentile, so
those columns are NULL for its rows. The legacy rows are kept because they are the
only source of the 15-day percent change; `get_wastewater` returns them under
`legacy`, labelled as ending 2025-09-07.

The CDC "CDC Wastewater Data for SARS-CoV-2" file (`j9g8-acpt`) is also current,
but it is sample-level concentration data, not a site metric, so it was not used.

## Percentile values above 100

Not a units problem. In the legacy file, 1,009 of 98,641 snapshot rows have
`percentile = 999`, and `ptc_15d` uses `-99` and `2147483647`. These are sentinel
codes for "not computed". The previous tool averaged them in, which produced an
average percentile of 145.7 for New York. `get_wastewater` now excludes them
(`percentile BETWEEN 0 AND 100`, `ptc_15d NOT IN (-99, 2147483647)`).

## Forecast backtest

`evals/backtest.py` retrains each model at 12 rolling origins (weeks ending
2026-06-27 to 2026-09-12 for each series) on weeks up to the origin only, using the
app's own features, training loop, inference and band, and scores weeks 1-4 ahead.
A last-value forecast is scored on the same origins. Full output, including band
coverage, is in `evals/results/backtest.json`.

Both models are worse than the last-value forecast for every virus and horizon.

Why the flu LSTM and XGBoost forecasts disagree:

- The LSTM is trained on z-scored values using the mean of the whole series
  (2.2 per 100,000 for FluSurv-NET, peak 13.5). In the off season the series sits
  at 0.1-0.9, and the LSTM's forecasts stay near 2, close to the long-run mean.
  Its 1-week MAE over the backtest is 2.29 against 0.16 for XGBoost and 0.03 for
  last value.
- At inference `generate_forecast` encodes the seasonal feature as
  `sin(2*pi*j/52)` for the 12 window positions, while training used the position
  in the whole series. The model therefore sees a different season signal at
  forecast time than in training.
- FluSurv-NET has a 5-month gap (2025-05-03 to 2025-10-04) that both models treat
  as consecutive weeks, which also misaligns the index-based season features.
- XGBoost forecasts one week at a time from lag features, so it stays close to the
  recent level and drifts away from it as its own predictions feed back.

The uncertainty band is the validation MAE times a growth factor, not a fitted
interval; its coverage ranges from 0% to 100% across viruses and horizons.

These forecasting issues are documented here and not yet fixed.

## Forecast fixes (model version 2)

Changes to the LSTM, all shared by the app and `evals/backtest.py` through `fit_lstm` and `predict_lstm`:

- Each 12-week window is scaled by its own mean. The model no longer uses whole-history z-scores.
- The season feature is the ISO calendar week of each point, used in both training and forecasting. Before, forecasting used the window position.
- The series is split wherever consecutive weeks are not 7 days apart, so no sample spans the FluSurv-NET gap (2025-05-03 to 2025-10-04).

Backtest h1 MAE before and after, in rate per 100,000 (12 origins):

| Series | LSTM v1 | LSTM v2 | Last value |
|---|---|---|---|
| FluSurv-NET | 2.287 | 0.164 | 0.033 |

The full table is in `evals/results/backtest.json`. In both versions the LSTM still loses to last week's value at every horizon on every series. The output of `get_forecast` and the site's notes now say so.
