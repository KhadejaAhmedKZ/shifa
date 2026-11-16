"""Daily Check-in API.

* ``/checkin/vitallens/*`` — a thin proxy to the VitalLens API. The browser
  never sees ``VITALLENS_API_KEY``; we add it server-side. Frames are relayed
  in memory and never written to disk.
* ``/checkin`` — store a check-in result (numbers only) and analyse it against
  the person's own baseline.
* ``/checkin/{id}/explain`` — the companion explains the result in plain
  English or Arabic and suggests one habit for the week.
"""
from __future__ import annotations

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.ai.gemini_client import gemini
from backend.config import settings
from backend.database import get_db
from backend.models import CheckIn
from backend.services import checkin_service, patient_service

router = APIRouter(prefix="/checkin", tags=["checkin"])

_PLACEHOLDER_KEYS = {"", "your_vitallens_api_key_here"}
# vitallens.js sends its frame metadata as X-* request headers; we relay those
# (plus the content type) and drop everything else (cookies, auth, hop-by-hop).
_NEVER_FORWARD = ("x-api-key", "x-forwarded-", "x-real-ip")


def _forwardable(name: str) -> bool:
    n = name.lower()
    if n == "content-type":
        return True
    return n.startswith("x-") and not n.startswith(_NEVER_FORWARD)


def _vitallens_key() -> str:
    key = (settings.vitallens_api_key or "").strip()
    return "" if key in _PLACEHOLDER_KEYS else key


# ---------- Config ----------
@router.get("/config")
def config():
    return {
        "vitallens": bool(_vitallens_key()),
        "fallback": "pos",
        "min_confidence": checkin_service.MIN_CONFIDENCE,
    }


# ---------- VitalLens proxy ----------
async def _relay(method: str, path: str, request: Request) -> Response:
    key = _vitallens_key()
    if not key:
        raise HTTPException(status_code=503, detail="VITALLENS_API_KEY is not configured")
    headers = {k: v for k, v in request.headers.items() if _forwardable(k)}
    headers["x-api-key"] = key
    body = await request.body() if method == "POST" else None
    url = f"{settings.vitallens_api_base.rstrip('/')}/{path}"

    def call():
        return requests.request(
            method, url, headers=headers, data=body,
            params=dict(request.query_params), timeout=30,
        )

    try:
        upstream = await run_in_threadpool(call)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"VitalLens unreachable: {exc.__class__.__name__}")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


@router.get("/vitallens/resolve-model")
async def vl_resolve_model(request: Request):
    return await _relay("GET", "resolve-model", request)


@router.post("/vitallens/stream")
async def vl_stream(request: Request):
    return await _relay("POST", "stream", request)


@router.post("/vitallens/file")
async def vl_file(request: Request):
    return await _relay("POST", "file", request)


# ---------- Check-ins ----------
class CheckInCreate(BaseModel):
    patient_id: int
    heart_rate: float | None = Field(default=None, ge=25, le=240)
    heart_rate_conf: float | None = Field(default=None, ge=0, le=1)
    respiratory_rate: float | None = Field(default=None, ge=3, le=60)
    respiratory_rate_conf: float | None = Field(default=None, ge=0, le=1)
    hrv_sdnn: float | None = Field(default=None, ge=0, le=400)
    hrv_conf: float | None = Field(default=None, ge=0, le=1)
    source: str = Field(default="vitallens", max_length=40)
    posture_score: int | None = Field(default=None, ge=0, le=100)
    sit_to_stand_reps: int | None = Field(default=None, ge=0, le=200)
    shoulder_roll_reps: int | None = Field(default=None, ge=0, le=200)


class MovementUpdate(BaseModel):
    posture_score: int | None = Field(default=None, ge=0, le=100)
    sit_to_stand_reps: int | None = Field(default=None, ge=0, le=200)
    shoulder_roll_reps: int | None = Field(default=None, ge=0, le=200)


class ExplainRequest(BaseModel):
    lang: str = "en"  # "en" | "ar"


