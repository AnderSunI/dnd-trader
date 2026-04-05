# app/database.py
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import DATABASE_URL

# ============================================================
# 🔧 НАСТРОЙКА БАЗЫ ДАННЫХ
# ============================================================

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# ============================================================
# 🔌 DEPENDENCY ДЛЯ FASTAPI
# ============================================================

def get_db():
    """
    Отдаёт сессию БД для FastAPI dependency injection.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()