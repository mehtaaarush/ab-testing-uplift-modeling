import numpy as np
import pandas as pd
import pytest


def make_experiment(n: int = 30_000, seed: int = 0) -> pd.DataFrame:
    """Synthetic three-arm e-mail test with the source file's columns. The women's e-mail only
    lifts visits for customers who bought women's items; the men's e-mail lifts everyone."""
    rng = np.random.default_rng(seed)
    womens = rng.integers(0, 2, n)
    mens = np.where(womens == 0, 1, rng.integers(0, 2, n))
    arm = rng.choice(["control", "mens", "womens"], n)
    base = 0.10 + 0.02 * (rng.random(n) < 0.5)
    lift = np.where(arm == "mens", 0.08, 0.0) + np.where((arm == "womens") & (womens == 1), 0.12, 0.0)
    visit = (rng.random(n) < base + lift).astype(int)
    conversion = visit * (rng.random(n) < 0.08)
    spend = conversion * rng.gamma(2.0, 60.0, n)
    return pd.DataFrame(
        {
            "recency": rng.integers(1, 13, n),
            "history_segment": "1) $0 - $100",
            "history": rng.gamma(1.5, 160.0, n).round(2),
            "mens": mens,
            "womens": womens,
            "zip_code": rng.choice(["Urban", "Surburban", "Rural"], n),
            "newbie": rng.integers(0, 2, n),
            "channel": rng.choice(["Web", "Phone", "Multichannel"], n),
            "segment": pd.Series(arm).map({"control": "No E-Mail", "mens": "Mens E-Mail", "womens": "Womens E-Mail"}),
            "visit": visit,
            "conversion": conversion,
            "spend": spend.round(2),
        }
    )


@pytest.fixture(scope="session")
def raw():
    return make_experiment()


@pytest.fixture(scope="session")
def experiment_df(raw):
    from uplift.data import tidy

    return tidy(raw)
