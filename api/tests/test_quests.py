from datetime import date, datetime, timezone

from app.game.quests import local_week


def test_local_week_starts_monday_local():
    # Sat 2026-09-26 15:00 UTC in Atlanta (lng -84.4 → UTC-6 by longitude)
    w = local_week(datetime(2026, 9, 26, 15, tzinfo=timezone.utc), -84.4)
    assert w.week_start == date(2026, 9, 21)
    assert w.start == datetime(2026, 9, 21, 6, tzinfo=timezone.utc)
    assert w.end == datetime(2026, 9, 28, 6, tzinfo=timezone.utc)
    assert w.month == date(2026, 9, 1)


def test_local_week_month_uses_local_date():
    # 03:00 UTC Oct 1 is still Sep 30 in Atlanta
    w = local_week(datetime(2026, 10, 1, 3, tzinfo=timezone.utc), -84.4)
    assert w.month == date(2026, 9, 1)
    assert w.week_start == date(2026, 9, 28)
