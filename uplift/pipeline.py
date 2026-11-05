"""End-to-end run: python -m uplift.pipeline

Downloads the experiment (once), runs the A/B analysis and the uplift models, and writes
docs/data/dashboard.json, reports/*.csv and reports/figures/*.png."""
from __future__ import annotations

import argparse
import time

import pandas as pd

from . import config, data, experiment, export, figures, targeting


def power_inputs(df: pd.DataFrame) -> dict:
    control = df[df["arm"] == "control"]
    n = int(len(control))
    return {
        "n_per_arm": n,
        "alpha": config.ALPHA,
        "baseline": {m: float(control[m].mean()) for m in ["visit", "conversion"]},
        "mde": {m: experiment.mde_proportion(float(control[m].mean()), n) for m in ["visit", "conversion"]},
        "spend_sd": float(control["spend"].std()),
    }


def run(refresh: bool = False) -> dict:
    t0 = time.time()
    if refresh and config.DATA_FILE.exists():
        config.DATA_FILE.unlink()
    df = data.load()
    print(f"Loaded {len(df):,} customers")

    srm = experiment.srm_test(df)
    balance = experiment.balance_table(df)
    effects = experiment.ate_table(df)
    bootstrap = []
    for arm in config.TREATMENTS:
        low, high = experiment.bootstrap_mean_diff(df.loc[df["arm"] == arm, "spend"], df.loc[df["arm"] == "control", "spend"])
        bootstrap.append({"arm": arm, "metric": "spend", "ci_low": low, "ci_high": high})
    adjusted = pd.DataFrame([experiment.regression_adjusted_effect(df, a, m) for a in config.TREATMENTS for m in config.METRICS])
    segments = pd.concat(
        [experiment.segment_effects(df, dim, metric) for dim in export.SEGMENTS for metric in config.METRICS], ignore_index=True
    )
    print(f"A/B analysis done ({time.time() - t0:.0f}s): SRM p = {srm['p_value']:.3f}")

    train, test = targeting.split(df)
    campaigns = {arm: targeting.evaluate_campaign(train, test, arm) for arm in config.TREATMENTS}
    policies, policy_info = targeting.compare_policies(train, test)
    print(f"Uplift models done ({time.time() - t0:.0f}s): selected "
          + ", ".join(f"{arm}={res['selected']}" for arm, res in campaigns.items()))

    payload = export.dashboard_payload(df, srm, balance, effects, bootstrap, adjusted, segments, campaigns, policies,
                                       policy_info, power_inputs(df))
    out = export.write_json(payload, config.DOCS_DATA_DIR / "dashboard.json")
    print(f"Wrote {out.relative_to(config.ROOT)} ({out.stat().st_size / 1e3:.0f} KB)")

    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    effects.round(6).to_csv(config.REPORTS_DIR / "ab_test_results.csv", index=False)
    adjusted.round(6).to_csv(config.REPORTS_DIR / "regression_adjusted.csv", index=False)
    pd.DataFrame([{"campaign": arm, "selected": res["selected"] == m["key"], **m} for arm, res in campaigns.items() for m in res["models"]]
                 ).round(4).to_csv(config.REPORTS_DIR / "uplift_models.csv", index=False)
    policies.round(2).to_csv(config.REPORTS_DIR / "targeting_policies.csv", index=False)
    for path in figures.all_figures(effects, segments, campaigns):
        print(f"Wrote {path.relative_to(config.ROOT)}")
    print(f"Done in {time.time() - t0:.0f}s")
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="re-download the source data")
    run(parser.parse_args().refresh)
