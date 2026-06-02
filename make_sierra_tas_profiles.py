#!/usr/bin/env python3
"""
Build monthly Sierra Nevada near-surface air-temperature profiles from CMIP6.

Scene 1 ("the cause") asks *which* temperatures matter. There isn't one
"warming" number — there are two signals, and they map onto the next two
scenes:

  - Cold-season temperature (Nov-Mar), near the freezing line, controls
    whether winter precipitation falls as rain or snow. This drives the
    snowpack DECLINE in Scene 2.
  - Spring temperature (Mar-Apr) controls when and how fast the snow melts.
    This drives the EARLIER melt shift in Scene 3. (The attribution
    literature ties earlier peak melt to warm March-April temperatures.)

So the honest framing is not "it's getting hot" but: the Sierra sits close to
0 degC in the cold season, so a few degrees of warming flips a large share of
the range from snow-accumulating to rain-and-melt, and warming bites hardest
at the lower elevations near the snow line.

This script mirrors make_sierra_snowmelt_profiles.py exactly (same Sierra box,
cosine-latitude weighting, store-selection helpers, scenarios and windows) so
Scene 1's temperature and Scene 3's snowmelt come from the SAME 2 GFDL models.
It just swaps the variable:

  snm / LImon  ->  tas / Amon      and converts Kelvin -> degC.

Outputs (in data/):
  - sierra_tas_model_level.csv : one row per (model, scenario, month), degC
  - sierra_tas_profiles.csv    : ensemble monthly climatology per scenario, degC
  - sierra_tas_seasons.csv     : per-scenario cold-season (Nov-Mar) and spring
                                 (Mar-Apr) means, plus deltas vs historical

NOTE: storage.googleapis.com is blocked in some sandboxes (HTTP 403). Run this
in your own environment where anonymous GCS access works, then commit the small
CSVs. The front end reads sierra_tas_profiles.csv (+ sierra_tas_seasons.csv).
"""

from __future__ import annotations

import sys
from pathlib import Path

import gcsfs
import numpy as np
import pandas as pd
import xarray as xr

CATALOG_URL = (
    "https://storage.googleapis.com/cmip6/"
    "cmip6-zarr-consolidated-stores.csv"
)

VARIABLE_ID = "tas"          # Near-Surface Air Temperature [K]
TABLE_ID = "Amon"            # Monthly atmosphere
SCENARIOS = ["historical", "ssp245", "ssp585"]

# Match Scene 3's snowmelt run: GFDL-CM4 + GFDL-ESM4 only, so the temperature
# signal and the melt signal share an ensemble. To broaden later (the handoff
# suggests CESM2 / UKESM1-0-LL / MPI-ESM1-2-HR), add them to ALLOWED_MODELS and
# raise MAX_MODELS_PER_SCENARIO.
ALLOWED_MODELS = ["GFDL-CM4", "GFDL-ESM4"]
MAX_MODELS_PER_SCENARIO = 2

# Preference order within the allowed set (kept for parity with the snm script).
PREFERRED_MODELS = ["GFDL-CM4", "GFDL-ESM4"]

LAT_MIN, LAT_MAX = 36.0, 40.0
LON_MIN, LON_MAX = -121.5, -118.5
LON_MIN_360, LON_MAX_360 = 238.5, 241.5

# Future window pushed to end-of-century to match the snowmelt puller / Scene 3.
TIME_RANGES = {
    "historical": ("1970-01-01", "2000-12-31"),
    "ssp245": ("2070-01-01", "2100-12-31"),
    "ssp585": ("2070-01-01", "2100-12-31"),
}

# Seasonal windows (calendar month numbers).
COLD_SEASON_MONTHS = [11, 12, 1, 2, 3]   # Nov-Mar : rain-vs-snow (-> Scene 2)
SPRING_MONTHS = [3, 4]                    # Mar-Apr : melt timing  (-> Scene 3)

KELVIN_TO_C = 273.15

