FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY agents/grid/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the grid agent application code
COPY agents/grid/app ./app

# Railway injects $PORT at runtime
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn app.service.main:app --host 0.0.0.0 --port ${PORT}"]
