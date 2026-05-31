#!/usr/bin/env python3
"""
Build monthly Sierra Nevada snowmelt-timing profiles from CMIP6 Zarr stores.

Uses the directly-modeled surface snow melt flux (`snm`, LImon) — the rate at
which snowpack turns into liquid water. Unlike total runoff (`mrro`), which is
dominated by winter rain in a Sierra regional mean, `snm` isolates the snow
signal, so its seasonal pulse can shift *earlier* under warming. That earlier
shift is the "water arrives earlier" message (cf. OEHHA snowmelt-runoff
indicator).

Outputs three normalizations so the front end can tell both stories:
  - melt_index : mean / historical-peak * 100   (magnitude: "less melt")
  - self_index : mean / own-scenario-peak * 100 (timing: shape shift only)
  - cumfrac    : cumulative share of annual melt  (the OEHHA-style curve)

Plus a per-scenario center-of-timing (month by which 50% of annual melt has
passed), printed and used for chart annotation.
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

VARIABLE_ID = "snm"          # Surface Snow Melt [kg m-2 s-1]
TABLE_ID = "LImon"           # Monthly terrestrial cryosphere
SCENARIOS = ["historical", "ssp245", "ssp585"]
MAX_MODELS_PER_SCENARIO = 5

# Prefer models with strong snow representation when more than
# MAX_MODELS_PER_SCENARIO are available for a scenario.
PREFERRED_MODELS = [
    "CESM2",
    "UKESM1-0-LL",
    "MPI-ESM1-2-HR",
    "IPSL-CM6A-LR",
    "MIROC6",
    "GFDL-ESM4",
]

LAT_MIN, LAT_MAX = 36.0, 40.0
LON_MIN, LON_MAX = -121.5, -118.5
LON_MIN_360, LON_MAX_360 = 238.5, 241.5

# Future window pushed to end-of-century for a louder warming signal.
TIME_RANGES = {
    "historical": ("1970-01-01", "2000-12-31"),
    "ssp245": ("2070-01-01", "2100-12-31"),
    "ssp585": ("2070-01-01", "2100-12-31"),
}

OUTPUT_DIR = Path("data")
SUMMARY_CSV = OUTPUT_DIR / "sierra_snowmelt_profiles.csv"
MODEL_LEVEL_CSV = OUTPUT_DIR / "sierra_snowmelt_model_level.csv"

MONTH_NAMES = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


# --------------------------------------------------------------------------
# Spatial / temporal helpers (unchanged from the snw pipeline)
# --------------------------------------------------------------------------
def coord_slice(coord: xr.DataArray, low: float, high: float) -> slice:
    values = np.asarray(coord.values, dtype=float)
    if values.size == 0:
        return slice(low, high)
    if values[0] > values[-1]:
        return slice(high, low)
    return slice(low, high)


def order_source_ids(source_ids: list[str]) -> list[str]:
    """Put preferred (strong-snow) models first, keep the rest in catalog order."""
    preferred = [m for m in PREFERRED_MODELS if m in source_ids]
    remainder = [m for m in source_ids if m not in PREFERRED_MODELS]
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
    """12-element array of the monthly climatology, ordered Jan..Dec."""
    return np.array(
        [float(monthly.sel(month=m).values) for m in range(1, 13)],
        dtype=float,
    )


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
            snm_cycle = monthly_array(monthly)

            for month in range(1, 13):
                rows.append(
                    {
                        "source_id": source_id,
                        "scenario": scenario,
                        "month": month,
                        "snm": float(snm_cycle[month - 1]),
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
# Aggregation + normalizations + timing
# --------------------------------------------------------------------------
def summarize_scenario(model_df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    subset = model_df.loc[model_df["scenario"] == scenario]
    summary = (
        subset.groupby("month")["snm"]
        .agg(mean="mean", median="median", model_count="count")
        .reset_index()
    )
    summary.insert(0, "scenario", scenario)
    return summary


def add_indices(summary: pd.DataFrame) -> pd.DataFrame:
    """Add melt_index (vs historical peak), self_index (vs own peak), cumfrac."""
    hist = summary.loc[summary["scenario"] == "historical"]
    if hist.empty:
        raise RuntimeError("Historical scenario missing; cannot compute melt_index.")

    historical_max_mean = float(hist["mean"].max())
    if historical_max_mean <= 0:
        raise RuntimeError("Historical max melt is non-positive; cannot normalize.")

    out = summary.copy().sort_values(["scenario", "month"]).reset_index(drop=True)
    out["melt_index"] = out["mean"] / historical_max_mean * 100.0

    self_index = []
    cumfrac = []
    for _scenario, grp in out.groupby("scenario", sort=False):
        vals = np.clip(grp["mean"].to_numpy(dtype=float), 0.0, None)
        peak = vals.max()
        total = vals.sum()
        self_index.extend((vals / peak * 100.0) if peak > 0 else np.zeros_like(vals))
        cumfrac.extend((np.cumsum(vals) / total) if total > 0 else np.zeros_like(vals))
    out["self_index"] = self_index
    out["cumfrac"] = cumfrac
    return out


def center_timing(summary: pd.DataFrame, scenario: str) -> float:
    """Fractional month (1..12) by which 50% of annual melt has accumulated."""
    grp = summary.loc[summary["scenario"] == scenario].sort_values("month")
    vals = np.clip(grp["mean"].to_numpy(dtype=float), 0.0, None)
    total = vals.sum()
    if total <= 0:
        return float("nan")
    cum = np.cumsum(vals) / total
    idx = int(np.searchsorted(cum, 0.5))
    if idx == 0:
        return 1.0
    c0, c1 = cum[idx - 1], cum[idx]
    frac = 0.0 if c1 == c0 else (0.5 - c0) / (c1 - c0)
    return float(idx + frac)  # months are 1-based here


def print_timing_report(summary: pd.DataFrame) -> None:
    print("\nPeak melt month + center-of-timing by scenario:")
    for scenario in SCENARIOS:
        sub = summary.loc[summary["scenario"] == scenario]
        if sub.empty:
            continue
        peak_row = sub.loc[sub["mean"].idxmax()]
        peak_month = int(peak_row["month"])
        ct = center_timing(summary, scenario)
        ct_month = MONTH_NAMES[int(round(ct))] if not np.isnan(ct) else "n/a"
        print(
            f"  {scenario:11s}: peak={MONTH_NAMES[peak_month]:4s}  "
            f"center-timing={ct:.2f} (~{ct_month})"
        )


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
    summary = add_indices(summary)
    summary = summary[
        [
            "scenario", "month", "mean", "median", "model_count",
            "melt_index", "self_index", "cumfrac",
        ]
    ]
    summary.to_csv(SUMMARY_CSV, index=False)

    # Sanity: snm should be non-negative everywhere.
    n_negative = int((summary["mean"] < 0).sum())
    if n_negative:
        print(f"\nWARNING: {n_negative} negative ensemble-mean snm value(s) found.")
    else:
        print("\nSanity check: all ensemble-mean snm values are >= 0.")

    print_timing_report(summary)

    hist_max = summary.loc[summary["scenario"] == "historical", "mean"].max()
    print(f"\nHistorical max monthly melt (normalization reference): {hist_max:.6g}")
    print(f"Saved scenario summary CSV:\n  {SUMMARY_CSV.resolve()}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None
