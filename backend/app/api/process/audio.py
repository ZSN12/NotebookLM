import os
import tempfile
import wave

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.schemas import NoteResponse
from app.core.auth import get_current_user
from app.models import Note, Session as DBSession, Notebook, User
from app.services.transcriber import transcriber
from app.services.term_corrector import corrector
from app.config import AUDIO_DIR

MAX_AUDIO_CHUNK_SIZE = 50 * 1024 * 1024  # 50MB
MAX_FULL_AUDIO_SIZE = 500 * 1024 * 1024  # 500MB

from app.api.process.correction import schedule_correction

router = APIRouter()


def concatenate_wav_files(wav_paths: list[str], output_path: str) -> None:
    """Concatenate multiple WAV files into a single WAV file.

    Streams data in chunks instead of loading all WAV data into memory.
    """
    if not wav_paths:
        return

    # Read header from first file
    try:
        with wave.open(wav_paths[0], 'rb') as wf:
            sample_rate = wf.getframerate()
            num_channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            total_frames = 0
            for path in wav_paths:
                try:
                    with wave.open(path, 'rb') as pf:
                        total_frames += pf.getnframes()
                except Exception:
                    pass
    except Exception as e:
        print(f"[ERROR] Failed to read WAV header: {e}")
        return

    if total_frames == 0:
        return

    # Write output, streaming each file's data frame-by-frame
    CHUNK_FRAMES = 4096
    with wave.open(output_path, 'wb') as out_wf:
        out_wf.setnchannels(num_channels)
        out_wf.setsampwidth(sample_width)
        out_wf.setframerate(sample_rate)
        for path in wav_paths:
            try:
                with wave.open(path, 'rb') as in_wf:
                    while True:
                        data = in_wf.readframes(CHUNK_FRAMES)
                        if not data:
                            break
                        out_wf.writeframes(data)
            except Exception as e:
                print(f"[WARN] Failed to read WAV file {path}: {e}")


