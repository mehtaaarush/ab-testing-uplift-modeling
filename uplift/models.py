"""Uplift (heterogeneous treatment effect) models for a randomised binary treatment.

All learners expose fit(X, y, t) and predict(X) -> estimated uplift
P(y=1 | x, treated) - P(y=1 | x, control).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config


def feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Pre-treatment features only (outcomes and the arm are never inputs)."""
    return pd.DataFrame(
        {
            "recency": df["recency"].astype(float),
            "log_history": np.log1p(df["history"].astype(float)),
            "mens": df["mens"].astype(float),
            "womens": df["womens"].astype(float),
            "newbie": df["newbie"].astype(float),
            "zip_urban": (df["zip_code"] == "Urban").astype(float),
            "zip_rural": (df["zip_code"] == "Rural").astype(float),
            "channel_web": (df["channel"] == "Web").astype(float),
            "channel_phone": (df["channel"] == "Phone").astype(float),
        },
        index=df.index,
    )


def gradient_boosting():
    return HistGradientBoostingClassifier(
        learning_rate=0.05, max_iter=250, max_leaf_nodes=15, min_samples_leaf=200,
        l2_regularization=1.0, random_state=config.RANDOM_STATE,
    )


def logistic():
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000))


class TLearner:
    """Two outcome models, one per arm; uplift is the difference of their predictions."""

    def __init__(self, base=gradient_boosting, name="T-learner (gradient boosting)", key="t_gbm"):
        self.base, self.name, self.key = base, name, key

    def fit(self, X, y, t):
        X, y, t = np.asarray(X), np.asarray(y), np.asarray(t)
        self.treated = self.base().fit(X[t == 1], y[t == 1])
        self.control = self.base().fit(X[t == 0], y[t == 0])
        return self

    def predict(self, X):
        X = np.asarray(X)
        return self.treated.predict_proba(X)[:, 1] - self.control.predict_proba(X)[:, 1]


class SLearner:
    """One model with the treatment flag as a feature; uplift = f(x, 1) - f(x, 0)."""

    def __init__(self, base=gradient_boosting, name="S-learner (gradient boosting)", key="s_gbm"):
        self.base, self.name, self.key = base, name, key

    def fit(self, X, y, t):
        X = np.asarray(X)
        self.model = self.base().fit(np.column_stack([X, t]), np.asarray(y))
        return self

    def predict(self, X):
        X = np.asarray(X)
        ones, zeros = np.ones(len(X)), np.zeros(len(X))
        return self.model.predict_proba(np.column_stack([X, ones]))[:, 1] - self.model.predict_proba(np.column_stack([X, zeros]))[:, 1]


class ClassTransformation:
    """Jaskowski & Jaroszewicz (2012): with a 50/50 split, z = 1 when (treated and converted)
    or (control and not converted), and uplift = 2 P(z=1 | x) - 1."""

    def __init__(self, base=gradient_boosting, name="Class transformation (gradient boosting)", key="ct_gbm"):
        self.base, self.name, self.key = base, name, key

    def fit(self, X, y, t):
        y, t = np.asarray(y), np.asarray(t)
        if not 0.45 < t.mean() < 0.55:
            raise ValueError("Class transformation assumes a balanced treatment split")
        z = (y * t + (1 - y) * (1 - t)).astype(int)
        self.model = self.base().fit(np.asarray(X), z)
        return self

    def predict(self, X):
        return 2 * self.model.predict_proba(np.asarray(X))[:, 1] - 1


def candidate_models():
    return [
        TLearner(),
        SLearner(),
        ClassTransformation(),
        TLearner(base=logistic, name="T-learner (logistic regression)", key="t_logit"),
    ]


class ArmResponseModels:
    """Outcome model per arm (control, mens, womens) for choosing the best e-mail per customer."""

    def __init__(self, base=gradient_boosting):
        self.base = base

    def fit(self, X, y, arm):
        X, y, arm = np.asarray(X), np.asarray(y), np.asarray(arm)
        self.models = {a: self.base().fit(X[arm == a], y[arm == a]) for a in config.ARMS.values()}
        return self

    def predict(self, X) -> pd.DataFrame:
        X = np.asarray(X)
        return pd.DataFrame({a: m.predict_proba(X)[:, 1] for a, m in self.models.items()})
