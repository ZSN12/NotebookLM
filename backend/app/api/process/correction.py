import copy
import threading
import time

from app.models import Note
from app.services.term_corrector import corrector


_correction_lock = threading.Lock()
_correction_tasks = {}
_last_correction_time = {}


def correct_uncorrected_transcripts_from_data(
    session_id: str,
    course_title: str,
    keywords: list,
    transcript_data: list,
    db,
):
    """Restructure the full transcript using LLM in a background thread.

    1. Collects ALL transcript text (corrected and uncorrected)
    2. Calls LLM to: fix terms, reorder sentences, remove duplicates, merge fragments
    3. Stores the restructured result as a single clean entry
    """
    try:
        print(f"[CORRECTION] Starting full transcript restructure for session {session_id}")

        note = db.query(Note).filter(Note.session_id == session_id).first()
        if not note:
            print(f"[CORRECTION] Note not found for session {session_id}")
            return

        # Collect ALL text and timestamps from transcript
        all_texts = []
        all_timestamps = []  # Collect all timestamps for audio positioning
        for entry in transcript_data:
            text = entry.get("text", "").strip()
            if text:
                all_texts.append(text)
            ts = entry.get("timestamps", [])
            if ts:
                all_timestamps.extend(ts)

        if not all_texts:
            print(f"[CORRECTION] No text found in transcript")
            return

        full_text = "\n".join(all_texts)
        print(f"[CORRECTION] Total transcript length: {len(full_text)} chars, {len(all_texts)} segments, {len(all_timestamps)} timestamps")
        print(f"[CORRECTION] Calling DeepSeek LLM for full restructure...")

        restructured = corrector.restructure_transcript(
            text=full_text,
            course_title=course_title,
            keywords=keywords,
        )

        if not restructured or restructured == full_text:
            print(f"[CORRECTION] LLM returned same or empty text, not updating")
            return

        print(f"[CORRECTION] Restructured: {len(full_text)} → {len(restructured)} chars")

        # Replace all transcript entries with one restructured entry
        # Keep all collected timestamps for audio positioning
        note.transcript = [{
            "chunk_index": 0,
            "text": restructured,
            "timestamps": all_timestamps,  # Preserve all timestamps
            "is_corrected": True,
            "is_restructured": True,
        }]
        db.commit()
        print(f"[CORRECTION] Successfully saved restructured transcript with {len(all_timestamps)} timestamps")

    except Exception as e:
        print(f"[CORRECTION] Restructure failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        with _correction_lock:
            _correction_tasks.pop(session_id, None)


def schedule_correction(session_id: str, course_title: str, keywords: list, db):
    """Schedule a correction task based on time interval (every ~20 seconds)."""
    now = time.time()

    with _correction_lock:
        last_time = _last_correction_time.get(session_id, 0)

        # Only run correction if at least 12 seconds have passed since last run
        time_since_last = now - last_time
        print(f"[CORRECTION] Checking if correction needed: {time_since_last:.1f}s since last (need >=12s)")

        if time_since_last < 12:
            print(f"[CORRECTION] Skipping correction (too soon)")
            return

        # Don't run if already running
        if session_id in _correction_tasks:
            print(f"[CORRECTION] Task already running for session {session_id}")
            return

        print(f"[CORRECTION] Scheduling correction for session {session_id}")
        _correction_tasks[session_id] = True
        _last_correction_time[session_id] = now  # Tentatively mark timer

    # Run the correction in a separate thread to avoid blocking

    def run_correction():
        try:
            time.sleep(0.5)

            from app.core.database import SessionLocal
            from app.models import Note as NoteModel
            thread_db = SessionLocal()

            fresh_note = thread_db.query(NoteModel).filter(NoteModel.session_id == session_id).first()
            if not fresh_note or not fresh_note.transcript:
                print(f"[CORRECTION] No transcript found")
                with _correction_lock:
                    _last_correction_time[session_id] = 0  # Reset timer so next chunk can trigger
                thread_db.close()
                return

            transcript_copy = copy.deepcopy(fresh_note.transcript)

            total_text = " ".join(
                entry.get("text", "") for entry in transcript_copy if entry.get("text")
            ).strip()
            if not total_text:
                print(f"[CORRECTION] No text content found, resetting timer")
                with _correction_lock:
                    _last_correction_time[session_id] = 0
                thread_db.close()
                return

            print(f"[CORRECTION] Restructuring full transcript ({len(total_text)} chars)...")

            correct_uncorrected_transcripts_from_data(
                session_id, course_title, keywords, transcript_copy, thread_db
            )

            print(f"[CORRECTION] Correction completed, timer set for next 12s")

        except Exception as e:
            print(f"[CORRECTION] Thread correction failed: {e}")
            import traceback
            traceback.print_exc()
        finally:
            with _correction_lock:
                _correction_tasks.pop(session_id, None)
            try:
                thread_db.close()
            except:
                pass

    thread = threading.Thread(target=run_correction, daemon=True)
    thread.start()
    print(f"[CORRECTION] Correction thread started")
