"""Accuracy metric formulas (synthetic values only)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.services.accuracy_metrics import compute_metrics, histogram


def test_basic_metrics_match_hand_calculation():
    forecast = [110.0, 90.0, 130.0, 100.0]
    actual = [100.0, 100.0, 100.0, 100.0]
    m = compute_metrics(forecast, actual)
    # errors: +10, -10, +30, 0
    assert m["count"] == 4
    assert m["mae_mw"] == pytest.approx(12.5)
    assert m["rmse_mw"] == pytest.approx(math.sqrt((100 + 100 + 900 + 0) / 4))
    assert m["bias_mw"] == pytest.approx(7.5)
    assert m["mape_pct"] == pytest.approx(12.5)
    assert m["wape_pct"] == pytest.approx(50 / 400 * 100)
    assert m["max_abs_error_mw"] == 30.0
    assert m["overestimation_count"] == 2
    assert m["underestimation_count"] == 1
    assert m["exact_count"] == 1
    assert m["overestimation_pct"] == pytest.approx(50.0)
    assert m["underestimation_pct"] == pytest.approx(25.0)


def test_mape_excludes_zero_actuals_and_reports_count():
    m = compute_metrics([10.0, 110.0], [0.0, 100.0])
    assert m["mape_excluded"] == 1
    assert m["mape_count"] == 1
    assert m["mape_pct"] == pytest.approx(10.0)
    # WAPE still uses every matched period
    assert m["wape_pct"] == pytest.approx(20 / 100 * 100)
    assert m["mae_mw"] == pytest.approx(10.0)


def test_all_zero_actuals_give_undefined_percentages():
    m = compute_metrics([5.0, 5.0], [0.0, 0.0])
    assert m["mape_pct"] is None
    assert m["wape_pct"] is None
    assert m["mape_excluded"] == 2
    assert m["mae_mw"] == 5.0


def test_empty_dataset_returns_nulls_not_zeros():
    m = compute_metrics([], [])
    assert m["count"] == 0
    assert m["mae_mw"] is None
    assert m["rmse_mw"] is None
    assert m["bias_mw"] is None
    assert m["overestimation_pct"] is None


def test_missing_and_non_finite_pairs_are_dropped():
    m = compute_metrics([100.0, np.nan, 50.0, np.inf], [90.0, 10.0, np.nan, 5.0])
    assert m["count"] == 1
    assert m["invalid_pairs"] == 3
    assert m["mae_mw"] == 10.0


def test_single_observation_has_no_std():
    m = compute_metrics([1.0], [2.0])
    assert m["std_error_mw"] is None
    assert m["correlation"] is None


def test_histogram_counts_every_value():
    bins = histogram([0, 1, 2, 3, 49, 50, 99], bins=10)
    assert sum(b["count"] for b in bins) == 7
    assert bins[0]["bin_start"] == 0
    assert all(b["bin_end"] > b["bin_start"] for b in bins)


def test_symmetric_histogram_centres_zero():
    bins = histogram([-30, -5, 5, 40], bins=8, symmetric=True)
    assert bins[0]["bin_start"] <= -40
    assert bins[-1]["bin_end"] >= 40
    assert sum(b["count"] for b in bins) == 4


def test_histogram_empty():
    assert histogram([]) == []
