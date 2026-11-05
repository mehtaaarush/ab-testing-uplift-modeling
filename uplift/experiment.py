"""Classical A/B test analysis: randomisation checks, average effects with confidence
intervals, multiple-testing correction, regression adjustment and power."""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.multitest import multipletests

from . import config

BINARY_METRICS = {"visit", "conversion"}


def srm_test(df: pd.DataFrame, threshold: float = 0.001) -> dict:
    """Sample-ratio mismatch: chi-square test of arm sizes against the planned equal split."""
    counts = df["arm"].value_counts().reindex(list(config.ARMS.values()))
    chi2, p = stats.chisquare(counts.to_numpy(), np.full(len(counts), counts.sum() / len(counts)))
    return {"counts": {k: int(v) for k, v in counts.items()}, "chi2": float(chi2), "p_value": float(p), "passed": bool(p > threshold)}


def covariate_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Pre-treatment covariates with categorical levels expanded to indicators."""
    out = pd.DataFrame(
        {
            "Recency (months)": df["recency"].astype(float),
            "Past-year spend ($)": df["history"].astype(float),
            "Bought men's items": df["mens"].astype(float),
            "Bought women's items": df["womens"].astype(float),
            "New customer": df["newbie"].astype(float),
        },
        index=df.index,
    )
    for level in ["Urban", "Suburban", "Rural"]:
        out[f"Area: {level.lower()}"] = (df["zip_code"] == level).astype(float)
    for level in ["Web", "Phone", "Multichannel"]:
        out[f"Channel: {level.lower()}"] = (df["channel"] == level).astype(float)
    return out


def balance_table(df: pd.DataFrame) -> pd.DataFrame:
    """Standardised mean difference of every covariate, each e-mail arm vs. control.
    |SMD| < 0.1 is the conventional threshold for a well-balanced comparison."""
    X = covariate_frame(df)
    ctrl = X[df["arm"] == "control"]
    rows = {}
    for arm in config.TREATMENTS:
        trt = X[df["arm"] == arm]
        pooled_sd = np.sqrt((trt.var() + ctrl.var()) / 2)
        rows[arm] = (trt.mean() - ctrl.mean()) / pooled_sd
    return pd.DataFrame(rows)


def _z(alpha: float) -> float:
    return float(stats.norm.ppf(1 - alpha / 2))


def proportion_effect(x_t: int, n_t: int, x_c: int, n_c: int, alpha: float = config.ALPHA) -> dict:
    """Difference in proportions: pooled z-test for the p-value, unpooled Wald CI for the
    difference, and a delta-method CI for the relative lift (on the log ratio)."""
    p_t, p_c = x_t / n_t, x_c / n_c
    diff = p_t - p_c
    pooled = (x_t + x_c) / (n_t + n_c)
    z_stat = diff / np.sqrt(pooled * (1 - pooled) * (1 / n_t + 1 / n_c))
    se = np.sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c)
    se_log = np.sqrt((1 - p_t) / (n_t * p_t) + (1 - p_c) / (n_c * p_c))
    z = _z(alpha)
    return {
        "control": p_c, "treatment": p_t, "diff": diff,
        "ci_low": diff - z * se, "ci_high": diff + z * se,
        "lift": p_t / p_c - 1,
        "lift_low": np.exp(np.log(p_t / p_c) - z * se_log) - 1,
        "lift_high": np.exp(np.log(p_t / p_c) + z * se_log) - 1,
        "p_value": float(2 * stats.norm.sf(abs(z_stat))),
    }


def mean_effect(y_t: np.ndarray, y_c: np.ndarray, alpha: float = config.ALPHA) -> dict:
    """Difference in means with Welch's t-test; delta-method CI for the relative lift."""
    y_t, y_c = np.asarray(y_t, dtype=float), np.asarray(y_c, dtype=float)
    m_t, m_c = y_t.mean(), y_c.mean()
    v_t, v_c = y_t.var(ddof=1) / len(y_t), y_c.var(ddof=1) / len(y_c)
    se = np.sqrt(v_t + v_c)
    dof = (v_t + v_c) ** 2 / (v_t**2 / (len(y_t) - 1) + v_c**2 / (len(y_c) - 1))
    t_crit = float(stats.t.ppf(1 - alpha / 2, dof))
    diff = m_t - m_c
    se_log = np.sqrt(v_t / m_t**2 + v_c / m_c**2)
    return {
        "control": m_c, "treatment": m_t, "diff": diff,
        "ci_low": diff - t_crit * se, "ci_high": diff + t_crit * se,
        "lift": m_t / m_c - 1,
        "lift_low": np.exp(np.log(m_t / m_c) - t_crit * se_log) - 1,
        "lift_high": np.exp(np.log(m_t / m_c) + t_crit * se_log) - 1,
        "p_value": float(2 * stats.t.sf(abs(diff / se), dof)),
    }