OUTPUT_DIR = Path("data")
SUMMARY_CSV = OUTPUT_DIR / "sierra_tas_profiles.csv"
MODEL_LEVEL_CSV = OUTPUT_DIR / "sierra_tas_model_level.csv"
SEASONS_CSV = OUTPUT_DIR / "sierra_tas_seasons.csv"

MONTH_NAMES = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


# --------------------------------------------------------------------------
# Spatial / temporal helpers (unchanged from the snm pipeline)
# --------------------------------------------------------------------------
def coord_slice(coord: xr.DataArray, low: float, high: float) -> slice:
    values = np.asarray(coord.values, dtype=float)
    if values.size == 0:
        return slice(low, high)
    if values[0] > values[-1]:
        return slice(high, low)
    return slice(low, high)


def order_source_ids(source_ids: list[str]) -> list[str]:
    """Keep only the allowed models, preferred ones first."""
    allowed = [m for m in source_ids if m in ALLOWED_MODELS]
    preferred = [m for m in PREFERRED_MODELS if m in allowed]
    remainder = [m for m in allowed if m not in PREFERRED_MODELS]
    return preferred + remainder


def choose_one_store(group: pd.DataFrame) -> pd.Series:
    gr = group.loc[group["grid_label"] == "gr"]
    if not gr.empty:
        return gr.iloc[0]
    return group.iloc[0]


def _lat_lon_names(ds: xr.Dataset | xr.DataArray) -> tuple[str, str]:
    for lat_name in ("lat", "latitude"):
        if lat_name in ds.coords or lat_name in ds.dims:
            break
    else:
        raise KeyError("Could not find a latitude coordinate in dataset.")

    for lon_name in ("lon", "longitude"):
        if lon_name in ds.coords or lon_name in ds.dims:
            break
    else:
        raise KeyError("Could not find a longitude coordinate in dataset.")

    return lat_name, lon_name


def _lon_bounds(lon: xr.DataArray) -> tuple[float, float]:
    lon_max = float(lon.max())
    if lon_max > 180.0:
        return LON_MIN_360, LON_MAX_360
    return LON_MIN, LON_MAX


def subset_sierra(ds: xr.Dataset) -> xr.DataArray:
    if VARIABLE_ID not in ds:
        raise KeyError(f"Variable {VARIABLE_ID!r} not found in dataset.")

    lat_name, lon_name = _lat_lon_names(ds)
    lon = ds[lon_name]
    lon_low, lon_high = _lon_bounds(lon)

    return ds[VARIABLE_ID].sel(
        {
            lat_name: coord_slice(ds[lat_name], LAT_MIN, LAT_MAX),
            lon_name: coord_slice(lon, lon_low, lon_high),
        }
    )


def regional_mean_ts(field: xr.DataArray) -> xr.DataArray:
    lat_name, lon_name = _lat_lon_names(field)
    weights = np.cos(np.deg2rad(field[lat_name]))
    return field.weighted(weights).mean(dim=(lat_name, lon_name))


def select_time_period(ts: xr.DataArray, start: str, end: str) -> xr.DataArray:
    start_pd = pd.Timestamp(start)
    end_pd = pd.Timestamp(end)

    year = ts.time.dt.year
    month = ts.time.dt.month

    after_start = (year > start_pd.year) | (
        (year == start_pd.year) & (month >= start_pd.month)
    )
    before_end = (year < end_pd.year) | (
        (year == end_pd.year) & (month <= end_pd.month)
    )
    subset = ts.isel(time=after_start & before_end)
    if subset.sizes.get("time", 0) == 0:
        raise ValueError(f"No timesteps found between {start} and {end}.")
    return subset


def monthly_climatology(ts: xr.DataArray, start: str, end: str) -> xr.DataArray:
    subset = select_time_period(ts, start, end)
    return subset.groupby("time.month").mean("time")


def monthly_array(monthly: xr.DataArray) -> np.ndarray:
    """12-element array of the monthly climatology in degC, ordered Jan..Dec."""
    kelvin = np.array(
        [float(monthly.sel(month=m).values) for m in range(1, 13)],
        dtype=float,
    )
    return kelvin - KELVIN_TO_C


