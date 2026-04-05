# ============================================================
# app/config.py
# Централизованные настройки проекта.
# ============================================================

from __future__ import annotations

import os
from pathlib import Path

# ============================================================
# 📁 БАЗОВЫЕ ПУТИ
# ============================================================

# Корень app/
APP_DIR = Path(__file__).resolve().parent

# Корень проекта
PROJECT_ROOT = APP_DIR.parent

# Папка frontend
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# JSON с предметами
CLEANED_ITEMS_PATH = PROJECT_ROOT / "cleaned_items.json"

# Дополнительные data-папки
DATA_DIR = PROJECT_ROOT / "data"
IMPORT_DIR = PROJECT_ROOT / "import"

# ============================================================
# 🏷️ APP META
# ============================================================

APP_TITLE = os.getenv("APP_TITLE", "D&D Trader")

# ============================================================
# 🔐 AUTH
# ============================================================

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")
)

# ============================================================
# 🧪 DEV FLAGS
# ============================================================

DEBUG = os.getenv("DEBUG", "false").lower() == "true"