import numpy as np
import pytest

from uplift.evaluate import auuc_gain, cumulative_table
from uplift.models import ClassTransformation, candidate_models, feature_frame
from uplift.targeting import campaign_rows


def test_features_are_pre_treatment_only(experiment_df):
    cols = set(feature_frame(experiment_df).columns)
    assert not cols & {"visit", "conversion", "spend", "arm"}


@pytest.mark.parametrize("model", candidate_models(), ids=lambda m: m.key)
def test_every_learner_recovers_planted_heterogeneity(experiment_df, model):
    half = len(experiment_df) // 2
    train, test = experiment_df.iloc[:half], experiment_df.iloc[half:]
    X, y, t, _ = campaign_rows(train, "womens")
    model.fit(X, y, t)
    X_te, y_te, t_te, _ = campaign_rows(test, "womens")
    assert auuc_gain(cumulative_table(y_te, t_te, model.predict(X_te))) > 0.2


def test_class_transformation_requires_a_balanced_split():
    rng = np.random.default_rng(0)
    X = rng.random((1_000, 3))
    t = (rng.random(1_000) < 0.8).astype(int)
    with pytest.raises(ValueError, match="balanced"):
        ClassTransformation().fit(X, rng.integers(0, 2, 1_000), t)
