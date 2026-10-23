"""Numeric coercion helpers."""

from __future__ import annotations

from app.utils.time import is_finite_number


def to_finite_float(value: object) -> float | None:
    """Return ``value`` as a finite float, or ``None`` if it is missing/invalid."""
    if is_finite_number(value):
        return float(value)  # type: ignore[arg-type]
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
        return parsed if is_finite_number(parsed) else None
    return None
