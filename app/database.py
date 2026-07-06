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

# ============================================================
# 🧱 ENGINE SETTINGS
# ============================================================

engine_kwargs = {
    "future": True,
}

if DATABASE_URL.startswith("sqlite"):
    # Для sqlite нужен special connect_args.
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Для Postgres/Render/local docker:
    # - pool_pre_ping помогает не держать мёртвые соединения после рестарта БД;
    # - pool_recycle мягко обновляет долгоживущие соединения;
    # - pool_size/max_overflow оставляем умеренными, чтобы не душить free-tier БД;
    # - pool_timeout короче дефолта, чтобы ошибка всплывала быстрее и понятнее.
    engine_kwargs.update(
        {
            "pool_pre_ping": True,
            "pool_recycle": 1800,
            "pool_size": int(os.getenv("DB_POOL_SIZE", "5")),
            "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "10")),
            "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "20")),
        }
    )

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
    Выдаёт сессию и обязательно закрывает её после запроса.

    Важно: тут должен быть именно вызов db.close(), а не ссылка db.close.
    Иначе соединения не возвращаются в SQLAlchemy pool, после чего backend
    начинает падать с QueuePool limit/timeout на /traders, /auth/me и других API.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
