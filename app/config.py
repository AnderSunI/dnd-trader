# app/config.py
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ============================================================
# 🔧 БАЗОВЫЕ НАСТРОЙКИ ПРИЛОЖЕНИЯ
# ============================================================

APP_TITLE = os.getenv("APP_TITLE", "D&D Trader")

# ============================================================
# 🗄 БАЗА ДАННЫХ
# ============================================================

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://postgres:postgres@db:5432/dnd_trader"

# ============================================================
# 🔐 AUTH / JWT
# ============================================================

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# ============================================================
# 📁 ПУТИ ПРОЕКТА
# ============================================================

ROOT_DIR = Path(__file__).resolve().parent.parent

CLEANED_ITEMS_PATH = ROOT_DIR / "cleaned_items.json"
FRONTEND_DIR = ROOT_DIR / "frontend"
FRONTEND_IMAGES_DIR = FRONTEND_DIR / "images"