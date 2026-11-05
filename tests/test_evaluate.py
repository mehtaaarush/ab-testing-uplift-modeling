import numpy as np
import pandas as pd

from uplift.evaluate import auuc_gain, capture_share, cumulative_table, policy_value, uplift_by_group, uplift_curve


def _toy(n=40_000, seed=0):
    rng = np.random.default_rng(seed)
    x = rng.random(n)
    t = rng.integers(0, 2, n)
    y = (rng.random(n) < 0.1 + t * 0.2 * (x > 0.5)).astype(int)
    return x, t, y


def test_full_population_curve_equals_the_average_effect():
    x, t, y = _toy()
    table = cumulative_table(y, t, x)
    ate = y[t == 1].mean() - y[t == 0].mean()
    assert np.isclose(uplift_curve(table)[-1], ate)
    assert table["fraction"].iloc[-1] == 1.0


def test_informative_score_beats_random_score():
    x, t, y = _toy()
    noise = np.random.default_rng(1).random(len(x))
    assert auuc_gain(cumulative_table(y, t, x)) > 0.2
    assert abs(auuc_gain(cumulative_table(y, t, noise))) < 0.08
    assert capture_share(cumulative_table(y, t, x), 0.5) > 0.9


def test_deciles_separate_responders_from_non_responders():
    x, t, y = _toy()
    groups = uplift_by_group(y, t, x, groups=10)
    assert groups["observed"].head(5).mean() > 0.15
    assert abs(groups["observed"].tail(5).mean()) < 0.03


def test_policy_value_of_a_single_arm_policy_is_that_arms_mean():
    rng = np.random.default_rng(2)
    arm = rng.choice(["control", "mens", "womens"], 9_000)
    y = rng.random(9_000)
    propensity = pd.Series(arm).value_counts(normalize=True).to_dict()
    value = policy_value(arm, np.full(9_000, "mens"), y, propensity)
    assert np.isclose(value, y[arm == "mens"].mean())
