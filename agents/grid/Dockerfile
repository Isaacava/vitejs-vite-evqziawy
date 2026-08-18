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

# Use the absolute interpreter path so the container does not depend on PATH resolution.
CMD ["sh", "-c", "/usr/local/bin/python3 -m uvicorn app.service.main:app --host 0.0.0.0 --port ${PORT}"]
