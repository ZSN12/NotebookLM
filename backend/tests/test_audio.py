import requests
import wave
import io
import os
import sys

API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8003")


def create_test_audio(duration_ms: int = 100) -> io.BytesIO:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b'\x00' * (16 * duration_ms))
    buf.seek(0)
    return buf


def get_access_token() -> str | None:
    resp = requests.post(
        f"{API_BASE}/api/auth/login",
        json={"email": "admin", "password": "admin123"},
        timeout=5,
    )
    if resp.status_code == 200:
        return resp.json().get("access_token")
    return None


def create_session(access_token: str) -> str | None:
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.post(
        f"{API_BASE}/api/notebooks",
        headers=headers,
        json={"title": "Test Notebook"},
        timeout=5,
    )
    if resp.status_code != 201:
        return None
    notebook_id = resp.json().get("id")

    resp = requests.post(
        f"{API_BASE}/api/sessions",
        headers=headers,
        params={"notebook_id": notebook_id},
        json={"title": "Test Session"},
        timeout=5,
    )
    if resp.status_code != 201:
        return None
    return resp.json().get("id")


def test_health():
    resp = requests.get(f"{API_BASE}/api/health", timeout=10)
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"
    print(f"OK: Health check passed")
    return True


def test_login():
    resp = requests.post(
        f"{API_BASE}/api/auth/login",
        json={"email": "admin", "password": "admin123"},
        timeout=5,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    print(f"OK: Login successful, token_type={data.get('token_type')}")
    return True


def test_audio_stream():
    access_token = get_access_token()
    if not access_token:
        print("FAIL: Could not obtain access token")
        return False

    session_id = create_session(access_token)
    if not session_id:
        print("FAIL: Could not create test session")
        return False

    headers = {"Authorization": f"Bearer {access_token}"}
    files = {"file": ("test.webm", create_test_audio(), "audio/webm")}
    params = {"session_id": session_id, "chunk_index": 0}

    resp = requests.post(
        f"{API_BASE}/api/process/audio-stream",
        params=params,
        files=files,
        headers=headers,
        timeout=30,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert "text" in data, "Response missing 'text' field"
    print(f"OK: {resp.status_code} - text='{data.get('text', '')[:50]}'")
    return True


if __name__ == "__main__":
    results = []
    print("=== Running API Tests ===\n")

    print("[1/3] Health Check:")
    try:
        results.append(test_health())
    except Exception as e:
        print(f"FAIL: {e}")
        results.append(False)

    print("\n[2/3] Login:")
    try:
        results.append(test_login())
    except Exception as e:
        print(f"FAIL: {e}")
        results.append(False)

    print("\n[3/3] Audio Stream:")
    try:
        results.append(test_audio_stream())
    except requests.exceptions.ConnectionError:
        print("SKIP: Backend not running")
        results.append(False)
    except Exception as e:
        print(f"FAIL: {e}")
        results.append(False)

    passed = sum(results)
    total = len(results)
    print(f"\n{'='*30}")
    print(f"Results: {passed}/{total} passed")
    sys.exit(0 if passed == total else 1)
