import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.stats.proportion import proportions_ztest

from uplift import experiment


def test_proportion_effect_matches_statsmodels_z_test():
    res = experiment.proportion_effect(1_830, 10_000, 1_060, 10_000)
    _, p = proportions_ztest([1_830, 1_060], [10_000, 10_000])
    assert np.isclose(res["p_value"], p)
    assert np.isclose(res["diff"], 0.077)
    assert res["ci_low"] < 0.077 < res["ci_high"]
    assert res["lift_low"] < res["lift"] < res["lift_high"]


def test_mean_effect_matches_welch_t_test():
    rng = np.random.default_rng(1)
    a, b = rng.exponential(2.0, 4_000), rng.exponential(1.6, 5_000)
    res = experiment.mean_effect(a, b)
    assert np.isclose(res["p_value"], stats.ttest_ind(a, b, equal_var=False).pvalue)


def test_srm_flags_an_unequal_split_and_passes_a_fair_one():
    fair = pd.DataFrame({"arm": ["control"] * 10_000 + ["mens"] * 10_050 + ["womens"] * 9_980})
    skewed = pd.DataFrame({"arm": ["control"] * 10_000 + ["mens"] * 10_600 + ["womens"] * 10_000})
    assert experiment.srm_test(fair)["passed"]
    assert not experiment.srm_test(skewed)["passed"]


def test_ate_table_finds_the_planted_effect_and_holm_never_lowers_p(experiment_df):
    table = experiment.ate_table(experiment_df).set_index(["arm", "metric"])
    mens = table.loc[("mens", "visit")]
    assert abs(mens["diff"] - 0.08) < 0.02
    assert mens["ci_low"] < mens["diff"] < mens["ci_high"]
    assert mens["significant"]
    assert (table["p_holm"] >= table["p_value"] - 1e-12).all()


def test_regression_adjustment_keeps_the_estimate(experiment_df):
    res = experiment.regression_adjusted_effect(experiment_df, "mens", "visit")
    assert abs(res["diff"] - res["unadjusted_diff"]) < 0.005
    assert res["ci_width_reduction"] > -0.02


def test_covariates_are_balanced_under_randomisation(experiment_df):
    assert experiment.balance_table(experiment_df).abs().max().max() < 0.1


def test_womens_email_effect_is_concentrated_in_womens_buyers(experiment_df):
    seg = experiment.segment_effects(experiment_df, "purchase_mix", "visit").set_index(["level", "arm"])
    assert seg.loc[("Women's only", "womens"), "diff"] > 0.08
    assert abs(seg.loc[("Men's only", "womens"), "diff"]) < 0.03


def test_sample_size_and_mde_are_consistent():
    n = experiment.sample_size_proportion(0.10, 0.01)
    mde = experiment.mde_proportion(0.10, n)
    assert 0.009 < mde < 0.0105
