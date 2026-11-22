"""Eyelid colour (pallor) check — personal baseline and drift alerts.

The score is relative (eyelid redness minus the person's own cheek redness),
so it is only compared with the SAME person's earlier readings. A drop means
"paler than your usual" and prompts a simple blood test — never a diagnosis.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from statistics import mean, median

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import PallorReading, User, UserRole
from backend.services import notification_service

MIN_READINGS = 3        # readings needed before we trust a baseline
RECENT_N = 2            # "recent" = mean of the last N readings
MIN_QUALITY = 0.6
WINDOW_DAYS = 90        # pallor changes slowly — look back ~3 months
ABS_DROP = 4.0          # a* units
REL_DROP = 0.2          # or 20% of the baseline contrast, whichever is larger


def serialize(r: PallorReading) -> dict:
    return {
        "id": r.id, "created_at": r.created_at.isoformat(),
        "eyelid_index": r.eyelid_index, "skin_index": r.skin_index,
        "relative_index": r.relative_index, "quality": r.quality, "source": r.source,
    }


def list_readings(db: Session, patient_id: int, limit: int = 60) -> list[PallorReading]:
    rows = db.scalars(
        select(PallorReading)
        .where(PallorReading.patient_id == patient_id)
        .order_by(PallorReading.created_at.desc())
        .limit(limit)
    ).all()
    return list(reversed(rows))


def analyse(readings: list[PallorReading], now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    pts = [
        r for r in readings
        if r.quality >= MIN_QUALITY and r.created_at >= now - timedelta(days=WINDOW_DAYS)
    ]
    if len(pts) < MIN_READINGS:
        return {"ready": False, "count": len(pts), "needed": MIN_READINGS, "alert": None, "has_concern": False}

    base_pts = pts[:-RECENT_N] or pts[:1]
    baseline = median(r.relative_index for r in base_pts)
    recent = mean(r.relative_index for r in pts[-RECENT_N:])
    delta = recent - baseline
    threshold = max(ABS_DROP, REL_DROP * abs(baseline))
    direction = "paler" if delta <= -threshold else "redder" if delta >= threshold else "steady"
    days = max(1, round((pts[-1].created_at - base_pts[0].created_at).total_seconds() / 86400))

    alert = None
    if direction == "paler":
        alert = {
            "metric": "eyelid_colour",
            "concerning": True,
            "message_en": (
                f"Inner-eyelid colour looks paler than this person's usual "
                f"(score {recent:.0f} vs baseline {baseline:.0f}, over {days} days). "
                "Worth asking a doctor about a simple blood test (CBC)."
            ),
            "message_ar": (
                f"لون باطن الجفن يبدو أفتح من المعتاد (الدرجة {recent:.0f} مقابل المعدل {baseline:.0f} "
                f"خلال {days} يوماً). من المفيد سؤال الطبيب عن تحليل دم بسيط (CBC)."
            ),
        }
    return {
        "ready": True, "count": len(pts),
        "baseline": round(baseline, 1), "recent": round(recent, 1), "delta": round(delta, 1),
        "direction": direction, "alert": alert, "has_concern": alert is not None,
    }


def save(db: Session, patient: User, data: dict) -> tuple[PallorReading, dict]:
    r = PallorReading(patient_id=patient.id, **data)
    db.add(r)
    db.commit()
    db.refresh(r)
    analysis = analyse(list_readings(db, patient.id))
    if analysis["has_concern"] and not _alerted_recently(db, patient.id, r.id):
        title = f"👁️ Eyelid colour change: {patient.name}"
        body = analysis["alert"]["message_en"] + " Camera-based wellness check, not a diagnosis."
        notification_service.notify_caregivers(db, patient.id, title, body, scope="safety")
        for p in db.scalars(select(User).where(User.role == UserRole.provider)).all():
            notification_service.notify(db, p.id, title, body, urgent=False)
        r.drift_alerted = True
        db.commit()
    return r, analysis


def _alerted_recently(db: Session, patient_id: int, current_id: int) -> bool:
    since = datetime.utcnow() - timedelta(days=7)  # slow-moving signal → at most weekly
    return db.scalar(
        select(PallorReading.id).where(
            PallorReading.patient_id == patient_id,
            PallorReading.id != current_id,
            PallorReading.drift_alerted.is_(True),
            PallorReading.created_at >= since,
        )
    ) is not None
