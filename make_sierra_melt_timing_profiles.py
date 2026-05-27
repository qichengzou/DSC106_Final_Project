#!/usr/bin/env python3
"""
Build monthly Sierra Nevada snow profiles from CMIP6 Zarr stores.

Note: CMIP6 variable `snw` (table LImon) is monthly surface snow amount in the
land model, not a direct observational April 1 snow-water-equivalent (SWE) product.
We use it here as a proxy for the seasonal snowpack / melt-timing curve shown in
the scrollytelling visualization.
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

VARIABLE_ID = "snw"
TABLE_ID = "LImon"
SCENARIOS = ["historical", "ssp245", "ssp585"]
MAX_MODELS_PER_SCENARIO = 5

# Approximate Sierra Nevada bounding box
LAT_MIN, LAT_MAX = 36.0, 40.0
LON_MIN, LON_MAX = -121.5, -118.5
LON_MIN_360, LON_MAX_360 = 238.5, 241.5

TIME_RANGES = {
    "historical": ("1970-01-01", "2000-12-31"),
    "ssp245": ("2050-01-01", "2075-12-31"),
    "ssp585": ("2050-01-01", "2075-12-31"),
}

OUTPUT_DIR = Path("data")
SUMMARY_CSV = OUTPUT_DIR / "sierra_melt_timing_profiles.csv"
MODEL_LEVEL_CSV = OUTPUT_DIR / "sierra_melt_timing_model_level.csv"


def coord_slice(coord: xr.DataArray, low: float, high: float) -> slice:
    """Return a slice that works whether the coordinate is ascending or descending."""
    values = np.asarray(coord.values, dtype=float)
    if values.size == 0:
        return slice(low, high)
    if values[0] > values[-1]:
        return slice(high, low)
    return slice(low, high)


def choose_one_store(group: pd.DataFrame) -> pd.Series:
    """
    Pick one Zarr store row for a model (source_id).
    Prefer grid_label == 'gr'; otherwise use the first available row.
    """
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
    """Return (low, high) longitude bounds for the Sierra subset."""
    lon_max = float(lon.max())
    if lon_max > 180.0:
        return LON_MIN_360, LON_MAX_360
    return LON_MIN, LON_MAX


def subset_sierra(ds: xr.Dataset) -> xr.DataArray:
    """Subset `snw` to the Sierra Nevada bounding box."""
    if VARIABLE_ID not in ds:
        raise KeyError(f"Variable {VARIABLE_ID!r} not found in dataset.")

    lat_name, lon_name = _lat_lon_names(ds)
    lon = ds[lon_name]
    lon_low, lon_high = _lon_bounds(lon)

    snw = ds[VARIABLE_ID].sel(
        {
            lat_name: coord_slice(ds[lat_name], LAT_MIN, LAT_MAX),
            lon_name: coord_slice(lon, lon_low, lon_high),
        }
    )
    return snw


def regional_mean_ts(snw: xr.DataArray) -> xr.DataArray:
    """Area-weighted regional mean using cos(latitude) weights."""
    lat_name, lon_name = _lat_lon_names(snw)
    weights = np.cos(np.deg2rad(snw[lat_name]))
    weighted = snw.weighted(weights)
    return weighted.mean(dim=(lat_name, lon_name))


def monthly_climatology(ts: xr.DataArray, start: str, end: str) -> xr.DataArray:
    """Mean seasonal cycle (months 1–12) over the selected period."""
    subset = ts.sel(time=slice(np.datetime64(start), np.datetime64(end)))
    if subset.sizes.get("time", 0) == 0:
        raise ValueError(f"No timesteps found between {start} and {end}.")
    return subset.groupby("time.month").mean("time")


def load_scenario_monthly_profile(
    catalog: pd.DataFrame,
    gcs: gcsfs.GCSFileSystem,
    scenario: str,
) -> tuple[pd.DataFrame, list[str], list[str]]:
    """
    Load up to MAX_MODELS_PER_SCENARIO models for one scenario.

    Returns
    -------
    model_df : DataFrame with columns source_id, scenario, month, snw
    used_models : list of source_id values successfully loaded
    failures : list of human-readable failure messages
    """
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

    source_ids = hits["source_id"].drop_duplicates().tolist()[:MAX_MODELS_PER_SCENARIO]
    start, end = TIME_RANGES[scenario]

    rows: list[dict] = []
    used_models: list[str] = []
    failures: list[str] = []

    for source_id in source_ids:
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
            snw_region = subset_sierra(ds)
            ts = regional_mean_ts(snw_region)
            monthly = monthly_climatology(ts, start, end)

            for month in range(1, 13):
                rows.append(
                    {
                        "source_id": source_id,
                        "scenario": scenario,
                        "month": month,
                        "snw": float(monthly.sel(month=month).values),
                    }
                )
            used_models.append(source_id)
            if hasattr(ds, "close"):
                ds.close()
        except Exception as exc:  # noqa: BLE001 — collect and continue per model
            failures.append(f"{source_id}: {type(exc).__name__}: {exc}")

    if not rows:
        raise RuntimeError(
            f"All model loads failed for scenario {scenario!r}. "
            f"See failure log above."
        )

    return pd.DataFrame(rows), used_models, failures


def summarize_scenario(model_df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    """Aggregate model-level monthly profiles to scenario-level statistics."""
    subset = model_df.loc[model_df["scenario"] == scenario]
    summary = (
        subset.groupby("month")["snw"]
        .agg(mean="mean", median="median", model_count="count")
        .reset_index()
    )
    summary.insert(0, "scenario", scenario)
    return summary


def add_snw_index(summary: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize to historical maximum monthly mean = 100.

    snw_index = mean / historical_max_mean * 100
    """
    hist = summary.loc[summary["scenario"] == "historical"]
    if hist.empty:
        raise RuntimeError("Historical scenario missing; cannot compute snw_index.")

    historical_max_mean = float(hist["mean"].max())
    if historical_max_mean == 0:
        raise RuntimeError("Historical max mean is zero; cannot normalize snw_index.")

    out = summary.copy()
    out["snw_index"] = out["mean"] / historical_max_mean * 100.0
    return out