# --------------------------------------------------------------------------
# Per-scenario loading
# --------------------------------------------------------------------------
def load_scenario_monthly_profile(
    catalog: pd.DataFrame,
    gcs: gcsfs.GCSFileSystem,
    scenario: str,
) -> tuple[pd.DataFrame, list[str], list[str]]:
    mask = (
        (catalog["variable_id"] == VARIABLE_ID)
        & (catalog["table_id"] == TABLE_ID)
        & (catalog["experiment_id"] == scenario)
    )
    hits = catalog.loc[mask]
    if hits.empty:
        raise RuntimeError(
            f"No catalog rows for variable={VARIABLE_ID!r}, "
            f"table={TABLE_ID!r}, experiment_id={scenario!r}."
        )

    candidate_ids = order_source_ids(hits["source_id"].drop_duplicates().tolist())
    if not candidate_ids:
        raise RuntimeError(
            f"None of ALLOWED_MODELS={ALLOWED_MODELS} available for "
            f"scenario {scenario!r}."
        )
    start, end = TIME_RANGES[scenario]

    rows: list[dict] = []
    used_models: list[str] = []
    failures: list[str] = []

    for source_id in candidate_ids:
        if len(used_models) >= MAX_MODELS_PER_SCENARIO:
            break

        group = hits.loc[hits["source_id"] == source_id]
        store_row = choose_one_store(group)
        zstore = store_row["zstore"]
        grid_label = store_row["grid_label"]

        try:
            print(
                f"  Opening {source_id} ({scenario}, grid={grid_label}): {zstore}"
            )
            ds = xr.open_zarr(
                zstore,
                consolidated=True,
                storage_options={"token": "anon"},
            )
            region = subset_sierra(ds)
            ts = regional_mean_ts(region)
            monthly = monthly_climatology(ts, start, end)
            tas_cycle = monthly_array(monthly)  # degC

            for month in range(1, 13):
                rows.append(
                    {
                        "source_id": source_id,
                        "scenario": scenario,
                        "month": month,
                        "tas_c": float(tas_cycle[month - 1]),
                    }
                )
            used_models.append(source_id)
            if hasattr(ds, "close"):
                ds.close()
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{source_id}: {type(exc).__name__}: {exc}")

    if not rows:
        raise RuntimeError(
            f"All model loads failed for scenario {scenario!r}. "
            f"See failure log above."
        )

    return pd.DataFrame(rows), used_models, failures


