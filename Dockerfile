FROM python:3.11-slim AS builder

WORKDIR /app

# Install uv (pinned version for reproducibility)
COPY --from=ghcr.io/astral-sh/uv:0.7.2 /uv /usr/local/bin/uv

# Install dependencies first (cached unless pyproject.toml/uv.lock change)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --compile-bytecode

# -------------------------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

# Copy uv and the pre-built venv from builder
COPY --from=ghcr.io/astral-sh/uv:0.7.2 /uv /usr/local/bin/uv
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/pyproject.toml /app/uv.lock ./

# Copy application code (changes here don't rebuild deps)
COPY server.py ./
COPY preprocessing.py ./
COPY static/ ./static/

# Non-root user
RUN useradd --create-home appuser
USER appuser

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/profiles')" || exit 1

CMD ["uv", "run", "--no-sync", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
