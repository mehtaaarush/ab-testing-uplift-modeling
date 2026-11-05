"""Assemble the JSON the dashboard reads. Everything is computed in Python; the page only renders."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

ARM_NAMES = {"control": "No e-mail", "mens": "Men's e-mail", "womens": "Women's e-mail"}

SEGMENTS = {
    "purchase_mix": ("Past purchases", ["Men's only", "Women's only", "Both"]),
    "channel": ("Purchase channel", ["Web", "Phone", "Multichannel"]),
    "tenure": ("Customer tenure", ["New customer", "Returning customer"]),
    "zip_code": ("Area", ["Urban", "Suburban", "Rural"]),
    "recency_band": ("Months since last purchase", ["1–3 months", "4–6 months", "7–9 months", "10–12 months"]),
    "history_segment": ("Past-year spend", ["$0–$100", "$100–$200", "$200–$350", "$350–$500", "$500–$750", "$750–$1,000", "$1,000+"]),
}


def _clean(obj, digits: int = 6):
    """JSON-safe copy with floats rounded (numpy scalars and arrays included)."""
    if isinstance(obj, dict):
        return {str(k): _clean(v, digits) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v, digits) for v in obj]
    if isinstance(obj, np.ndarray):
        return [_clean(v, digits) for v in obj.tolist()]
    if isinstance(obj, pd.DataFrame):
        return [_clean(r, digits) for r in obj.to_dict(orient="records")]
    if isinstance(obj, pd.Series):
        return _clean(obj.to_numpy(), digits)
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return None if not np.isfinite(obj) else round(float(obj), digits)
    return obj


def segment_payload(segments: pd.DataFrame) -> dict:
    keep = ["dimension", "level", "share", "arm", "metric", "control", "treatment", "diff", "ci_low", "ci_high",
            "n_treatment", "n_control"]
    dims = [{"key": k, "label": label, "levels": levels} for k, (label, levels) in SEGMENTS.items()]
    return {"dimensions": dims, "rows": segments[keep]}


def campaign_payload(result: dict, value_per_visit: float) -> dict:
    sim = result["simulator"]
    return {
        "selected": result["selected"],
        "models": result["models"],
        "curve": result["curve"],
        "deciles": result["deciles"],
        "profile": result["profile"],
        "simulator": {
            "fraction": sim["fraction"], "n_t": sim["n_t"], "n_c": sim["n_c"],
            "visit_t": sim["y_t"], "visit_c": sim["y_c"],
            "spend_t": sim["spend_t"], "spend_c": sim["spend_c"],
            "conversion_t": sim["conversion_t"], "conversion_c": sim["conversion_c"],
        },
        "value_per_visit": value_per_visit,
        "n_test": result["n_test"],
    }


def dashboard_payload(df, srm, balance, effects, bootstrap, adjusted, segments, campaigns, policies, policy_info, power) -> dict:
    eff = effects.set_index(["arm", "metric"])
    value_per_visit = {arm: float(eff.loc[(arm, "spend"), "diff"] / eff.loc[(arm, "visit"), "diff"]) for arm in config.TREATMENTS}
    payload = {
        "meta": {
            "customers": len(df),
            "arms": srm["counts"],
            "arm_names": ARM_NAMES,
            "metrics": config.METRICS,
            "outcome_window_days": 14,
            "train_customers": int(round(len(df) * (1 - config.TEST_SIZE))),
            "test_customers": int(round(len(df) * config.TEST_SIZE)),
            "source": "Kevin Hillstrom, MineThatData E-Mail Analytics and Data Mining Challenge (2008)",
            "source_url": config.DATA_URL,
            "generated": date.today().isoformat(),
        },
        "srm": srm,
        "balance": [{"covariate": cov, **row} for cov, row in balance.to_dict(orient="index").items()],
        "effects": effects,
        "bootstrap": bootstrap,
        "adjusted": adjusted,
        "segments": segment_payload(segments),
        "power": power,
        "uplift": {
            "target": config.UPLIFT_TARGET,
            "campaigns": {arm: campaign_payload(campaigns[arm], value_per_visit[arm]) for arm in config.TREATMENTS},
        },
        "policies": {"baseline": "Men's e-mail to everyone", "rows": policies, **policy_info},
    }
    return _clean(payload)


def write_json(obj: dict, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return path
