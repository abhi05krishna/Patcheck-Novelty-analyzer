FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./

# libgomp1 is required at RUNTIME by faiss-cpu (OpenMP) — separate from
# the build-time tools below. Missing this causes a crash on startup,
# not a build failure, so it's easy to miss until you actually deploy.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_DEFAULT_TIMEOUT=1000
ENV PIP_NO_CACHE_DIR=1

RUN set -eux; \
    for i in 1 2 3 4 5; do \
      pip install -r requirements.txt && break || (echo "pip install failed, retrying... ($i/5)" && sleep 5); \
    done

COPY . .

# Bakes your already-built FAISS index directly into the image, so it
# survives a deploy regardless of the platform's storage behavior.
# Any papers added after this build require a fresh image rebuild.
COPY data/faiss_index ./data/faiss_index

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]