"""Who should get the e-mail? Uplift-model selection by cross-validation, evaluation on a
customer-level hold-out, and comparison of targeting policies."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold, train_test_split

from . import config
from .evaluate import (auuc_gain, bootstrap_auuc, capture_share, cumulative_table, policy_table,
                       uplift_by_group, uplift_curve)
from .models import ArmResponseModels, candidate_models, feature_frame

PROFILE = {
    "Bought women's items": lambda d: d["womens"],
    "Bought men's items": lambda d: d["mens"],
    "New customer": lambda d: d["newbie"],
    "Shops on the web only": lambda d: (d["channel"] == "Web").astype(int),
    "Past-year spend ($)": lambda d: d["history"],
    "Months since last purchase": lambda d: d["recency"],
}


def split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """70/30 customer split, stratified on arm x outcome so both halves mirror the experiment."""
    strata = df["arm"] + "_" + df[config.UPLIFT_TARGET].astype(str)
    return train_test_split(df, test_size=config.TEST_SIZE, random_state=config.RANDOM_STATE, stratify=strata)


def campaign_rows(df: pd.DataFrame, campaign: str):
    """One e-mail against control: features, outcome, treatment flag and the rows themselves."""
    sub = df[df["arm"].isin([campaign, "control"])]
    return feature_frame(sub), sub[config.UPLIFT_TARGET].to_numpy(), (sub["arm"] == campaign).astype(int).to_numpy(), sub


def cross_validated_auuc(train: pd.DataFrame, campaign: str, folds: int = config.CV_FOLDS) -> dict[str, float]:
    """Mean out-of-fold AUUC gain per model, on training customers only (used to pick a model)."""
    X, y, t, _ = campaign_rows(train, campaign)
    cv = StratifiedKFold(folds, shuffle=True, random_state=config.RANDOM_STATE)
    scores: dict[str, list[float]] = {}
    for fit_idx, val_idx in cv.split(X, 2 * t + y):
        for model in candidate_models():
            model.fit(X.iloc[fit_idx], y[fit_idx], t[fit_idx])
            table = cumulative_table(y[val_idx], t[val_idx], model.predict(X.iloc[val_idx]))
            scores.setdefault(model.key, []).append(auuc_gain(table))
    return {k: float(np.mean(v)) for k, v in scores.items()}


def profile(test_rows: pd.DataFrame, score: np.ndarray, top: float = 0.3) -> list[dict]:
    """Average traits of the customers the model would target first versus last."""
    rank = pd.Series(score, index=test_rows.index).rank(ascending=False, pct=True)
    groups = {"top": rank <= top, "bottom": rank > 1 - top, "all": rank > 0}
    return [{"trait": name, **{g: float(fn(test_rows)[mask].mean()) for g, mask in groups.items()}} for name, fn in PROFILE.items()]


def evaluate_campaign(train: pd.DataFrame, test: pd.DataFrame, campaign: str) -> dict:
    cv = cross_validated_auuc(train, campaign)
    selected = max(cv, key=cv.get)
    X_tr, y_tr, t_tr, _ = campaign_rows(train, campaign)
    X_te, y_te, t_te, te = campaign_rows(test, campaign)

    models, curves, scores = [], {}, {}
    for model in candidate_models():
        model.fit(X_tr, y_tr, t_tr)
        score = model.predict(X_te)
        table = cumulative_table(y_te, t_te, score)
        low, high = bootstrap_auuc(y_te, t_te, score)
        models.append({
            "key": model.key, "name": model.name, "cv_auuc": cv[model.key], "test_auuc": auuc_gain(table),
            "test_low": low, "test_high": high, "capture_30": capture_share(table, 0.3),
        })
        curves[model.key] = uplift_curve(table)
        scores[model.key] = score
        fractions = table["fraction"].to_numpy()

    score = scores[selected]
    simulator = cumulative_table(y_te, t_te, score, extra={"spend": te["spend"], "conversion": te["conversion"]}, bins=20)
    return {
        "selected": selected,
        "models": models,
        "curve": {"fraction": fractions, **curves},
        "deciles": uplift_by_group(y_te, t_te, score, groups=10),
        "simulator": simulator,
        "profile": profile(te, score),
        "n_test": int(len(te)),
    }


def compare_policies(train: pd.DataFrame, test: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Choose an e-mail (or none) per customer from per-arm response models, then score each rule
    on the hold-out with inverse-propensity weighting."""
    arm_models = ArmResponseModels().fit(feature_frame(train), train[config.UPLIFT_TARGET], train["arm"])
    pred = arm_models.predict(feature_frame(test))
    best = pred[config.TREATMENTS].idxmax(axis=1).to_numpy()
    gain = pred[config.TREATMENTS].max(axis=1).to_numpy() - pred["control"].to_numpy()
    n = len(test)
    policies = {
        "No e-mail": np.full(n, "control"),
        "Women's e-mail to everyone": np.full(n, "womens"),
        "Men's e-mail to everyone": np.full(n, "mens"),
        "Best e-mail for each customer": best,
        "Best e-mail, top half by predicted uplift": np.where(gain >= np.median(gain), best, "control"),
    }
    table = policy_table(test, policies, baseline="Men's e-mail to everyone")
    info = {"womens_share_in_best": float(np.mean(best == "womens"))}
    return table, info