# --------------------------------------------------------------------------
# Aggregation + seasonal summaries
# --------------------------------------------------------------------------
def summarize_scenario(model_df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    subset = model_df.loc[model_df["scenario"] == scenario]
    summary = (
        subset.groupby("month")["tas_c"]
        .agg(mean_c="mean", median_c="median", model_count="count")
        .reset_index()
    )
    summary.insert(0, "scenario", scenario)
    return summary


def _season_mean(monthly_means: pd.DataFrame, months: list[int]) -> float:
    """Simple mean of the monthly-climatology values over the given months."""
    vals = monthly_means.loc[monthly_means["month"].isin(months), "mean_c"]
    return float(vals.mean()) if not vals.empty else float("nan")


def seasonal_summary(summary: pd.DataFrame) -> pd.DataFrame:
    """Cold-season (Nov-Mar) and spring (Mar-Apr) means + deltas vs historical."""
    rows = []
    for scenario in SCENARIOS:
        sub = summary.loc[summary["scenario"] == scenario]
        if sub.empty:
            continue
        rows.append(
            {
                "scenario": scenario,
                "cold_season_mean_c": _season_mean(sub, COLD_SEASON_MONTHS),
                "spring_mean_c": _season_mean(sub, SPRING_MONTHS),
                "model_count": int(sub["model_count"].max()),
            }
        )
    out = pd.DataFrame(rows)

    hist = out.loc[out["scenario"] == "historical"]
    if hist.empty:
        raise RuntimeError("Historical scenario missing; cannot compute deltas.")
    cold0 = float(hist["cold_season_mean_c"].iloc[0])
    spring0 = float(hist["spring_mean_c"].iloc[0])
    out["delta_cold_vs_hist_c"] = out["cold_season_mean_c"] - cold0
    out["delta_spring_vs_hist_c"] = out["spring_mean_c"] - spring0
    return out


def print_seasonal_report(summary: pd.DataFrame, seasons: pd.DataFrame) -> None:
    print("\nCold-season (Nov-Mar) & spring (Mar-Apr) means by scenario:")
    for _, r in seasons.iterrows():
        print(
            f"  {r['scenario']:11s}: cold={r['cold_season_mean_c']:+.2f} degC "
            f"(d{r['delta_cold_vs_hist_c']:+.2f})  "
            f"spring={r['spring_mean_c']:+.2f} degC "
            f"(d{r['delta_spring_vs_hist_c']:+.2f})"
        )
    # How close does the AREA-MEAN sit to freezing? (It usually sits a few
    # degrees ABOVE 0 degC because the Sierra box includes low elevations; the
    # 0 degC threshold bites at snow-line elevations, not the box mean.)
    print("\nMonths with ensemble-mean tas below 0 degC (per scenario):")
    for scenario in SCENARIOS:
        sub = summary.loc[summary["scenario"] == scenario]
        if sub.empty:
            continue
        below = sub.loc[sub["mean_c"] < 0, "month"].tolist()
        labels = ", ".join(MONTH_NAMES[m] for m in below) if below else "none"
        print(f"  {scenario:11s}: {labels}")


def print_variable_table_ids(catalog: pd.DataFrame) -> None:
    var_rows = catalog.loc[catalog["variable_id"] == VARIABLE_ID]
    table_ids = sorted(var_rows["table_id"].dropna().unique().tolist())
    print(f"\nAvailable table_id values for {VARIABLE_ID!r}:")
    for table_id in table_ids:
        count = int((var_rows["table_id"] == table_id).sum())
        print(f"  - {table_id}: {count} catalog rows")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading CMIP6 Zarr catalog from:\n  {CATALOG_URL}")
    catalog = pd.read_csv(CATALOG_URL)
    print(f"Catalog rows: {len(catalog):,}")

    print_variable_table_ids(catalog)

    gcs = gcsfs.GCSFileSystem(token="anon")

    all_model_frames: list[pd.DataFrame] = []

    for scenario in SCENARIOS:
        print(f"\n=== Scenario: {scenario} ===")
        print(f"  Time range: {TIME_RANGES[scenario][0]} → {TIME_RANGES[scenario][1]}")

        model_df, used, failures = load_scenario_monthly_profile(
            catalog, gcs, scenario
        )
        all_model_frames.append(model_df)

        print(f"  Models used ({len(used)}): {', '.join(used)}")
        if failures:
            print(f"  Models failed ({len(failures)}):")
            for msg in failures:
                print(f"    - {msg}")
        else:
            print("  Models failed: none")

    model_level = pd.concat(all_model_frames, ignore_index=True)
    model_level.to_csv(MODEL_LEVEL_CSV, index=False)
    print(f"\nSaved model-level CSV:\n  {MODEL_LEVEL_CSV.resolve()}")

    summary_parts = [summarize_scenario(model_level, s) for s in SCENARIOS]
    summary = pd.concat(summary_parts, ignore_index=True)
    summary = summary[["scenario", "month", "mean_c", "median_c", "model_count"]]
    summary.to_csv(SUMMARY_CSV, index=False)
    print(f"Saved scenario monthly summary CSV:\n  {SUMMARY_CSV.resolve()}")

    seasons = seasonal_summary(summary)
    seasons.to_csv(SEASONS_CSV, index=False)
    print(f"Saved seasonal summary CSV:\n  {SEASONS_CSV.resolve()}")

    print_seasonal_report(summary, seasons)

    print("\nDone.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None
