# Multi-stage Dockerfile for NadiTwin Project

# Stage 1: Development/Build stage with all dependencies
FROM python:3.11-slim as dev-stage

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all source code
COPY . .

# Stage 2: Production stage - minimal runtime
FROM python:3.11-slim as production

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy only the necessary application files from dev stage
COPY --from=dev-stage --chown=appuser:appuser /app/naditwin ./naditwin
COPY --from=dev-stage --chown=appuser:appuser /app/run.py .
COPY --from=dev-stage --chown=appuser:appuser /app/data ./data

# Set proper permissions
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port 8080 (Railway will override with PORT env var)
EXPOSE 8080

# Health check (Railway compatible)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request, os; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\", 8080)}/api/rivers')"

# Default command - Railway will use PORT env variable
CMD ["python", "run.py", "--no-browser"]

# Stage 3: Development tools stage (optional - for data processing)
FROM dev-stage as dev-tools

# This stage includes all the development dependencies needed for:
# - extract_centerline_mula_mutha.py
# - extract_centerline_mithi.py  
# - reverse_and_tag_landmarks_mula_mutha.py
# - tag_mithi_landmarks.py
# - build_depth_profile_mula_mutha.py

# Copy development scripts
COPY extract_centerline_*.py .
COPY reverse_and_tag_landmarks_*.py .
COPY tag_mithi_landmarks.py .
COPY build_depth_profile_*.py .

# Set entrypoint for development work
ENTRYPOINT ["python"]