FROM python:3.11-slim

WORKDIR /app

COPY agents/grid/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY agents/grid/app ./app

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn app.service.main:app --host 0.0.0.0 --port ${PORT}"]
