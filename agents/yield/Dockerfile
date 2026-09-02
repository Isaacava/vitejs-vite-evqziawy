FROM python:3.12-slim

WORKDIR /app

COPY agents/yield/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY agents/yield/ ./agents/yield/

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/agents/yield

CMD ["python", "-m", "uvicorn", "app.service.main:app", "--host", "0.0.0.0", "--port", "8080"]
