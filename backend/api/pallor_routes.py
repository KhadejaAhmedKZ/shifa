"""Eyelid colour check API — stores numbers only and returns the baseline analysis."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services import pallor_service, patient_service

router = APIRouter(prefix="/pallor", tags=["pallor"])


class PallorCreate(BaseModel):
    patient_id: int
    eyelid_index: float = Field(ge=-60, le=90)
    skin_index: float = Field(ge=-60, le=90)
    relative_index: float = Field(ge=-80, le=80)
    quality: float = Field(ge=0, le=1)
    source: str = Field(default="camera", pattern="^(camera|demo)$")


@router.post("", status_code=201)
def create(payload: PallorCreate, db: Session = Depends(get_db)):
    patient = patient_service.get_patient(db, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if payload.quality < pallor_service.MIN_QUALITY:
        raise HTTPException(status_code=422, detail="Reading quality too low — please retake the photo")
    r, analysis = pallor_service.save(db, patient, payload.model_dump(exclude={"patient_id"}))
    return {"reading": pallor_service.serialize(r), "analysis": analysis}


@router.get("/patients/{patient_id}")
def history(patient_id: int, db: Session = Depends(get_db)):
    if not patient_service.get_patient(db, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    rows = pallor_service.list_readings(db, patient_id)
    return {"readings": [pallor_service.serialize(r) for r in rows], "analysis": pallor_service.analyse(rows)}
