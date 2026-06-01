from fastapi import APIRouter

from app.api.process.audio import router as audio_router
from app.api.process.correction import schedule_correction, _correction_lock, _correction_tasks, _last_correction_time
from app.api.process.ppt import router as ppt_router
from app.api.process.transcript import router as transcript_router

router = APIRouter(prefix="/api/process", tags=["process"])

router.include_router(audio_router)
router.include_router(ppt_router)
router.include_router(transcript_router)

__all__ = [
    "router",
    "schedule_correction",
    "_correction_lock",
    "_correction_tasks",
    "_last_correction_time",
]
