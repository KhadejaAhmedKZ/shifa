"""Exercise — camera-coached sessions and the AI Coach.

Pose detection runs entirely in the browser; this API only stores the session
numbers and powers the coach's replies (English or Arabic).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.ai.gemini_client import gemini
from backend.database import get_db
from backend.models import ExerciseSession
from backend.services import checkin_service, patient_service

router = APIRouter(prefix="/exercise", tags=["exercise"])

EXERCISE_NAMES = {
    "squat": ("squats", "القرفصاء"),
    "curl": ("bicep curls", "ثني الذراع"),
    "lunge": ("lunges", "الاندفاع"),
}


class SessionCreate(BaseModel):
    patient_id: int
    exercise: str = Field(pattern="^(squat|curl|lunge)$")
    reps: int = Field(ge=0, le=500)
    target_reps: int = Field(ge=0, le=500)
    duration_seconds: int = Field(ge=0, le=7200)
    form_consistency: int = Field(ge=0, le=100)
    tracking_quality: int = Field(ge=0, le=100)
    partial_reps: int = Field(default=0, ge=0, le=500)
    too_fast: int = Field(default=0, ge=0, le=500)
    side: str | None = Field(default=None, max_length=10)


class ChatTurn(BaseModel):
    role: str  # "user" | "coach"
    text: str = Field(max_length=2000)


class CoachRequest(BaseModel):
    patient_id: int
    message: str = Field(min_length=1, max_length=1000)
    lang: str = "en"
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)


def _serialize(s: ExerciseSession) -> dict:
    return {
        "id": s.id, "exercise": s.exercise, "reps": s.reps, "target_reps": s.target_reps,
        "duration_seconds": s.duration_seconds, "form_consistency": s.form_consistency,
        "tracking_quality": s.tracking_quality, "partial_reps": s.partial_reps,
        "too_fast": s.too_fast, "side": s.side, "completed_at": s.completed_at.isoformat(),
    }


def _recent(db: Session, patient_id: int, limit: int = 20) -> list[ExerciseSession]:
    return list(
        db.scalars(
            select(ExerciseSession)
            .where(ExerciseSession.patient_id == patient_id)
            .order_by(ExerciseSession.completed_at.desc())
            .limit(limit)
        ).all()
    )


@router.post("/sessions", status_code=201)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)):
    if not patient_service.get_patient(db, payload.patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    s = ExerciseSession(**payload.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return _serialize(s)


@router.get("/patients/{patient_id}/sessions")
def list_sessions(patient_id: int, db: Session = Depends(get_db)):
    if not patient_service.get_patient(db, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    return [_serialize(s) for s in _recent(db, patient_id)]


COACH_SYSTEM = """\
You are the AI Coach inside Shifa' (شفاء), a healthy-ageing companion for adults in Abu Dhabi.
You coach gentle strength and mobility exercise: squats, bicep curls, lunges, chair
sit-to-stands, shoulder rolls, walking.
Rules:
- Be warm, practical and brief: 2-5 short sentences, or a short numbered list for a plan.
- Use the person's own session numbers and check-in trend when relevant. Never invent numbers.
- Movement coaching only. Never diagnose, never advise on medication, never mention blood pressure.
- Safety first for older adults: suggest a sturdy chair or wall for support, a pain-free range,
  slow controlled reps, and rest days.
- If they mention chest pain, dizziness, fainting, severe breathlessness or a fall, tell them to
  stop exercising and contact their doctor, or call 999 if it is severe.
- No markdown headings.
"""

_RED_FLAGS = (
    "chest pain", "dizzy", "dizziness", "faint", "can't breathe", "cannot breathe", "fell", "fall",
    "ألم في الصدر", "دوخة", "دوار", "إغماء", "ضيق", "سقطت", "وقعت",
)


def _offline_reply(message: str, sessions: list[ExerciseSession], ar: bool) -> str:
    """Deterministic coach used when Gemini is offline or fails."""
    if any(flag in message.lower() for flag in _RED_FLAGS):
        return (
            "توقف عن التمرين الآن واسترح. إذا كان الألم أو الدوخة شديداً أو مستمراً اتصل بـ 999، "
            "وتحدث مع طبيبك قبل العودة للتمارين."
            if ar else
            "Please stop exercising now and rest. If the pain or dizziness is severe or does not settle, "
            "call 999 — and talk to your doctor before exercising again."
        )
    if not sessions:
        return (
            "لنبدأ بلطف: ٥ مرات قرفصاء بمساعدة كرسي ثابت، حركة بطيئة وفي نطاق مريح. "
            "أخبرني كيف شعرت بعدها وسأقترح الخطوة التالية."
            if ar else
            "Let's start gently: 5 squats holding a sturdy chair, slow and within a comfortable range. "
            "Tell me how it felt and I'll suggest the next step."
        )
    last = sessions[0]
    en, ar_name = EXERCISE_NAMES.get(last.exercise, (last.exercise, last.exercise))
    tip_en = (
        "Focus on reaching the full range on every rep before adding more."
        if last.partial_reps >= 2 else
        "Slow each rep down — about two seconds down and two seconds up."
        if last.too_fast >= 2 else
        "Nice consistency. Next time add one or two reps, keeping the same control."
    )
    tip_ar = (
        "ركّز على إكمال المدى الكامل في كل تكرار قبل زيادة العدد."
        if last.partial_reps >= 2 else
        "أبطئ كل تكرار — ثانيتان للنزول وثانيتان للصعود."
        if last.too_fast >= 2 else
        "أداء ثابت وجميل. في المرة القادمة أضف تكراراً أو اثنين بنفس التحكم."
    )
    return (
        f"في آخر جلسة أكملت {last.reps} من {last.target_reps} تكراراً في تمرين {ar_name}، "
        f"وثبات الأداء {last.form_consistency}٪. {tip_ar}"
        if ar else
        f"In your last session you did {last.reps} of {last.target_reps} {en} with a form "
        f"consistency of {last.form_consistency}%. {tip_en}"
    )


@router.post("/coach")
async def coach(payload: CoachRequest, db: Session = Depends(get_db)):
    patient = patient_service.get_patient(db, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    ar = payload.lang.lower().startswith("ar")
    sessions = _recent(db, payload.patient_id, limit=8)
    fallback = {"reply": _offline_reply(payload.message, sessions, ar), "source": "offline"}
    if not gemini.online:
        return fallback

    analysis = checkin_service.analyse(checkin_service.list_checkins(db, payload.patient_id))
    context = {
        "first_name": patient.name.split(" ")[0],
        "conditions": patient.conditions,
        "recent_exercise_sessions": [
            {k: v for k, v in _serialize(s).items() if k != "id"} for s in sessions
        ],
        "daily_checkin_changes_from_baseline": [a["message_en"] for a in analysis["alerts"]],
    }
    convo = "\n".join(f"{'Person' if t.role == 'user' else 'Coach'}: {t.text}" for t in payload.history[-8:])
    prompt = (
        f"Reply in {'simple, warm Modern Standard Arabic' if ar else 'plain English'}.\n"
        f"What you know about this person:\n{context}\n\n"
        f"Conversation so far:\n{convo or '(none)'}\n\nPerson: {payload.message}\nCoach:"
    )
    text = await gemini.generate(prompt, system_instruction=COACH_SYSTEM, temperature=0.5)
    if not text or text.startswith("[offline]") or text.startswith("I'm having trouble"):
        return fallback
    return {"reply": text, "source": "gemini"}
