FROM python:3.12-slim

WORKDIR /app

# Install uv for fast package installation
RUN pip install uv

# Copy and install dependencies
COPY pyproject.toml .
RUN uv pip install --system -e .

# Copy application code
COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini .

# Copy shared agent prompts from assistants/
COPY ../assistants/.claude /app/assistants/.claude

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
