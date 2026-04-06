from __future__ import annotations  # Эта строка должна быть первой

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ============================================================
# ⚙️ DATABASE URL
# ============================================================

# Берём DATABASE_URL из окружения.
# Если не задан — используем локальный sqlite для dev/debug.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dnd_trader.db")

# Для sqlite нужен special connect_args
engine_kwargs = {
    "future": True,
}

if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

# ============================================================
# 🧱 ENGINE
# ============================================================

engine = create_engine(
    DATABASE_URL,
    **engine_kwargs,
)

# ============================================================
# 🧾 SESSION FACTORY
# ============================================================

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
)

# ============================================================
# 🔌 FASTAPI DEPENDENCY
# ============================================================

def get_db():
    """
    Dependency для FastAPI-роутеров.
    Выдаёт сессию и корректно её закрывает.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close