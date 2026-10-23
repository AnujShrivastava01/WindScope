"""CSV import validation and CSV export for the two permitted Elexon datasets."""

from __future__ import annotations

import io
from dataclasses import dataclass, field

import pandas as pd

from app.services.actual_generation import parse_fuelhh_records
from app.services.models import DataSource, ParseResult
from app.services.wind_forecasts import parse_windfor_records
from app.utils.time import UK_TZ

MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_IMPORT_ROWS = 200_000

# Accepted header aliases (case/whitespace insensitive) -> canonical Elexon field.
ALIASES = {
    "starttime": "startTime",
    "start_time": "startTime",
    "start_time_utc": "startTime",
    "publishtime": "publishTime",
    "publish_time": "publishTime",
    "publish_time_utc": "publishTime",
    "generation": "generation",
    "generation_mw": "generation",
    "fueltype": "fuelType",
    "fuel_type": "fuelType",
    "settlementdate": "settlementDate",
    "settlement_date": "settlementDate",
    "settlementperiod": "settlementPeriod",
    "settlement_period": "settlementPeriod",
}

REQUIRED = {
    "actual": ["startTime", "generation"],
    "forecast": ["startTime", "publishTime", "generation"],
}


class CsvValidationError(ValueError):
    """The uploaded file cannot be processed at all (not per-row problems)."""


@dataclass(slots=True)
class CsvParseOutcome:
    dataset: str
    result: ParseResult
    columns: list[str] = field(default_factory=list)


def parse_csv_upload(content: bytes, dataset: str) -> CsvParseOutcome:
    if dataset not in REQUIRED:
        raise CsvValidationError("dataset must be 'actual' or 'forecast'")
    if not content:
        raise CsvValidationError("The uploaded file is empty.")
    if len(content) > MAX_IMPORT_BYTES:
        raise CsvValidationError(f"File exceeds the {MAX_IMPORT_BYTES // (1024 * 1024)} MB limit.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CsvValidationError("File must be UTF-8 encoded CSV.") from exc
    try:
        frame = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, skipinitialspace=True)
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
        raise CsvValidationError(f"Could not parse CSV: {exc}") from exc
    if len(frame) > MAX_IMPORT_ROWS:
        raise CsvValidationError(f"File has more than {MAX_IMPORT_ROWS} rows.")

    rename = {}
    for col in frame.columns:
        canonical = ALIASES.get(str(col).strip().lower())
        if canonical and canonical not in rename.values():
            rename[col] = canonical
    frame = frame.rename(columns=rename)
    missing = [c for c in REQUIRED[dataset] if c not in frame.columns]
    if missing:
        raise CsvValidationError(
            f"Missing required column(s): {', '.join(missing)}. "
            f"Required for {dataset} data: {', '.join(REQUIRED[dataset])}."
        )

    known = [c for c in frame.columns if c in set(ALIASES.values())]
    rows = [
        {k: (v.strip() if isinstance(v, str) and v.strip() != "" else None) for k, v in row.items()}
        for row in frame[known].to_dict(orient="records")
    ]
    if dataset == "actual":
        result = parse_fuelhh_records(rows, source=DataSource.CSV_IMPORT, require_fuel_type=False)
    else:
        result = parse_windfor_records(rows, source=DataSource.CSV_IMPORT)
    # Report CSV line numbers (header is line 1).
    for i, rejected in enumerate(result.rejected):
        result.rejected[i] = type(rejected)(rejected.row + 1, rejected.reason, rejected.raw)
    return CsvParseOutcome(dataset=dataset, result=result, columns=list(frame.columns))


def _uk(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, utc=True)
    return parsed.dt.tz_convert(UK_TZ).map(lambda t: t.isoformat() if not pd.isna(t) else "")


def actuals_export_frame(items: list[dict[str, object]]) -> pd.DataFrame:
    columns = [
        "start_time_utc", "start_time_uk", "settlement_date", "settlement_period", "fuel_type",
        "generation_mw", "unit", "publish_time_utc", "source",
    ]  # fmt: skip
    if not items:
        return pd.DataFrame(columns=columns)
    frame = pd.DataFrame(items)
    return pd.DataFrame(
        {
            "start_time_utc": frame["start_time"],
            "start_time_uk": _uk(frame["start_time"]),
            "settlement_date": frame["settlement_date"],
            "settlement_period": frame["settlement_period"],
            "fuel_type": "WIND",
            "generation_mw": frame["generation_mw"],
            "unit": "MW",
            "publish_time_utc": frame["publish_time"],
            "source": frame["source"],
        }
    )[columns]


def forecasts_export_frame(items: list[dict[str, object]]) -> pd.DataFrame:
    columns = [
        "start_time_utc", "start_time_uk", "publish_time_utc", "publish_time_uk",
        "generation_mw", "unit", "source",
    ]  # fmt: skip
    if not items:
        return pd.DataFrame(columns=columns)
    frame = pd.DataFrame(items)
    return pd.DataFrame(
        {
            "start_time_utc": frame["start_time"],
            "start_time_uk": _uk(frame["start_time"]),
            "publish_time_utc": frame["publish_time"],
            "publish_time_uk": _uk(frame["publish_time"]),
            "generation_mw": frame["generation_mw"],
            "unit": "MW",
            "source": frame["source"],
        }
    )[columns]


def to_csv_bytes(frame: pd.DataFrame) -> bytes:
    return frame.to_csv(index=False, lineterminator="\n").encode("utf-8")
