FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY agents/grid/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the grid agent application code
COPY agents/grid/app ./app

EXPOSE 8000

# Exec form (no shell) - Python reads $PORT itself via os.environ at runtime,
# so this never depends on shell/platform string interpolation of $PORT.
CMD ["python", "-c", "import os, uvicorn; uvicorn.run('app.service.main:app', host='0.0.0.0', port=int(os.environ.get('PORT', 8000)))"]
