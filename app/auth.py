# app/auth.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY
from .database import get_db
from .models import User

# ============================================================
# 🔐 OAUTH2 SCHEME
# ============================================================

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ============================================================
# 👤 РАБОТА С ПОЛЬЗОВАТЕЛЯМИ
# ============================================================

def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def create_user(
    db: Session,
    email: str,
    password: str,
) -> User:
    existing = get_user_by_email(db, email)
    if existing:
        raise ValueError("Пользователь с таким email уже существует")

    user = User(
        email=email.strip().lower(),
        hashed_password="",
        is_active=True,
    )
    user.set_password(password)

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def authenticate_user(
    db: Session,
    email: str,
    password: str,
) -> User | None:
    user = get_user_by_email(db, email.strip().lower())
    if not user:
        return None

    if not user.check_password(password):
        return None

    return user


# ============================================================
# 🎟 JWT
# ============================================================

def create_access_token(
    data: dict,
    expires_delta: timedelta | None = None,
) -> str:
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ============================================================
# 🔍 CURRENT USER
# ============================================================

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось подтвердить токен",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")

        if user_id is None:
            raise credentials_exception

        user = get_user_by_id(db, int(user_id))
        if user is None:
            raise credentials_exception

        return user

    except (JWTError, ValueError, TypeError):
        raise credentials_exception


def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Пользователь неактивен")
    return current_user