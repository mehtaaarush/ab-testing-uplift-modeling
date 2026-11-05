import pytest

from uplift.data import tidy


def test_tidy_maps_arms_and_fixes_labels(raw):
    df = tidy(raw)
    assert set(df["arm"]) == {"control", "mens", "womens"}
    assert "Surburban" not in set(df["zip_code"]) and "Suburban" in set(df["zip_code"])
    assert set(df["history_segment"]) == {"$0–$100"}
    assert set(df["purchase_mix"]) <= {"Men's only", "Women's only", "Both"}


def test_validation_rejects_spend_without_a_conversion(raw):
    bad = raw.copy()
    row = bad.index[bad["conversion"] == 0][0]
    bad.loc[row, "spend"] = 25.0
    with pytest.raises(AssertionError, match="spend without a conversion"):
        tidy(bad)


def test_unknown_arm_label_is_an_error(raw):
    bad = raw.copy()
    bad.loc[0, "segment"] = "Kids E-Mail"
    with pytest.raises(ValueError, match="Unknown experiment arm"):
        tidy(bad)
