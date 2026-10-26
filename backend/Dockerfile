# Build from the SHIELD/ directory so the dashboard is included:
#   docker build -f backend/Dockerfile -t shield-api .
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SHIELD_DB_PATH=/data/shield.db \
    SHIELD_EVIDENCE_DIR=/data/evidence

WORKDIR /srv/shield

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ backend/
COPY dashboard/ dashboard/

# Run as an unprivileged user; /data is the only writable path
RUN useradd --system --uid 10001 shield \
    && mkdir -p /data/evidence \
    && chown -R shield:shield /data
USER shield
VOLUME ["/data"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/ready').status==200 else 1)"

# One worker: the live-location broker is in-process (see docs/ROADMAP.md before scaling out)
CMD ["uvicorn", "main:app", "--app-dir", "backend/api", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