def print_snw_table_ids(catalog: pd.DataFrame) -> None:
    """Print available table_id values for variable snw."""
    snw_rows = catalog.loc[catalog["variable_id"] == VARIABLE_ID]
    table_ids = sorted(snw_rows["table_id"].dropna().unique().tolist())
    print(f"\nAvailable table_id values for {VARIABLE_ID!r}:")
    for table_id in table_ids:
        count = int((snw_rows["table_id"] == table_id).sum())
        print(f"  - {table_id}: {count} catalog rows")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading CMIP6 Zarr catalog from:\n  {CATALOG_URL}")
    catalog = pd.read_csv(CATALOG_URL)
    print(f"Catalog rows: {len(catalog):,}")

    print_snw_table_ids(catalog)

    gcs = gcsfs.GCSFileSystem(token="anon")

    all_model_frames: list[pd.DataFrame] = []
    all_failures: dict[str, list[str]] = {}
    models_used: dict[str, list[str]] = {}

    for scenario in SCENARIOS:
        print(f"\n=== Scenario: {scenario} ===")
        print(f"  Time range: {TIME_RANGES[scenario][0]} → {TIME_RANGES[scenario][1]}")

        model_df, used, failures = load_scenario_monthly_profile(
            catalog, gcs, scenario
        )
        all_model_frames.append(model_df)
        models_used[scenario] = used
        all_failures[scenario] = failures

        print(f"  Models used ({len(used)}): {', '.join(used)}")
        if failures:
            print(f"  Models failed ({len(failures)}):")
            for msg in failures:
                print(f"    - {msg}")
        else:
            print("  Models failed: none")

    model_level = pd.concat(all_model_frames, ignore_index=True)
    model_level = model_level[["source_id", "scenario", "month", "snw"]]
    model_level.to_csv(MODEL_LEVEL_CSV, index=False)
    print(f"\nSaved model-level debug CSV:\n  {MODEL_LEVEL_CSV.resolve()}")

    summary_parts = [summarize_scenario(model_level, s) for s in SCENARIOS]
    summary = pd.concat(summary_parts, ignore_index=True)
    summary = add_snw_index(summary)
    summary = summary[
        ["scenario", "month", "mean", "median", "model_count", "snw_index"]
    ]
    summary.to_csv(SUMMARY_CSV, index=False)

    hist_max = summary.loc[summary["scenario"] == "historical", "mean"].max()
    print(f"\nHistorical max monthly mean (normalization reference): {hist_max:.6g}")
    print(f"Saved scenario summary CSV:\n  {SUMMARY_CSV.resolve()}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None
