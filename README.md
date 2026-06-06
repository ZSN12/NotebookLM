# Nootbook

AI-assisted course notebook for recording lectures, transcribing audio, aligning PPT slides, searching course content, sharing sessions, and generating knowledge mind maps.

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: FastAPI, SQLAlchemy, SQLite by default
- AI/audio: FunASR, OpenAI-compatible DeepSeek API, local lightweight vector search

## Quick Start

Install frontend dependencies:

```bash
npm install
```

Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file for backend settings as needed:

```bash
SECRET_KEY=replace-with-at-least-32-characters
ADMIN_DEFAULT_EMAIL=admin
ADMIN_DEFAULT_PASSWORD=admin123
DATABASE_URL=sqlite:///./nootbook.db
DEEPSEEK_API_KEY=your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

Run the backend:

```bash
cd backend
uvicorn app.main:app --reload
```

Run the frontend in another terminal:

```bash
npm run dev
```

## Useful Commands

Frontend checks:

```bash
npm run build
npm run check
npm run lint
```

Backend tests:

```bash
python -m pytest backend/tests
```

On this Windows workspace, use the installed Python 3.10 directly if the WindowsApps Python launcher is first on `PATH`:

```bash
C:\Users\root\AppData\Local\Programs\Python\Python310\python.exe -m pytest backend/tests
```

## Common Issues

- Mind map generation stays in progress: confirm `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and network access. The API is asynchronous, so the frontend polls until `ready` or `error`.
- Audio upload fails: confirm microphone permission, file size limits, and that FFmpeg or pydub can convert uploaded audio formats.
- PPT upload fails: confirm the uploaded file is a valid `.pptx` and backend dependencies are installed.
- Search returns no results: rebuild the vector index for the session after editing transcript, notes, or PPT content.
- Login fails in local tests: the app creates the default admin user from `ADMIN_DEFAULT_EMAIL` and `ADMIN_DEFAULT_PASSWORD` during startup.

## Notes

- Generated media is stored under backend asset directories configured in `app.config`.
- Knowledge mind maps are stored inside the note vocabulary JSON as `kind="mind_map"`.
- Vector search is local and lightweight; it does not require an external vector database.
