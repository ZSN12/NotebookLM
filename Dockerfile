# ============================================
# Nootbook - Production Dockerfile
# Multi-stage build: frontend (Vite) + backend (FastAPI)
# ============================================

# ------------------ Stage 1: Build frontend ------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ------------------ Stage 2: Python backend ------------------
FROM python:3.11-slim AS backend

WORKDIR /app

# Install system dependencies for audio/image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-builder /app/dist ./static

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
