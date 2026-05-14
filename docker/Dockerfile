FROM python:3.12-slim

# Instalar dependencias del sistema para Playwright y PostgreSQL
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Instalar Playwright y Chromium
RUN playwright install chromium
RUN playwright install-deps chromium

# Copiar código
COPY . .

# __init__.py necesarios
RUN find app -type d -exec touch {}/__init__.py \;

EXPOSE 8000
