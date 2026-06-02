#!/usr/bin/env python3
"""
Build monthly Sierra Nevada snow-vs-rain (precipitation-phase) profiles from CMIP6.

Scene 1 ("the cause") shows *why* the snowpack shrinks: as the cold season warms
past the rain/snow threshold (~1 degC near-surface air temp), a growing share of
winter precipitation falls as rain instead of snow. The single cleanest variable
for that story is the SNOWFALL FRACTION:

    snow_fraction = prsn / pr        (snow's share of total precipitation)

so a falling snow fraction across historical -> SSP2-4.5 -> SSP5-8.5 is the
"more rain, less snow" message directly, no temperature inference required.

This mirrors make_sierra_snowmelt_profiles.py exactly (same Sierra box,
cosine-latitude weighting, store-selection helpers, scenarios, windows, and the
2 GFDL models GFDL-CM4 + GFDL-ESM4) so Scene 1 shares an ensemble with Scenes
3/6. It just pulls two atmosphere variables instead of one:

    prsn (Snowfall Flux, Amon)  and  pr (Precipitation, Amon)   [kg m-2 s-1]

and converts both fluxes to mm/day (x 86400).

Outputs (in data/):
  - sierra_snowfall_model_level.csv : per (model, scenario, month) precip + snowfall
  - sierra_snowfall_profiles.csv    : ensemble monthly climatology per scenario,
                                      with precip/snow/rain (mm/day) + snow_fraction
  - sierra_snowfall_seasons.csv     : precip-WEIGHTED cold-season (Nov-Mar) and
                                      spring (Mar-Apr) snow fraction + deltas vs hist

NOTE: storage.googleapis.com is blocked in some sandboxes (HTTP 403). Run this in
your own environment where anonymous GCS access works, then commit the small CSVs.
The front end reads sierra_snowfall_profiles.csv (+ sierra_snowfall_seasons.csv).

Caveat to surface downstream: this is an area mean over a Sierra box that includes
low, warm elevations (the eastern Central Valley), so the absolute snow fraction
mixes the snowy high country with the rainy valley floor. The *decline* in snow
fraction is robust; the absolute level is a regional mean, not the snow zone alone.
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

SNOW_VAR = "prsn"            # Snowfall Flux [kg m-2 s-1]
PRECIP_VAR = "pr"           # Precipitation [kg m-2 s-1]
TABLE_ID = "Amon"           # Monthly atmosphere
SCENARIOS = ["historical", "ssp245", "ssp585"]

# Match Scene 3's snowmelt run: GFDL-CM4 + GFDL-ESM4 only, so the phase signal
# and the melt signal share an ensemble. To broaden later, add models here and
# raise MAX_MODELS_PER_SCENARIO.
ALLOWED_MODELS = ["GFDL-CM4", "GFDL-ESM4"]
MAX_MODELS_PER_SCENARIO = 2
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

SECONDS_PER_DAY = 86400                   # kg m-2 s-1 -> mm/day

OUTPUT_DIR = Path("data")
SUMMARY_CSV = OUTPUT_DIR / "sierra_snowfall_profiles.csv"
MODEL_LEVEL_CSV = OUTPUT_DIR / "sierra_snowfall_model_level.csv"
SEASONS_CSV = OUTPUT_DIR / "sierra_snowfall_seasons.csv"

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


def subset_sierra(ds: xr.Dataset, variable_id: str) -> xr.DataArray:
    if variable_id not in ds:
        raise KeyError(f"Variable {variable_id!r} not found in dataset.")

    lat_name, lon_name = _lat_lon_names(ds)
    lon = ds[lon_name]
    lon_low, lon_high = _lon_bounds(lon)

    return ds[variable_id].sel(
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


def monthly_array_mm_day(monthly: xr.DataArray) -> np.ndarray:
    """12-element monthly climatology in mm/day, ordered Jan..Dec."""
    flux = np.array(
        [float(monthly.sel(month=m).values) for m in range(1, 13)],
        dtype=float,
    )
    return flux * SECONDS_PER_DAY


# --------------------------------------------------------------------------
# Per-variable / per-scenario loading
# --------------------------------------------------------------------------
def load_variable_cycle(
    catalog: pd.DataFrame,
    scenario: str,
    variable_id: str,
    source_id: str,
    start: str,
    end: str,
) -> np.ndarray:
    """Monthly climatology (mm/day, Jan..Dec) for one model+variable+scenario."""
    mask = (
        (catalog["variable_id"] == variable_id)
        & (catalog["table_id"] == TABLE_ID)
        & (catalog["experiment_id"] == scenario)
        & (catalog["source_id"] == source_id)
    )
    group = catalog.loc[mask]
    if group.empty:
        raise RuntimeError(
            f"No store for {variable_id}/{TABLE_ID}/{scenario}/{source_id}."
        )
    store_row = choose_one_store(group)
    zstore = store_row["zstore"]
    grid_label = store_row["grid_label"]

    print(f"    {variable_id}: {source_id} (grid={grid_label})")
    ds = xr.open_zarr(zstore, consolidated=True, storage_options={"token": "anon"})
    region = subset_sierra(ds, variable_id)
    ts = regional_mean_ts(region)
    monthly = monthly_climatology(ts, start, end)
    cycle = monthly_array_mm_day(monthly)
    if hasattr(ds, "close"):
        ds.close()
    return cycle


def load_scenario_profile(
    catalog: pd.DataFrame,
    gcs: gcsfs.GCSFileSystem,
    scenario: str,
) -> tuple[pd.DataFrame, list[str], list[str]]:
    # Models that have BOTH prsn and pr for this scenario, restricted to allowed.
    def models_for(variable_id: str) -> set[str]:
        m = (
            (catalog["variable_id"] == variable_id)
            & (catalog["table_id"] == TABLE_ID)
            & (catalog["experiment_id"] == scenario)
        )
        return set(catalog.loc[m, "source_id"].unique())

    both = models_for(SNOW_VAR) & models_for(PRECIP_VAR)
    candidate_ids = order_source_ids([s for s in both])
    if not candidate_ids:
        raise RuntimeError(
            f"No allowed model has both {SNOW_VAR} and {PRECIP_VAR} for "
            f"scenario {scenario!r}. Allowed={ALLOWED_MODELS}."
        )
    start, end = TIME_RANGES[scenario]

    rows: list[dict] = []
    used_models: list[str] = []
    failures: list[str] = []

    for source_id in candidate_ids:
        if len(used_models) >= MAX_MODELS_PER_SCENARIO:
            break
        try:
            print(f"  Opening {source_id} ({scenario})")
            snow = load_variable_cycle(
                catalog, scenario, SNOW_VAR, source_id, start, end
            )
            precip = load_variable_cycle(
                catalog, scenario, PRECIP_VAR, source_id, start, end
            )
            for month in range(1, 13):
                rows.append(
                    {
                        "source_id": source_id,
                        "scenario": scenario,
                        "month": month,
                        "precip_mm_day": float(precip[month - 1]),
                        "snowfall_mm_day": float(snow[month - 1]),
                    }
                )
            used_models.append(source_id)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{source_id}: {type(exc).__name__}: {exc}")

    if not rows:
        raise RuntimeError(
            f"All model loads failed for scenario {scenario!r}. See log above."
        )
    return pd.DataFrame(rows), used_models, failures


# --------------------------------------------------------------------------
# Aggregation: monthly climatology + snow fraction + seasonal summaries
# --------------------------------------------------------------------------
def summarize_scenario(model_df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    subset = model_df.loc[model_df["scenario"] == scenario]
    summary = (
        subset.groupby("month")
        .agg(
            precip_mm_day=("precip_mm_day", "mean"),
            snowfall_mm_day=("snowfall_mm_day", "mean"),
            model_count=("precip_mm_day", "count"),
        )
        .reset_index()
    )
    # snowfall can't exceed precip; clip tiny numerical overshoot before dividing.
    snow = np.clip(summary["snowfall_mm_day"], 0.0, summary["precip_mm_day"])
    summary["snowfall_mm_day"] = snow
    summary["rain_mm_day"] = (summary["precip_mm_day"] - snow).clip(lower=0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        frac = np.where(summary["precip_mm_day"] > 0,
                        snow / summary["precip_mm_day"], 0.0)
    summary["snow_fraction"] = frac
    summary.insert(0, "scenario", scenario)
    return summary[
        ["scenario", "month", "precip_mm_day", "snowfall_mm_day",
         "rain_mm_day", "snow_fraction", "model_count"]
    ]


def _weighted_fraction(summary: pd.DataFrame, months: list[int]) -> tuple[float, float, float]:
    """Precip-weighted snow fraction over given months: (snow, precip, fraction)."""
    sub = summary.loc[summary["month"].isin(months)]
    snow = float(sub["snowfall_mm_day"].sum())
    precip = float(sub["precip_mm_day"].sum())
    frac = snow / precip if precip > 0 else float("nan")
    return snow, precip, frac


def seasonal_summary(summary: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for scenario in SCENARIOS:
        sub = summary.loc[summary["scenario"] == scenario]
        if sub.empty:
            continue
        c_snow, c_precip, c_frac = _weighted_fraction(sub, COLD_SEASON_MONTHS)
        s_snow, s_precip, s_frac = _weighted_fraction(sub, SPRING_MONTHS)
        rows.append(
            {
                "scenario": scenario,
                "cold_precip_mm_day": c_precip,
                "cold_snow_mm_day": c_snow,
                "cold_snow_fraction": c_frac,
                "spring_precip_mm_day": s_precip,
                "spring_snow_mm_day": s_snow,
                "spring_snow_fraction": s_frac,
                "model_count": int(sub["model_count"].max()),
            }
        )
    out = pd.DataFrame(rows)

    hist = out.loc[out["scenario"] == "historical"]
    if hist.empty:
        raise RuntimeError("Historical scenario missing; cannot compute deltas.")
    cold0 = float(hist["cold_snow_fraction"].iloc[0])
    spring0 = float(hist["spring_snow_fraction"].iloc[0])
    out["delta_cold_fraction_vs_hist"] = out["cold_snow_fraction"] - cold0
    out["delta_spring_fraction_vs_hist"] = out["spring_snow_fraction"] - spring0
    return out


def print_phase_report(seasons: pd.DataFrame) -> None:
    print("\nCold-season (Nov-Mar) snow fraction by scenario:")
    for _, r in seasons.iterrows():
        print(
            f"  {r['scenario']:11s}: snow={r['cold_snow_fraction'] * 100:5.1f}% "
            f"of precip  (d{r['delta_cold_fraction_vs_hist'] * 100:+.1f} pts)  "
            f"precip={r['cold_precip_mm_day']:.2f} mm/day"
        )


def print_variable_table_ids(catalog: pd.DataFrame) -> None:
    for variable_id in (SNOW_VAR, PRECIP_VAR):
        var_rows = catalog.loc[catalog["variable_id"] == variable_id]
        n = int((var_rows["table_id"] == TABLE_ID).sum())
        print(f"  {variable_id}/{TABLE_ID}: {n} catalog rows")


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
        model_df, used, failures = load_scenario_profile(catalog, gcs, scenario)
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
    summary.to_csv(SUMMARY_CSV, index=False)
    print(f"Saved scenario monthly summary CSV:\n  {SUMMARY_CSV.resolve()}")

    seasons = seasonal_summary(summary)
    seasons.to_csv(SEASONS_CSV, index=False)
    print(f"Saved seasonal summary CSV:\n  {SEASONS_CSV.resolve()}")

    # Sanity: snow fraction must sit in [0, 1].
    bad = summary.loc[(summary["snow_fraction"] < 0) | (summary["snow_fraction"] > 1)]
    if not bad.empty:
        print(f"\nWARNING: {len(bad)} month(s) with snow_fraction outside [0,1].")
    else:
        print("\nSanity check: all snow_fraction values in [0, 1].")

    print_phase_report(seasons)

    print("\nDone.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None