def arm_effect(df: pd.DataFrame, arm: str, metric: str, alpha: float = config.ALPHA) -> dict:
    t = df.loc[df["arm"] == arm, metric]
    c = df.loc[df["arm"] == "control", metric]
    if metric in BINARY_METRICS:
        res = proportion_effect(int(t.sum()), len(t), int(c.sum()), len(c), alpha)
    else:
        res = mean_effect(t.to_numpy(), c.to_numpy(), alpha)
    return {"arm": arm, "metric": metric, "n_treatment": len(t), "n_control": len(c), **res}


def ate_table(df: pd.DataFrame, alpha: float = config.ALPHA) -> pd.DataFrame:
    """Every e-mail vs. control on every metric; Holm-adjusted p-values across the family."""
    rows = [arm_effect(df, arm, metric, alpha) for arm in config.TREATMENTS for metric in config.METRICS]
    out = pd.DataFrame(rows)
    out["p_holm"] = multipletests(out["p_value"], alpha=alpha, method="holm")[1]
    out["significant"] = out["p_holm"] < alpha
    return out


def bootstrap_mean_diff(y_t, y_c, n_boot: int = 4000, alpha: float = config.ALPHA, seed: int = config.RANDOM_STATE) -> tuple[float, float]:
    """Percentile bootstrap CI for a difference in means (a check on the t-interval for
    zero-inflated, heavy-tailed revenue)."""
    rng = np.random.default_rng(seed)
    y_t, y_c = np.asarray(y_t, dtype=float), np.asarray(y_c, dtype=float)
    diffs = np.empty(n_boot)
    for b in range(n_boot):
        diffs[b] = rng.choice(y_t, len(y_t)).mean() - rng.choice(y_c, len(y_c)).mean()
    return float(np.quantile(diffs, alpha / 2)), float(np.quantile(diffs, 1 - alpha / 2))


def regression_adjusted_effect(df: pd.DataFrame, arm: str, metric: str, alpha: float = config.ALPHA) -> dict:
    """Lin (2013) estimator: OLS of the outcome on treatment, centred covariates and their
    interactions, with HC2 robust errors. Same estimand as the difference in means, but
    pre-treatment covariates soak up outcome variance and tighten the interval."""
    sub = df[df["arm"].isin([arm, "control"])]
    X = covariate_frame(sub).drop(columns=["Area: suburban", "Channel: multichannel"])
    X = X - X.mean()
    t = (sub["arm"] == arm).astype(float).rename("treated")
    design = pd.concat([t, X, X.mul(t, axis=0).add_prefix("treated x ")], axis=1)
    fit = sm.OLS(sub[metric].astype(float), sm.add_constant(design)).fit(cov_type="HC2")
    est, se = float(fit.params["treated"]), float(fit.bse["treated"])
    unadjusted = arm_effect(df, arm, metric, alpha)
    z = _z(alpha)
    width_adj = 2 * z * se
    width_raw = unadjusted["ci_high"] - unadjusted["ci_low"]
    return {
        "arm": arm, "metric": metric, "diff": est, "ci_low": est - z * se, "ci_high": est + z * se,
        "unadjusted_diff": unadjusted["diff"], "ci_width_reduction": 1 - width_adj / width_raw,
    }


def segment_effects(df: pd.DataFrame, dimension: str, metric: str, alpha: float = config.ALPHA, min_n: int = 300) -> pd.DataFrame:
    """Heterogeneous treatment effects: each e-mail vs. control within every level of a segment."""
    rows = []
    for level, sub in df.groupby(dimension, sort=False):
        for arm in config.TREATMENTS:
            if (sub["arm"] == arm).sum() < min_n or (sub["arm"] == "control").sum() < min_n:
                continue
            res = arm_effect(sub, arm, metric, alpha)
            rows.append({"dimension": dimension, "level": level, "share": len(sub) / len(df), **res})
    return pd.DataFrame(rows)


def mde_proportion(p_control: float, n_per_arm: int, alpha: float = config.ALPHA, power: float = 0.8) -> float:
    """Smallest absolute lift detectable with the given power (normal approximation)."""
    z = _z(alpha) + stats.norm.ppf(power)
    return float(z * np.sqrt(2 * p_control * (1 - p_control) / n_per_arm))


def sample_size_proportion(p_control: float, lift_abs: float, alpha: float = config.ALPHA, power: float = 0.8) -> int:
    """Customers needed per arm to detect an absolute lift in a rate."""
    p_t = p_control + lift_abs
    z = _z(alpha) + stats.norm.ppf(power)
    return int(np.ceil(z**2 * (p_control * (1 - p_control) + p_t * (1 - p_t)) / lift_abs**2))
