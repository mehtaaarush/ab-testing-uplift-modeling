"""Uplift-model evaluation and off-policy evaluation of targeting rules."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config


def cumulative_table(y, t, score, extra: dict | None = None, bins: int = 100) -> pd.DataFrame:
    """Customers ranked by predicted uplift (highest first), summarised at `bins` cut-offs:
    cumulative treated/control counts and outcome sums. Everything else derives from this."""
    order = np.argsort(-np.asarray(score), kind="stable")
    t = np.asarray(t)[order].astype(float)
    cols = {"y": np.asarray(y, dtype=float)[order]}
    for k, v in (extra or {}).items():
        cols[k] = np.asarray(v, dtype=float)[order]
    n = len(t)
    cut = np.unique(np.ceil(np.linspace(0, n, bins + 1)[1:]).astype(int)) - 1
    out = {"fraction": (cut + 1) / n, "n_t": np.cumsum(t)[cut], "n_c": np.cumsum(1 - t)[cut]}
    for k, v in cols.items():
        out[f"{k}_t"] = np.cumsum(v * t)[cut]
        out[f"{k}_c"] = np.cumsum(v * (1 - t))[cut]
    return pd.DataFrame(out)


def uplift_curve(table: pd.DataFrame, outcome: str = "y") -> np.ndarray:
    """Incremental outcomes per customer in the population if the top fraction were treated."""
    rate_t = table[f"{outcome}_t"] / table["n_t"].clip(lower=1)
    rate_c = table[f"{outcome}_c"] / table["n_c"].clip(lower=1)
    return ((rate_t - rate_c) * table["fraction"]).to_numpy()


def qini_curve(table: pd.DataFrame, outcome: str = "y") -> np.ndarray:
    """Radcliffe's Qini curve, per treated customer: Y_t(k) - Y_c(k) * N_t(k) / N_c(k)."""
    q = table[f"{outcome}_t"] - table[f"{outcome}_c"] * table["n_t"] / table["n_c"].clip(lower=1)
    return (q / table["n_t"].iloc[-1]).to_numpy()


def auuc_gain(table: pd.DataFrame, outcome: str = "y") -> float:
    """Average height of the uplift curve above the random-targeting diagonal, as a share of
    the total incremental outcome (0 = no better than random, higher is better)."""
    curve = uplift_curve(table, outcome)
    total = curve[-1]
    return float(np.mean(curve - total * table["fraction"].to_numpy()) / total)


def capture_share(table: pd.DataFrame, fraction: float, outcome: str = "y") -> float:
    """Share of the campaign's total incremental outcome won by treating only the top `fraction`."""
    curve = uplift_curve(table, outcome)
    k = int(np.searchsorted(table["fraction"].to_numpy(), fraction - 1e-9))
    return float(curve[k] / curve[-1])


def bootstrap_auuc(y, t, score, n_boot: int = config.N_BOOT, seed: int = config.RANDOM_STATE) -> tuple[float, float]:
    """Percentile interval for the AUUC gain, resampling hold-out customers (scores held fixed)."""
    y, t, score = np.asarray(y), np.asarray(t), np.asarray(score)
    rng = np.random.default_rng(seed)
    stats = []
    for _ in range(n_boot):
        i = rng.integers(0, len(y), len(y))
        stats.append(auuc_gain(cumulative_table(y[i], t[i], score[i])))
    return float(np.quantile(stats, 0.025)), float(np.quantile(stats, 0.975))


def uplift_by_group(y, t, score, groups: int = 10) -> pd.DataFrame:
    """Observed uplift (treated rate - control rate) per predicted-uplift decile, highest first."""
    df = pd.DataFrame({"y": np.asarray(y, dtype=float), "t": np.asarray(t), "score": np.asarray(score)})
    df["group"] = pd.qcut(df["score"].rank(method="first", ascending=False), groups, labels=False) + 1
    rows = []
    for g, sub in df.groupby("group"):
        yt, yc = sub.loc[sub["t"] == 1, "y"], sub.loc[sub["t"] == 0, "y"]
        se = np.sqrt(yt.var(ddof=1) / len(yt) + yc.var(ddof=1) / len(yc))
        rows.append({"group": int(g), "predicted": float(sub["score"].mean()), "observed": float(yt.mean() - yc.mean()),
                     "ci_low": float(yt.mean() - yc.mean() - 1.96 * se), "ci_high": float(yt.mean() - yc.mean() + 1.96 * se),
                     "n": int(len(sub))})
    return pd.DataFrame(rows)


def policy_value(arm: np.ndarray, assigned: np.ndarray, outcome: np.ndarray, propensity: dict[str, float]) -> float:
    """Inverse-propensity estimate of the mean outcome if every customer received `assigned`.
    Valid here because arms were randomised with known probabilities."""
    arm, assigned, outcome = np.asarray(arm), np.asarray(assigned), np.asarray(outcome, dtype=float)
    p = np.array([propensity[a] for a in arm])
    return float(np.mean((arm == assigned) * outcome / p))


def policy_table(test: pd.DataFrame, policies: dict[str, np.ndarray], baseline: str, outcomes=("visit", "conversion", "spend"),
                 n_boot: int = 500, seed: int = config.RANDOM_STATE) -> pd.DataFrame:
    """Per-1,000-customer value of each targeting policy with bootstrap 95% intervals, plus the
    paired difference against a baseline policy (same resamples, so the interval is honest)."""
    propensity = test["arm"].value_counts(normalize=True).to_dict()
    rng = np.random.default_rng(seed)
    arm = test["arm"].to_numpy()
    boot_idx = [rng.integers(0, len(test), len(test)) for _ in range(n_boot)]
    base = np.asarray(policies[baseline])
    rows = []
    for name, assigned in policies.items():
        assigned = np.asarray(assigned)
        row = {"policy": name, "emails_per_1000": float(np.mean(assigned != "control") * 1000)}
        for oc in outcomes:
            y = test[oc].to_numpy(dtype=float)
            est = policy_value(arm, assigned, y, propensity)
            boots = np.array([policy_value(arm[i], assigned[i], y[i], propensity) for i in boot_idx])
            base_boots = np.array([policy_value(arm[i], base[i], y[i], propensity) for i in boot_idx])
            diff = est - policy_value(arm, base, y, propensity)
            row[f"{oc}_per_1000"] = est * 1000
            row[f"{oc}_low"], row[f"{oc}_high"] = (np.quantile(boots, [0.025, 0.975]) * 1000).tolist()
            row[f"{oc}_vs_baseline"] = diff * 1000
            row[f"{oc}_vs_low"], row[f"{oc}_vs_high"] = (np.quantile(boots - base_boots, [0.025, 0.975]) * 1000).tolist()
        rows.append(row)
    return pd.DataFrame(rows)