@router.post("/audio-stream")
async def stream_audio_process(
    file: UploadFile = File(...),
    session_id: str = "",
    chunk_index: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Process an audio chunk: transcribe + save + schedule async correction.

    Args:
        file: Audio chunk (webm format from browser).
        session_id: The session ID to save the result to.
        chunk_index: Which chunk this is (for ordering).
    """
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    print(f"[INFO] stream_audio_process called with session_id: {session_id}")

    # Verify session exists and belongs to user
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        print(f"[ERROR] Session {session_id} not found for user {current_user.id}")
        raise HTTPException(status_code=404, detail="Session not found")

    # Get course context
    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    course_title = notebook.title if notebook else ""
    keywords = session.keywords or []
    print(f"[INFO] Course: {course_title}, Keywords: {keywords}")

    # Save audio chunk temporarily for transcription
    # Pre-check: read size without reading full content
    audio_bytes = await file.read()
    file_size = len(audio_bytes)
    if file_size > MAX_AUDIO_CHUNK_SIZE:
        raise HTTPException(status_code=413, detail=f"Chunk too large: {file_size} bytes (max {MAX_AUDIO_CHUNK_SIZE} bytes)")

    print(f"[INFO] Audio chunk received, size: {file_size} bytes")

    # Save chunk to session audio dir for later concatenation
    chunk_dir = AUDIO_DIR / session_id
    chunk_dir.mkdir(parents=True, exist_ok=True)
    chunk_path = chunk_dir / f"chunk_{chunk_index:04d}.wav"
    with open(chunk_path, 'wb') as f:
        f.write(audio_bytes)

    # Save wav to temp file for transcription
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        f.flush()
        audio_path = f.name
        print(f"[INFO] Saved audio to: {audio_path}")

    try:
        # Step 1: Transcribe with FunASR
        print(f"[INFO] Transcribing {audio_path}")
        try:
            segments = transcriber.transcribe(audio_path)
        except Exception as transcribe_error:
            print(f"[ERROR] FunASR transcribe_error: {transcribe_error}")
            import traceback
            traceback.print_exc()
            segments = []

        if not segments:
            print(f"[WARN] Transcription returned no segments, returning empty")
            result = {
                "chunk_index": chunk_index,
                "original": "",
                "corrected": "",
                "timestamps": [],
                "course_title": course_title,
            }
        else:
            # Deduplicate consecutive identical segments
            deduplicated = []
            for seg in segments:
                if not deduplicated or seg.text.strip() != deduplicated[-1].text.strip():
                    deduplicated.append(seg)
            segments = deduplicated
            print(f"[INFO] Transcription result: {[s.text for s in segments]}")

            # Step 2: Use raw text for immediate response (correction happens asynchronously)
            raw_text = " ".join(seg.text for seg in segments)

            result = {
                "chunk_index": chunk_index,
                "original": raw_text,
                "corrected": raw_text,  # Initially same as original, will be corrected later
                "timestamps": [seg.to_dict() for seg in segments],
                "course_title": course_title,
            }

            # Step 3: Save to database (with is_corrected=False flag)
            existing_note = db.query(Note).filter(Note.session_id == session_id).first()
            transcript_entry = {
                "chunk_index": chunk_index,
                "text": raw_text,
                "timestamps": [seg.to_dict() for seg in segments],
                "is_corrected": False,  # Mark as not yet corrected
            }

            try:
                if not existing_note:
                    note = Note(
                        session_id=session_id,
                        content="",
                        transcript=[transcript_entry],
                        ppt_images=[],
                        vocabulary=[],
                    )
                    db.add(note)
                else:
                    current_transcript = existing_note.transcript or []
                    current_transcript.append(transcript_entry)
                    existing_note.transcript = current_transcript
                db.commit()
                print(f"[INFO] Saved to database with is_corrected=False")
            except Exception as db_error:
                db.rollback()
                print(f"[ERROR] DB save error: {db_error}")
                import traceback
                traceback.print_exc()

            # Step 4: Schedule async correction every ~20 seconds
            print(f"[INFO] About to call schedule_correction")
            schedule_correction(session_id, course_title, keywords, db)

        # Step 5: Return JSON response
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Unexpected error in stream_audio_process: {e}")
        import traceback
        traceback.print_exc()
        # Return empty result instead of 500 to keep streaming alive
        result = {
            "chunk_index": chunk_index,
            "original": "",
            "corrected": "",
            "timestamps": [],
            "course_title": course_title,
            "error": str(e),
        }
        return result
    finally:
        try:
            if os.path.exists(audio_path):
                os.unlink(audio_path)
        except:
            pass


@router.post("/audio-finish")
def finish_recording(
    session_id: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Called when recording stops. Concatenates all saved chunks into a single WAV file and does final correction."""
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get course context for final correction
    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    course_title = notebook.title if notebook else ""
    keywords = session.keywords or []

    chunk_dir = AUDIO_DIR / session_id
    if not chunk_dir.exists():
        return {"status": "no_audio", "audio_path": None}

    chunk_files = sorted(chunk_dir.glob("chunk_*.wav"))
    if not chunk_files:
        return {"status": "no_chunks", "audio_path": None}

    output_path = AUDIO_DIR / f"{session_id}.wav"
    try:
        concatenate_wav_files([str(p) for p in chunk_files], str(output_path))
        # Clean up individual chunks
        for chunk_file in chunk_files:
            try:
                chunk_file.unlink()
            except Exception:
                pass
        try:
            chunk_dir.rmdir()
        except Exception:
            pass

        # Schedule final correction for all remaining uncorrected text
        schedule_correction(session_id, course_title, keywords, db)

        return {"status": "success", "audio_path": str(output_path)}
    except Exception as e:
        print(f"[ERROR] Failed to concatenate audio: {e}")
        return {"status": "error", "audio_path": None}


@router.delete("/audio")
def delete_audio(
    session_id: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the recorded audio file for a session."""
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    deleted = []
    # Full recording
    full_path = AUDIO_DIR / f"{session_id}.wav"
    if full_path.exists():
        full_path.unlink()
        deleted.append(str(full_path))

    # Remaining chunk dir
    chunk_dir = AUDIO_DIR / session_id
    if chunk_dir.exists():
        for f in chunk_dir.glob("chunk_*.wav"):
            try:
                f.unlink()
                deleted.append(str(f))
            except Exception:
                pass
        try:
            chunk_dir.rmdir()
        except Exception:
            pass

    print(f"[INFO] Deleted {len(deleted)} audio files for session {session_id}")
    return {"status": "deleted", "files": len(deleted)}


@router.post("/audio-batch", response_model=NoteResponse)
async def process_audio_batch(
    file: UploadFile = File(...),
    session_id: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Process entire audio file at once (non-streaming fallback)."""
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    # Verify session exists and belongs to user
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    course_title = notebook.title if notebook else ""
    keywords = session.keywords or []

    # Pre-check: avoid reading full file into memory
    audio_bytes = await file.read()
    file_size = len(audio_bytes)
    if file_size > MAX_FULL_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large: {file_size} bytes (max {MAX_FULL_AUDIO_SIZE} bytes)")
    file_ext = os.path.splitext(file.filename or ".webm")[1] or ".webm"

    with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as f:
        f.write(audio_bytes)
        f.flush()
        temp_path = f.name

    try:
        segments = transcriber.transcribe(temp_path)
        if not segments:
            raise HTTPException(status_code=500, detail="Transcription failed")

        raw_text = " ".join(seg.text for seg in segments)

        corrected_text = corrector.restructure_transcript(
            text=raw_text,
            course_title=course_title,
            keywords=keywords,
        )
        if not corrected_text:
            corrected_text = raw_text

        transcript_data = [{"chunk_index": 0, "text": corrected_text, "timestamps": [seg.to_dict() for seg in segments], "is_corrected": True, "is_restructured": True}]

        note = Note(
            session_id=session_id,
            content=corrected_text,
            transcript=transcript_data,
            ppt_images=[],
            vocabulary=[],
        )
        db.add(note)
        db.commit()
        db.refresh(note)

        return note

    finally:
        os.unlink(temp_path)
