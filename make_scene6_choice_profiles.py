#!/usr/bin/env python3
"""
Scene 6 ("Two futures, one choice") snowmelt puller — ADDS the low-emissions
path (SSP1-2.6) to the snowmelt story, WITHOUT touching any other scene.
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

# --- identical to make_sierra_snowmelt_profiles.py ---------------------------
VARIABLE_ID = "snm"          # Surface Snow Melt [kg m-2 s-1]
TABLE_ID = "LImon"           # Monthly terrestrial cryosphere

LAT_MIN, LAT_MAX = 36.0, 40.0
LON_MIN, LON_MAX = -121.5, -118.5
LON_MIN_360, LON_MAX_360 = 238.5, 241.5

# --- Scene-6 additions -------------------------------------------------------
# ssp126 (low) is appended; the three others match Scenes 3 & 5 exactly.
SCENARIOS = ["historical", "ssp245", "ssp585", "ssp126"]

# Same end-of-century window as Scenes 3 & 5 for every future path.
TIME_RANGES = {
    "historical": ("1970-01-01", "2000-12-31"),
    "ssp245": ("2070-01-01", "2100-12-31"),
    "ssp585": ("2070-01-01", "2100-12-31"),
    "ssp126": ("2070-01-01", "2100-12-31"),
}

# Models are LOCKED to the existing snm pipeline so all scenarios are comparable.
EXISTING_MODEL_LEVEL = Path("data") / "sierra_snowmelt_model_level.csv"
FALLBACK_LOCK_MODELS = ["GFDL-ESM4", "GFDL-CM4"]

OUTPUT_DIR = Path("data")
SUMMARY_CSV = OUTPUT_DIR / "sierra_snowmelt_choice_profiles.csv"
MODEL_LEVEL_CSV = OUTPUT_DIR / "sierra_snowmelt_choice_model_level.csv"
# Used only for the post-run alignment self-check (not modified):
REFERENCE_CSV = OUTPUT_DIR / "sierra_snowmelt_profiles.csv"

MONTH_NAMES = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


# --------------------------------------------------------------------------
# Spatial / temporal helpers — copied verbatim from the snm pipeline so the
# methodology is provably identical.
# --------------------------------------------------------------------------
def coord_slice(coord: xr.DataArray, low: float, high: float) -> slice:
    values = np.asarray(coord.values, dtype=float)
    if values.size == 0:
        return slice(low, high)
    if values[0] > values[-1]:
        return slice(high, low)
    return slice(low, high)


def choose_one_store(group: pd.DataFrame) -> pd.Series:
    gr = group.loc[group["grid_label"] == "gr"]
    if not gr.empty:
        return gr.iloc[0]
    return group.iloc[0]


def _lat_lon_names(ds) -> tuple[str, str]:
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
    if float(lon.max()) > 180.0:
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
    start_pd, end_pd = pd.Timestamp(start), pd.Timestamp(end)
    year, month = ts.time.dt.year, ts.time.dt.month
    after_start = (year > start_pd.year) | ((year == start_pd.year) & (month >= start_pd.month))
    before_end = (year < end_pd.year) | ((year == end_pd.year) & (month <= end_pd.month))
    subset = ts.isel(time=after_start & before_end)
    if subset.sizes.get("time", 0) == 0:
        raise ValueError(f"No timesteps found between {start} and {end}.")
    return subset


def monthly_climatology(ts: xr.DataArray, start: str, end: str) -> xr.DataArray:
    return select_time_period(ts, start, end).groupby("time.month").mean("time")


def monthly_array(monthly: xr.DataArray) -> np.ndarray:
    return np.array([float(monthly.sel(month=m).values) for m in range(1, 13)], dtype=float)


# --------------------------------------------------------------------------
# Model locking — keeps Scene 6 aligned with Scenes 3 & 5.
# --------------------------------------------------------------------------
def resolve_locked_models() -> list[str]:
    """Use exactly the models the existing snm pipeline used, for alignment."""
    if EXISTING_MODEL_LEVEL.exists():
        try:
            prev = pd.read_csv(EXISTING_MODEL_LEVEL)
            models = sorted(prev["source_id"].dropna().unique().tolist())
            if models:
                print(f"Locked to existing snm models (from {EXISTING_MODEL_LEVEL.name}): {', '.join(models)}")
                return models
        except Exception as exc:  # noqa: BLE001
            print(f"  (could not read {EXISTING_MODEL_LEVEL.name}: {exc}; using fallback)")
    print(f"Locked to fallback models: {', '.join(FALLBACK_LOCK_MODELS)}")
    return list(FALLBACK_LOCK_MODELS)


# --------------------------------------------------------------------------
# Per-scenario loading — restricted to the locked model set.
# --------------------------------------------------------------------------
def load_scenario_monthly_profile(
    catalog: pd.DataFrame, scenario: str, locked_models: list[str],
) -> tuple[pd.DataFrame, list[str], list[str]]:
    mask = (
        (catalog["variable_id"] == VARIABLE_ID)
        & (catalog["table_id"] == TABLE_ID)
        & (catalog["experiment_id"] == scenario)
        & (catalog["source_id"].isin(locked_models))   # <-- the alignment lock
    )
    hits = catalog.loc[mask]
    if hits.empty:
        # Not fatal for ssp126: just means none of the locked models ran it.
        return pd.DataFrame(), [], [f"no locked model has {VARIABLE_ID}/{TABLE_ID} for {scenario!r}"]

    start, end = TIME_RANGES[scenario]
    rows, used, failures = [], [], []

    # Preserve the locked-model order for determinism.
    for source_id in [m for m in locked_models if m in set(hits["source_id"])]:
        group = hits.loc[hits["source_id"] == source_id]
        store_row = choose_one_store(group)
        zstore, grid_label = store_row["zstore"], store_row["grid_label"]
        try:
            print(f"  Opening {source_id} ({scenario}, grid={grid_label}): {zstore}")
            ds = xr.open_zarr(zstore, consolidated=True, storage_options={"token": "anon"})
            snm_cycle = monthly_array(monthly_climatology(regional_mean_ts(subset_sierra(ds)), start, end))
            for month in range(1, 13):
                rows.append({"source_id": source_id, "scenario": scenario,
                             "month": month, "snm": float(snm_cycle[month - 1])})
            used.append(source_id)
            if hasattr(ds, "close"):
                ds.close()
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{source_id}: {type(exc).__name__}: {exc}")

    return pd.DataFrame(rows), used, failures


# --------------------------------------------------------------------------
# Aggregation + normalizations — identical to the snm pipeline.
# --------------------------------------------------------------------------
def summarize_scenario(model_df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    subset = model_df.loc[model_df["scenario"] == scenario]
    summary = (subset.groupby("month")["snm"]
               .agg(mean="mean", median="median", model_count="count").reset_index())
    summary.insert(0, "scenario", scenario)
    return summary


def add_indices(summary: pd.DataFrame) -> pd.DataFrame:
    hist = summary.loc[summary["scenario"] == "historical"]
    if hist.empty:
        raise RuntimeError("Historical scenario missing; cannot compute melt_index.")
    historical_max_mean = float(hist["mean"].max())
    if historical_max_mean <= 0:
        raise RuntimeError("Historical max melt is non-positive; cannot normalize.")

    out = summary.copy().sort_values(["scenario", "month"]).reset_index(drop=True)
    out["melt_index"] = out["mean"] / historical_max_mean * 100.0
    self_index, cumfrac = [], []
    for _scenario, grp in out.groupby("scenario", sort=False):
        vals = np.clip(grp["mean"].to_numpy(dtype=float), 0.0, None)
        peak, total = vals.max(), vals.sum()
        self_index.extend((vals / peak * 100.0) if peak > 0 else np.zeros_like(vals))
        cumfrac.extend((np.cumsum(vals) / total) if total > 0 else np.zeros_like(vals))
    out["self_index"] = self_index
    out["cumfrac"] = cumfrac
    return out


def center_timing(summary: pd.DataFrame, scenario: str) -> float:
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
    return float(idx + (0.0 if c1 == c0 else (0.5 - c0) / (c1 - c0)))


def summer_share_report(summary: pd.DataFrame) -> None:
    """Apr–Jul ('summer') volume vs the historical summer mean — the Scene-6 number."""
    def vol(scn, months):
        s = summary.loc[summary["scenario"] == scn].sort_values("month")
        v = np.clip(s["mean"].to_numpy(dtype=float), 0.0, None)
        return v[[m - 1 for m in months]].sum()
    summer = [4, 5, 6, 7]
    base = vol("historical", summer)
    print("\nSummer (Apr–Jul) snowmelt as % of the historical summer mean:")
    for scn in SCENARIOS:
        if summary.loc[summary["scenario"] == scn].empty:
            continue
        print(f"  {scn:11s}: {vol(scn, summer) / base * 100:5.1f}%")


def alignment_check(summary: pd.DataFrame) -> None:
    """Confirm historical/ssp245/ssp585 reproduce the existing Scenes 3/5 file."""
    if not REFERENCE_CSV.exists():
        print(f"\n(alignment check skipped — {REFERENCE_CSV.name} not found)")
        return
    ref = pd.read_csv(REFERENCE_CSV)
    print(f"\nAlignment check vs {REFERENCE_CSV.name} (melt_index, should match):")
    for scn in ["historical", "ssp245", "ssp585"]:
        a = summary.loc[summary["scenario"] == scn].sort_values("month")["melt_index"].to_numpy()
        b = ref.loc[ref["scenario"] == scn].sort_values("month")["melt_index"].to_numpy()
        if a.size == 12 and b.size == 12:
            max_abs = float(np.max(np.abs(a - b)))
            verdict = "OK" if max_abs < 0.5 else "DIFFERS — investigate"
            print(f"  {scn:11s}: max |Δ melt_index| = {max_abs:.3f}  [{verdict}]")
        else:
            print(f"  {scn:11s}: cannot compare (missing rows)")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading CMIP6 Zarr catalog from:\n  {CATALOG_URL}")
    catalog = pd.read_csv(CATALOG_URL)
    print(f"Catalog rows: {len(catalog):,}")

    locked_models = resolve_locked_models()
    gcs = gcsfs.GCSFileSystem(token="anon")  # noqa: F841  (xr.open_zarr uses anon token)

    all_frames, used_by_scn = [], {}
    for scenario in SCENARIOS:
        print(f"\n=== Scenario: {scenario}  ({TIME_RANGES[scenario][0]} → {TIME_RANGES[scenario][1]}) ===")
        df, used, failures = load_scenario_monthly_profile(catalog, scenario, locked_models)
        used_by_scn[scenario] = used
        if not df.empty:
            all_frames.append(df)
        print(f"  Models used ({len(used)}): {', '.join(used) if used else '(none)'}")
        for msg in failures:
            print(f"    - {msg}")

    if not all_frames or all([f.empty for f in all_frames]):
        raise RuntimeError("No data loaded for any scenario.")

    model_level = pd.concat(all_frames, ignore_index=True)
    model_level.to_csv(MODEL_LEVEL_CSV, index=False)
    print(f"\nSaved model-level CSV:\n  {MODEL_LEVEL_CSV.resolve()}")

    present = [s for s in SCENARIOS if not model_level.loc[model_level["scenario"] == s].empty]
    summary = pd.concat([summarize_scenario(model_level, s) for s in present], ignore_index=True)
    summary = add_indices(summary)
    summary = summary[["scenario", "month", "mean", "median", "model_count",
                       "melt_index", "self_index", "cumfrac"]]
    summary.to_csv(SUMMARY_CSV, index=False)

    # ---- reports & guard-rails ----
    print("\nPeak melt month + center-of-timing by scenario:")
    for scenario in present:
        sub = summary.loc[summary["scenario"] == scenario]
        peak_month = int(sub.loc[sub["mean"].idxmax()]["month"])
        ct = center_timing(summary, scenario)
        ct_month = MONTH_NAMES[int(round(ct))] if not np.isnan(ct) else "n/a"
        print(f"  {scenario:11s}: peak={MONTH_NAMES[peak_month]:4s}  center-timing={ct:.2f} (~{ct_month})  "
              f"models={int(sub['model_count'].iloc[0])}")

    # SSP1-2.6 thinness warning (the GFDL-CM4 coverage gotcha).
    counts = {s: int(summary.loc[summary["scenario"] == s, "model_count"].iloc[0]) for s in present}
    if "ssp126" not in present:
        print("\nWARNING: ssp126 produced NO data — none of the locked models published snm for SSP1-2.6.")
        print("         Scene 6 cannot show a low path until a model with ssp126 snm is added.")
    elif counts.get("ssp126", 0) < max(counts.values()):
        print(f"\nWARNING: ssp126 is built from {counts['ssp126']} model(s), vs {max(counts.values())} for the others "
              f"({', '.join(used_by_scn.get('ssp126', []))}).")
        print("         Treat the low path as indicative and disclose the model count in the scene.")

    summer_share_report(summary)
    alignment_check(summary)

    hist_max = summary.loc[summary["scenario"] == "historical", "mean"].max()
    print(f"\nHistorical max monthly melt (normalization reference): {hist_max:.6g}")
    print(f"Saved scenario summary CSV:\n  {SUMMARY_CSV.resolve()}")
    print("\nDone.  (Scenes 1–5 untouched; only the new *_choice_* CSVs were written.)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None
