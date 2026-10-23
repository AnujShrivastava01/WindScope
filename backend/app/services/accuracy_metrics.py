"""Forecast accuracy metrics computed from matched observations only.

Conventions: ``error = forecast - actual`` in MW. Positive values mean wind
generation was over-estimated (less wind arrived than expected); negative values
mean it was under-estimated.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd


def _f(value: object) -> float | None:
    """Convert to a JSON-safe float, mapping NaN/inf to ``None``."""
    if value is None:
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def compute_metrics(forecast: pd.Series | np.ndarray, actual: pd.Series | np.ndarray) -> dict[str, object]:
    """Compute summary accuracy statistics for paired forecast/actual values.

    Pairs where either value is missing or non-finite are dropped and counted.
    MAPE excludes periods whose actual is zero (division undefined); the number of
    exclusions is reported. WAPE (weighted absolute percentage error) divides total
    absolute error by total absolute actual generation.
    """
    f = np.asarray(forecast, dtype="float64")
    a = np.asarray(actual, dtype="float64")
    valid = np.isfinite(f) & np.isfinite(a)
    f, a = f[valid], a[valid]
    n = int(f.size)
    base: dict[str, object] = {
        "count": n,
        "invalid_pairs": int((~valid).sum()),
        "mae_mw": None,
        "rmse_mw": None,
        "bias_mw": None,
        "mape_pct": None,
        "mape_count": 0,
        "mape_excluded": 0,
        "wape_pct": None,
        "max_abs_error_mw": None,
        "std_error_mw": None,
        "overestimation_pct": None,
        "underestimation_pct": None,
        "exact_pct": None,
        "overestimation_count": 0,
        "underestimation_count": 0,
        "exact_count": 0,
        "mean_forecast_mw": None,
        "mean_actual_mw": None,
        "abs_error_p50_mw": None,
        "abs_error_p90_mw": None,
        "abs_error_p95_mw": None,
        "error_p10_mw": None,
        "error_p90_mw": None,
        "correlation": None,
    }
    if n == 0:
        return base

    err = f - a
    abs_err = np.abs(err)
    nonzero = a != 0
    mape_n = int(nonzero.sum())
    denom = float(np.abs(a).sum())
    over = int((err > 0).sum())
    under = int((err < 0).sum())
    exact = n - over - under

    base.update(
        mae_mw=_f(abs_err.mean()),
        rmse_mw=_f(math.sqrt(float((err**2).mean()))),
        bias_mw=_f(err.mean()),
        mape_pct=_f((abs_err[nonzero] / np.abs(a[nonzero])).mean() * 100) if mape_n else None,
        mape_count=mape_n,
        mape_excluded=n - mape_n,
        wape_pct=_f(abs_err.sum() / denom * 100) if denom > 0 else None,
        max_abs_error_mw=_f(abs_err.max()),
        std_error_mw=_f(err.std(ddof=1)) if n > 1 else None,
        overestimation_pct=_f(over / n * 100),
        underestimation_pct=_f(under / n * 100),
        exact_pct=_f(exact / n * 100),
        overestimation_count=over,
        underestimation_count=under,
        exact_count=exact,
        mean_forecast_mw=_f(f.mean()),
        mean_actual_mw=_f(a.mean()),
        abs_error_p50_mw=_f(np.percentile(abs_err, 50)),
        abs_error_p90_mw=_f(np.percentile(abs_err, 90)),
        abs_error_p95_mw=_f(np.percentile(abs_err, 95)),
        error_p10_mw=_f(np.percentile(err, 10)),
        error_p90_mw=_f(np.percentile(err, 90)),
        correlation=_f(np.corrcoef(f, a)[0, 1]) if n > 1 and f.std() > 0 and a.std() > 0 else None,
    )
    return base


def grouped_metrics(matched: pd.DataFrame, key: str) -> list[dict[str, object]]:
    """MAE/RMSE/bias/max by a grouping column of a matched-periods frame."""
    if matched.empty:
        return []
    rows = []
    for value, group in matched.groupby(key, sort=True):
        err = group["error_mw"].to_numpy(dtype="float64")
        rows.append(
            {
                key: value.item() if hasattr(value, "item") else value,
                "count": int(err.size),
                "mae_mw": _f(np.abs(err).mean()),
                "rmse_mw": _f(math.sqrt(float((err**2).mean()))),
                "bias_mw": _f(err.mean()),
                "max_abs_error_mw": _f(np.abs(err).max()),
                "mean_forecast_mw": _f(group["forecast_mw"].mean()),
                "mean_actual_mw": _f(group["actual_mw"].mean()),
                "overestimation_count": int((err > 0).sum()),
                "underestimation_count": int((err < 0).sum()),
            }
        )
    return rows


def histogram(
    values: pd.Series | np.ndarray, *, bins: int = 20, symmetric: bool = False
) -> list[dict[str, object]]:
    """Fixed-width histogram with "nice" bin widths for charting."""
    data = np.asarray(values, dtype="float64")
    data = data[np.isfinite(data)]
    if data.size == 0:
        return []
    lo, hi = float(data.min()), float(data.max())
    if symmetric:
        bound = max(abs(lo), abs(hi))
        lo, hi = -bound, bound
    else:
        lo = min(lo, 0.0)
    span = hi - lo
    width = _nice_width(span / bins) if span > 0 else 1.0
    start = math.floor(lo / width) * width
    edges = [start]
    while edges[-1] < hi or len(edges) < 2:
        edges.append(edges[-1] + width)
    counts, _ = np.histogram(data, bins=np.asarray(edges))
    total = int(data.size)
    return [
        {
            "bin_start": _f(edges[i]),
            "bin_end": _f(edges[i + 1]),
            "count": int(counts[i]),
            "share_pct": _f(counts[i] / total * 100),
        }
        for i in range(len(counts))
    ]


def _nice_width(raw: float) -> float:
    exponent = math.floor(math.log10(raw))
    fraction = raw / 10**exponent
    for nice in (1, 2, 2.5, 5, 10):
        if fraction <= nice:
            return nice * 10**exponent
    return 10 ** (exponent + 1)
