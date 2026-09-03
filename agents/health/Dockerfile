FROM python:3.12-slim

WORKDIR /app

COPY agents/health/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY agents/health/ ./agents/health/

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/agents/health
ENV PORT=8000

EXPOSE 8000

CMD ["sh", "-c", "exec python -m uvicorn app.service.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
