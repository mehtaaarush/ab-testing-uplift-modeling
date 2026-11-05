"""Download, validate and tidy the Hillstrom e-mail experiment."""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import config

# SHA-256 of the original 2008 file, so a changed or truncated download is caught.
EXPECTED_SHA256 = "0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece"

COLUMNS = [
    "recency", "history_segment", "history", "mens", "womens", "zip_code",
    "newbie", "channel", "segment", "visit", "conversion", "spend",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(path: Path = config.DATA_FILE, timeout: int = 120) -> Path:
    resp = requests.get(config.DATA_URL, timeout=timeout)
    resp.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    digest = sha256(path)
    if digest != EXPECTED_SHA256:
        raise ValueError(f"Unexpected checksum for {path.name}: {digest}")
    return path


def load(path: Path = config.DATA_FILE) -> pd.DataFrame:
    """One row per customer with the arm as a short key (control / mens / womens)."""
    if not path.exists():
        download(path)
    raw = pd.read_csv(path)
    return tidy(raw)


def tidy(raw: pd.DataFrame) -> pd.DataFrame:
    missing = set(COLUMNS) - set(raw.columns)
    if missing:
        raise ValueError(f"Missing columns: {sorted(missing)}")
    df = raw[COLUMNS].copy()
    df["arm"] = df.pop("segment").map(config.ARMS)
    if df["arm"].isna().any():
        raise ValueError("Unknown experiment arm labels")
    for col in ["mens", "womens", "newbie", "visit", "conversion"]:
        df[col] = df[col].astype(int)
    df["spend"] = df["spend"].astype(float)
    df["history"] = df["history"].astype(float)
    # The history segment labels carry an ordering prefix ("1) $0 - $100"); keep the label text.
    df["history_segment"] = (
        df["history_segment"].str.replace(r"^\d\)\s*", "", regex=True).str.replace(" - ", "–").str.replace(" +", "+")
    )
    df["zip_code"] = df["zip_code"].replace({"Surburban": "Suburban"})  # typo in the source file
    df["purchase_mix"] = np.select(
        [(df["mens"] == 1) & (df["womens"] == 1), df["mens"] == 1, df["womens"] == 1],
        ["Both", "Men's only", "Women's only"],
        default="Neither",
    )
    df["tenure"] = np.where(df["newbie"] == 1, "New customer", "Returning customer")
    df["recency_band"] = pd.cut(df["recency"], [0, 3, 6, 9, 12], labels=["1–3 months", "4–6 months", "7–9 months", "10–12 months"]).astype(str)
    validate(df)
    return df


def validate(df: pd.DataFrame) -> None:
    """Sanity rules every analysis relies on."""
    assert df["arm"].isin(config.ARMS.values()).all()
    assert df[["visit", "conversion"]].isin([0, 1]).all().all()
    assert (df["spend"] >= 0).all()
    assert (df.loc[df["conversion"] == 0, "spend"] == 0).all(), "spend without a conversion"
    assert (df.loc[df["conversion"] == 1, "visit"] == 1).all(), "conversion without a visit"
    assert df["recency"].between(1, 12).all()
