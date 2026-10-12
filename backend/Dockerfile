FROM python:3.14-rc-slim AS build

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock* .python-version ./
RUN uv sync --no-install-project
COPY src/ ./src/
RUN uv sync

FROM python:3.14-rc-slim AS production

WORKDIR /app

COPY --from=build /app/.venv ./.venv
COPY --from=build /app/src ./src
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["python", "-m", "backend"]
