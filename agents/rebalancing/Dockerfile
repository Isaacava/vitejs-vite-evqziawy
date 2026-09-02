FROM python:3.12-slim

WORKDIR /app

COPY agents/rebalancing/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY agents/rebalancing/ ./agents/rebalancing/

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/agents/rebalancing

CMD ["python", "-m", "uvicorn", "app.service.main:app", "--host", "0.0.0.0", "--port", "8080"]