@router.post("", status_code=201)
def create_checkin(payload: CheckInCreate, db: Session = Depends(get_db)):
    patient = patient_service.get_patient(db, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    data = payload.model_dump(exclude={"patient_id"})
    c, analysis = checkin_service.save_checkin(db, patient, data)
    return {"checkin": checkin_service.serialize(c), "analysis": analysis}


@router.post("/{checkin_id}/movement")
def add_movement(checkin_id: int, payload: MovementUpdate, db: Session = Depends(get_db)):
    """Attach the posture / guided-move summary to an existing check-in."""
    c = db.get(CheckIn, checkin_id)
    if not c:
        raise HTTPException(status_code=404, detail="Check-in not found")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return checkin_service.serialize(c)


@router.get("/patients/{patient_id}")
def history(patient_id: int, db: Session = Depends(get_db)):
    if not patient_service.get_patient(db, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    rows = checkin_service.list_checkins(db, patient_id)
    return {
        "checkins": [checkin_service.serialize(r) for r in rows],
        "analysis": checkin_service.analyse(rows),
    }


@router.get("/drift")
def drift(db: Session = Depends(get_db)):
    """Provider view: every patient currently drifting from their baseline."""
    return checkin_service.drifting_patients(db)


# ---------- Companion explanation ----------
EXPLAIN_SYSTEM = """\
You are Shifa' (شفاء), a warm wellness companion for older adults in Abu Dhabi.
You explain a camera-based Daily Check-in in very plain language.
Rules:
- These are wellness ESTIMATES from a camera, not medical measurements. Never diagnose,
  never name a disease, never mention blood pressure, never change medication.
- Compare the person only with THEIR OWN baseline, not with population norms.
- Be calm and encouraging. If something drifted, say it is worth watching and that
  their care team can see the trend; suggest talking to their doctor if it continues
  or if they feel unwell.
- Short sentences. No jargon. No markdown headings.
Reply ONLY with JSON: {"explanation": "<3-5 short sentences>", "habit": "<ONE small, specific healthy habit for this week>"}
"""

HABITS = {
    "heart_rate": (
        "This week: a relaxed 10-minute walk after dinner each day, and a glass of water with every meal.",
        "هذا الأسبوع: مشي هادئ لمدة ١٠ دقائق بعد العشاء كل يوم، وكوب ماء مع كل وجبة.",
    ),
    "respiratory_rate": (
        "This week: two minutes of slow breathing every morning — in through the nose for 4, out for 6.",
        "هذا الأسبوع: دقيقتان من التنفس البطيء كل صباح — شهيق من الأنف ٤ عدّات وزفير ٦ عدّات.",
    ),
    "hrv_sdnn": (
        "This week: aim for the same bedtime every night and switch screens off 30 minutes before.",
        "هذا الأسبوع: حاول النوم في نفس الموعد كل ليلة وأطفئ الشاشات قبل النوم بثلاثين دقيقة.",
    ),
    "posture": (
        "This week: stand up and roll your shoulders five times every time you finish a cup of tea or coffee.",
        "هذا الأسبوع: قف وحرّك كتفيك خمس مرات في كل مرة تنهي فيها كوب الشاي أو القهوة.",
    ),
    "default": (
        "This week: do your Daily Check-in at the same time each morning, then five chair sit-to-stands.",
        "هذا الأسبوع: قم بالفحص اليومي في نفس الوقت كل صباح، ثم خمس مرات جلوس ووقوف من الكرسي.",
    ),
}


def _offline_explanation(c: CheckIn, analysis: dict, ar: bool) -> dict:
    """Deterministic explanation used when Gemini is offline or fails."""
    parts: list[str] = []
    if c.heart_rate is not None:
        parts.append(
            f"معدل نبض قلبك التقديري اليوم حوالي {c.heart_rate:.0f} نبضة في الدقيقة."
            if ar else f"Your estimated heart rate today is about {c.heart_rate:.0f} beats per minute."
        )
    if c.respiratory_rate is not None:
        parts.append(
            f"ومعدل تنفسك حوالي {c.respiratory_rate:.0f} نفساً في الدقيقة."
            if ar else f"Your breathing rate is about {c.respiratory_rate:.0f} breaths per minute."
        )
    if c.posture_score is not None:
        parts.append(
            f"كانت جلستك مستقيمة {c.posture_score}٪ من الوقت."
            if ar else f"You sat upright {c.posture_score}% of the time."
        )

    alerts = analysis.get("alerts", [])
    if alerts:
        parts.extend(a["message_ar" if ar else "message_en"] for a in alerts)
        if analysis.get("has_concern"):
            parts.append(
                "هذا ليس تشخيصاً، لكنه يستحق المتابعة. فريق رعايتك يستطيع رؤية هذا التغيّر، "
                "وإذا استمر أو شعرت بتعب فتحدّث مع طبيبك."
                if ar else
                "This is not a diagnosis, but it is worth watching. Your care team can see this trend — "
                "if it continues, or you feel unwell, talk to your doctor."
            )
    elif analysis.get("ready"):
        parts.append(
            "قراءاتك قريبة من معدلك المعتاد. أحسنت، استمر."
            if ar else "Your readings are close to your own usual baseline. Well done — keep it up."
        )
    else:
        parts.append(
            "ما زلنا نتعرّف على معدلك المعتاد. بعد بضعة فحوصات يومية سنخبرك بأي تغيّر."
            if ar else
            "We are still learning your usual baseline. After a few more daily check-ins we can tell you about changes."
        )

    concern = next((a["metric"] for a in alerts if a["concerning"]), None)
    if not concern and c.posture_score is not None and c.posture_score < 70:
        concern = "posture"
    habit = HABITS.get(concern or "default", HABITS["default"])[1 if ar else 0]
    return {"explanation": " ".join(parts), "habit": habit, "source": "offline"}


@router.post("/{checkin_id}/explain")
async def explain(checkin_id: int, payload: ExplainRequest, db: Session = Depends(get_db)):
    c = db.get(CheckIn, checkin_id)
    if not c:
        raise HTTPException(status_code=404, detail="Check-in not found")
    patient = patient_service.get_patient(db, c.patient_id)
    ar = payload.lang.lower().startswith("ar")
    analysis = checkin_service.analyse(checkin_service.list_checkins(db, c.patient_id))
    fallback = _offline_explanation(c, analysis, ar)

    if not gemini.online:
        return fallback

    facts = {
        "first_name": (patient.name.split(" ")[0] if patient else ""),
        "today": {
            "heart_rate_bpm": c.heart_rate,
            "heart_rate_confidence": c.heart_rate_conf,
            "breathing_rate_per_min": c.respiratory_rate,
            "breathing_confidence": c.respiratory_rate_conf,
            "hrv_sdnn_ms": c.hrv_sdnn,
            "posture_percent_upright": c.posture_score,
            "sit_to_stand_reps": c.sit_to_stand_reps,
            "shoulder_roll_reps": c.shoulder_roll_reps,
        },
        "personal_baseline": {
            k: {f: m.get(f) for f in ("baseline", "recent", "delta", "direction", "trend_14d_change", "unit")}
            for k, m in analysis["metrics"].items() if m.get("ready")
        },
        "changes_from_baseline": [a["message_en"] for a in analysis["alerts"]],
    }
    prompt = (
        f"Reply in {'Modern Standard Arabic (simple, warm)' if ar else 'plain English'}.\n"
        f"Check-in facts (null means not measured):\n{facts}"
    )
    data = await gemini.generate_json(prompt, system_instruction=EXPLAIN_SYSTEM, temperature=0.4)
    if isinstance(data, dict) and data.get("explanation") and data.get("habit"):
        return {"explanation": str(data["explanation"]), "habit": str(data["habit"]), "source": "gemini"}
    return fallback
