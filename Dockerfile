FROM python:3.11-slim

# minimal deps for building wheels if needed
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# copy dependency manifest first for docker layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# copy application
COPY app ./app

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
