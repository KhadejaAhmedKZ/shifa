"""Daily Check-in: storage, personal-baseline analysis and drift alerts.

Everything here compares a person against THEIR OWN history — never against a
population "normal". These are wellness estimates, not medical measurements.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from statistics import mean, median

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import CheckIn, User, UserRole
from backend.services import notification_service

MIN_READINGS = 5          # readings needed before we trust a baseline
RECENT_N = 3              # "recent" = average of the last N readings
BASELINE_WINDOW_DAYS = 30
TREND_WINDOW_DAYS = 14
MIN_CONFIDENCE = 0.6      # readings below this are ignored for baselines

# metric -> (value column, confidence column, unit, absolute drift, relative drift)
METRICS = {
    "heart_rate": ("heart_rate", "heart_rate_conf", "bpm", 6.0, 0.08),
    "respiratory_rate": ("respiratory_rate", "respiratory_rate_conf", "breaths/min", 3.0, 0.18),
    "hrv_sdnn": ("hrv_sdnn", "hrv_conf", "ms", 8.0, 0.20),
}

LABELS = {
    "heart_rate": ("resting heart rate", "معدل نبض القلب أثناء الراحة"),
    "respiratory_rate": ("breathing rate", "معدل التنفس"),
    "hrv_sdnn": ("heart rate variability", "تقلب معدل نبض القلب"),
}


def serialize(c: CheckIn) -> dict:
    return {
        "id": c.id,
        "patient_id": c.patient_id,
        "created_at": c.created_at.isoformat(),
        "heart_rate": c.heart_rate,
        "heart_rate_conf": c.heart_rate_conf,
        "respiratory_rate": c.respiratory_rate,
        "respiratory_rate_conf": c.respiratory_rate_conf,
        "hrv_sdnn": c.hrv_sdnn,
        "hrv_conf": c.hrv_conf,
        "source": c.source,
        "posture_score": c.posture_score,
        "sit_to_stand_reps": c.sit_to_stand_reps,
        "shoulder_roll_reps": c.shoulder_roll_reps,
    }


def list_checkins(db: Session, patient_id: int, limit: int = 90) -> list[CheckIn]:
    rows = db.scalars(
        select(CheckIn)
        .where(CheckIn.patient_id == patient_id)
        .order_by(CheckIn.created_at.desc())
        .limit(limit)
    ).all()
    return list(reversed(rows))  # oldest first


def _slope_per_day(points: list[tuple[datetime, float]]) -> float:
    """Least-squares slope in units/day."""
    if len(points) < 2:
        return 0.0
    t0 = points[0][0]
    xs = [(t - t0).total_seconds() / 86400 for t, _ in points]
    ys = [v for _, v in points]
    mx, my = mean(xs), mean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def analyse(readings: list[CheckIn], now: datetime | None = None) -> dict:
    """Compare the latest readings with the person's own baseline.

    ``readings`` must be oldest-first. Returns per-metric baseline / recent /
    delta, plus a list of human-readable drift alerts (English + Arabic).
    """
    now = now or datetime.utcnow()
    metrics: dict[str, dict] = {}
    alerts: list[dict] = []

    for key, (col, conf_col, unit, abs_thr, rel_thr) in METRICS.items():
        pts = [
            (r.created_at, float(getattr(r, col)))
            for r in readings
            if getattr(r, col) is not None
            and (getattr(r, conf_col) is None or getattr(r, conf_col) >= MIN_CONFIDENCE)
            and r.created_at >= now - timedelta(days=BASELINE_WINDOW_DAYS)
        ]
        if len(pts) < MIN_READINGS:
            metrics[key] = {"ready": False, "count": len(pts), "needed": MIN_READINGS, "unit": unit}
            continue

        baseline = median(v for _, v in pts[:-RECENT_N])
        recent = mean(v for _, v in pts[-RECENT_N:])
        delta = recent - baseline
        pct = delta / baseline if baseline else 0.0
        threshold = max(abs_thr, rel_thr * baseline)
        direction = "up" if delta >= threshold else "down" if delta <= -threshold else "steady"

        trend_pts = [p for p in pts if p[0] >= now - timedelta(days=TREND_WINDOW_DAYS)]
        span_days = (
            (trend_pts[-1][0] - trend_pts[0][0]).total_seconds() / 86400 if len(trend_pts) >= 2 else 0
        )
        trend_change = _slope_per_day(trend_pts) * span_days if len(trend_pts) >= MIN_READINGS else 0.0

        # Which direction is worth a heads-up? HR/RR creeping up, or HRV falling.
        concerning = direction == ("down" if key == "hrv_sdnn" else "up")
        # Also flag a notable swing the "good" way so nothing is silently hidden.
        notable = direction != "steady"

        metrics[key] = {
            "ready": True,
            "unit": unit,
            "count": len(pts),
            "baseline": round(baseline, 1),
            "recent": round(recent, 1),
            "delta": round(delta, 1),
            "pct": round(pct * 100, 1),
            "direction": direction,
            "drift": notable,
            "concerning": concerning,
            "trend_14d_change": round(trend_change, 1),
            "trend_days": round(span_days),
        }

        if notable:
            en_label, ar_label = LABELS[key]
            days = max(1, round(span_days))
            word_en = "up" if direction == "up" else "down"
            word_ar = "ارتفاع" if direction == "up" else "انخفاض"
            alerts.append(
                {
                    "metric": key,
                    "direction": direction,
                    "concerning": concerning,
                    "message_en": (
                        f"{en_label.capitalize()} is trending {word_en}: about {recent:.0f} {unit} "
                        f"recently vs a personal baseline of {baseline:.0f} {unit} "
                        f"({delta:+.0f}) over the last {days} days."
                    ),
                    "message_ar": (
                        f"{word_ar} في {ar_label}: حوالي {recent:.0f} مؤخراً مقابل "
                        f"المعدل الشخصي المعتاد {baseline:.0f} ({delta:+.0f}) خلال آخر {days} يوماً."
                    ),
                }
            )

    return {
        "ready": any(m.get("ready") for m in metrics.values()),
        "metrics": metrics,
        "alerts": alerts,
        "has_concern": any(a["concerning"] for a in alerts),
    }


def save_checkin(db: Session, patient: User, data: dict) -> tuple[CheckIn, dict]:
    """Persist a check-in, re-run the baseline analysis and alert the care circle."""
    c = CheckIn(patient_id=patient.id, **data)
    db.add(c)
    db.commit()
    db.refresh(c)

    analysis = analyse(list_checkins(db, patient.id))
    if analysis["has_concern"] and not _alerted_recently(db, patient.id, c.id):
        _alert_care_circle(db, patient, analysis)
        c.drift_alerted = True
        db.commit()
    return c, analysis


def _alerted_recently(db: Session, patient_id: int, current_id: int) -> bool:
    """At most one drift alert per patient per day — no alert fatigue."""
    since = datetime.utcnow() - timedelta(hours=24)
    return (
        db.scalar(
            select(CheckIn.id).where(
                CheckIn.patient_id == patient_id,
                CheckIn.id != current_id,
                CheckIn.drift_alerted.is_(True),
                CheckIn.created_at >= since,
            )
        )
        is not None
    )


def _alert_care_circle(db: Session, patient: User, analysis: dict) -> None:
    concerns = [a for a in analysis["alerts"] if a["concerning"]]
    title = f"📈 Check-in drift: {patient.name}"
    body = (
        " ".join(a["message_en"] for a in concerns)
        + " This is a camera-based wellness estimate, not a diagnosis — worth a gentle check-in."
    )
    notification_service.notify_caregivers(db, patient.id, title, body, scope="safety")
    providers = db.scalars(select(User).where(User.role == UserRole.provider)).all()
    for p in providers:
        notification_service.notify(db, p.id, title, body, urgent=False)


def drifting_patients(db: Session) -> list[dict]:
    """Patients whose latest check-ins drift from their own baseline (provider view)."""
    out = []
    patients = db.scalars(select(User).where(User.role == UserRole.patient)).all()
    for p in patients:
        from backend.services import pallor_service  # local import avoids a cycle

        rows = list_checkins(db, p.id)
        alerts = analyse(rows)["alerts"] if rows else []
        pallor = pallor_service.analyse(pallor_service.list_readings(db, p.id))
        if pallor["alert"]:
            alerts = alerts + [pallor["alert"]]
        if alerts:
            out.append(
                {
                    "patient_id": p.id,
                    "patient_name": p.name,
                    "last_checkin": rows[-1].created_at.isoformat() if rows else None,
                    "has_concern": any(a["concerning"] for a in alerts),
                    "alerts": alerts,
                }
            )
    return out
