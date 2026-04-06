from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    SECRET_KEY,
)
from .database import get_db
from .models import User

# ============================================================
# 🔐 OAuth2 scheme
# ============================================================

# Основной путь для bearer token.
# Даже если фронт логинится через /login,
# этот endpoint нужен для Swagger/OAuth2 совместимости.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

# ============================================================
# 🧱 USER CRUD
# ============================================================

def get_user_by_email(db: Session, email: str) -> User | None:
    """
    Найти пользователя по email.
    """
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """
    Найти пользователя по id.
    """
    return db.query(User).filter(User.id == user_id).first()


def create_user(db: Session, email: str, password: str) -> User:
    """
    Создать нового пользователя.
    """
    existing = get_user_by_email(db, email)
    if existing:
        raise ValueError("Пользователь с таким email уже существует")

    user = User(
        email=email,
        hashed_password="",
        is_active=True,
        role="player",
        money_cp_total=1000000,  # стартовый капитал по умолчанию
    )
    user.set_password(password)

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    """
    Проверка email + password.
    """
    user = get_user_by_email(db, email)
    if not user:
        return None

    if not user.check_password(password):
        return None

    return user

# ============================================================
# 🎫 JWT
# ============================================================

def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """
    Создать JWT access token.
    """
    to_encode = data.copy()

    now = datetime.now(timezone.utc)

    if expires_delta is not None:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Декодировать JWT token.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Не удалось проверить токен",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

# ============================================================
# 👤 CURRENT USER DEPENDENCIES
# ============================================================

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Получить текущего пользователя из Bearer token.
    """
    payload = decode_access_token(token)

    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Некорректный токен: отсутствует sub",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Некорректный токен: неверный user id",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Пользователь не найден",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Проверка, что пользователь активен.
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пользователь деактивирован",
        )

    return current_user


def get_current_gm_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """
    Проверка на GM/admin.
    """
    role = str(current_user.role or "").lower()

    if role not in {"gm", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Требуется роль GM или admin",
        )

    return current_user