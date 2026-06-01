import numpy as np
import pandas as pd
import xarray as xr
import gcsfs
from pathlib import Path

CATALOG_URL = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"

VARIABLE_ID = "snw"
TABLE_ID = "day"

LAT_MIN, LAT_MAX = 35.0, 41.0
LON_MIN, LON_MAX = -122.0, -118.0
LON_MIN_360, LON_MAX_360 = 238.0, 242.0

SCENARIOS = {
    "historical": ("1950-01-01", "2014-12-31"),
    "ssp245":     ("2015-01-01", "2023-12-31"),
}

MODELS = ["CESM2", "MPI-ESM1-2-HR", "UKESM1-0-LL", "IPSL-CM6A-LR", "MRI-ESM2-0"]

OUTPUT = Path("data/sierra_april1_swe.csv")


def choose_store(group: pd.DataFrame) -> pd.Series:
    gr = group.loc[group["grid_label"] == "gr"]
    return gr.iloc[0] if not gr.empty else group.iloc[0]


def lon_bounds(ds: xr.Dataset) -> tuple[float, float]:
    for name in ("lon", "longitude"):
        if name in ds.coords:
            if float(ds[name].max()) > 180:
                return LON_MIN_360, LON_MAX_360
            return LON_MIN, LON_MAX
    return LON_MIN, LON_MAX


def subset_sierra(ds: xr.Dataset) -> xr.DataArray:
    lat = next(n for n in ("lat", "latitude") if n in ds.coords)
    lon = next(n for n in ("lon", "longitude") if n in ds.coords)
    lo, hi = lon_bounds(ds)
    return ds[VARIABLE_ID].sel({
        lat: slice(LAT_MIN, LAT_MAX),
        lon: slice(lo, hi),
    })


def regional_mean(field: xr.DataArray) -> xr.DataArray:
    lat = next(n for n in ("lat", "latitude") if n in field.coords)
    lon = next(n for n in ("lon", "longitude") if n in field.coords)
    weights = np.cos(np.deg2rad(field[lat]))
    return field.weighted(weights).mean(dim=(lat, lon))


def extract_april1(ts: xr.DataArray) -> pd.Series:
    df = ts.to_series()
    mask = (df.index.month == 4) & (df.index.day == 1)
    return df[mask]


Path("data").mkdir(exist_ok=True)
catalog = pd.read_csv(CATALOG_URL)
gcs = gcsfs.GCSFileSystem(token="anon")

all_rows = []

for model in MODELS:
    yearly = {}

    for scenario, (start, end) in SCENARIOS.items():
        mask = (
            (catalog["source_id"] == model)
            & (catalog["variable_id"] == VARIABLE_ID)
            & (catalog["table_id"] == TABLE_ID)
            & (catalog["experiment_id"] == scenario)
        )
        hits = catalog.loc[mask]
        if hits.empty:
            print(f"  SKIP {model} {scenario}: not in catalog")
            continue

        store = choose_store(hits)["zstore"]
        print(f"  {model} {scenario}: {store}")

        try:
            ds = xr.open_zarr(store, consolidated=True, storage_options={"token": "anon"})
            region = subset_sierra(ds)
            ts = regional_mean(region).sel(time=slice(start, end))
            april1 = extract_april1(ts)
            for dt, val in april1.items():
                yearly[dt.year] = yearly.get(dt.year, [])
                yearly[dt.year].append(float(val))
            ds.close()
        except Exception as e:
            print(f"  FAIL {model} {scenario}: {e}")

    for year, vals in yearly.items():
        all_rows.append({"source_id": model, "year": year, "snw_kgm2": np.mean(vals)})

df = pd.DataFrame(all_rows)
ensemble = df.groupby("year")["snw_kgm2"].mean().reset_index()
ensemble["swe_mm"] = ensemble["snw_kgm2"]
ensemble["swe_in"] = ensemble["swe_mm"] / 25.4

baseline = ensemble.loc[ensemble["year"].between(1981, 2010), "swe_in"].mean()
ensemble["anomaly"] = ensemble["swe_in"] - baseline

ensemble[["year", "swe_in", "anomaly"]].to_csv(OUTPUT, index=False)
print(f"\nSaved {OUTPUT}")
print(ensemble[["year", "swe_in", "anomaly"]].to_string())
