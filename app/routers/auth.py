from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..auth import (
    authenticate_user,
    create_access_token,
    create_user,
    get_current_active_user,
)
from ..config import ACCESS_TOKEN_EXPIRE_MINUTES
from ..database import get_db
from ..models import User

# ============================================================
# 🧾 REQUEST MODELS
# ============================================================


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ============================================================
# 🧰 HELPERS
# ============================================================


def serialize_user(user: User) -> dict:
    """
    Единый формат user payload.
    """
    return {
        "id": user.id,
        "email": user.email,
        "is_active": user.is_active,
        "role": user.role,
        "money_cp_total": int(user.money_cp_total or 0),
    }


# ============================================================
# 🧩 ROUTER FACTORY
# ============================================================


def create_auth_router() -> APIRouter:
    """
    Возвращает auth router.
    """
    router = APIRouter(prefix="/auth", tags=["auth"])

    # ========================================================
    # 🔐 OAuth2 token endpoint
    # ========================================================

    @router.post("/token")
    def issue_token(
        form_data: OAuth2PasswordRequestForm = Depends(),
        db: Session = Depends(get_db),
    ):
        """
        OAuth2 compatible login для Swagger / Bearer token.
        """
        user = authenticate_user(
            db=db,
            email=form_data.username,
            password=form_data.password,
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный email или пароль",
                headers={"WWW-Authenticate": "Bearer"},
            )

        access_token_expires = timedelta(
            minutes=ACCESS_TOKEN_EXPIRE_MINUTES
        )

        access_token = create_access_token(
            {"sub": str(user.id)},
            expires_delta=access_token_expires,
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
        }

    # ========================================================
    # 📝 Register
    # ========================================================

    @router.post("/register")
    def register(
        payload: RegisterRequest,
        db: Session = Depends(get_db),
    ):
        """
        Новый модульный register endpoint.
        """
        try:
            user = create_user(
                db=db,
                email=payload.email,
                password=payload.password,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

        access_token = create_access_token(
            {"sub": str(user.id)}
        )

        return {
            "status": "ok",
            "access_token": access_token,
            "token_type": "bearer",
            "user": serialize_user(user),
        }

    # ========================================================
    # 🔓 Login JSON endpoint
    # ========================================================

    @router.post("/login")
    def login(
        payload: LoginRequest,
        db: Session = Depends(get_db),
    ):
        """
        JSON login endpoint для фронта.
        """
        user = authenticate_user(
            db=db,
            email=payload.email,
            password=payload.password,
        )

        if not user:
            raise HTTPException(
                status_code=401,
                detail="Неверный email или пароль",
            )

        access_token = create_access_token(
            {"sub": str(user.id)}
        )

        return {
            "status": "ok",
            "access_token": access_token,
            "token_type": "bearer",
            "user": serialize_user(user),
        }

    # ========================================================
    # 👤 Current user
    # ========================================================

    @router.get("/me")
    def me(
        current_user: User = Depends(get_current_active_user),
    ):
        """
        Получить текущего пользователя.
        """
        return {
            "status": "ok",
            "user": serialize_user(current_user),
        }

    return router