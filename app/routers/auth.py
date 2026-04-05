# app/routers/auth.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..auth import (
    authenticate_user,
    create_access_token,
    create_user,
    get_current_active_user,
)
from ..database import get_db
from ..models import User
from ..services.money import copper_to_split, format_split_price


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


def create_auth_router():
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.post("/register")
    def register(
        payload: RegisterRequest,
        db: Session = Depends(get_db),
    ):
        try:
            user = create_user(
                db=db,
                email=payload.email,
                password=payload.password,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        access_token = create_access_token({"sub": str(user.id)})

        gold, silver, copper = copper_to_split(int(user.money_cp_total or 0))

        return {
            "status": "ok",
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "is_active": user.is_active,
                "money_cp_total": int(user.money_cp_total or 0),
                "money_gold": gold,
                "money_silver": silver,
                "money_copper": copper,
                "money_label": format_split_price(gold, silver, copper),
            },
        }

    @router.post("/login")
    def login(
        form_data: OAuth2PasswordRequestForm = Depends(),
        db: Session = Depends(get_db),
    ):
        user = authenticate_user(
            db=db,
            email=form_data.username,
            password=form_data.password,
        )

        if not user:
            raise HTTPException(status_code=401, detail="Неверный email или пароль")

        access_token = create_access_token({"sub": str(user.id)})

        gold, silver, copper = copper_to_split(int(user.money_cp_total or 0))

        return {
            "status": "ok",
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "is_active": user.is_active,
                "money_cp_total": int(user.money_cp_total or 0),
                "money_gold": gold,
                "money_silver": silver,
                "money_copper": copper,
                "money_label": format_split_price(gold, silver, copper),
            },
        }

    @router.get("/me")
    def me(
        current_user: User = Depends(get_current_active_user),
    ):
        gold, silver, copper = copper_to_split(int(current_user.money_cp_total or 0))

        return {
            "status": "ok",
            "user": {
                "id": current_user.id,
                "email": current_user.email,
                "is_active": current_user.is_active,
                "money_cp_total": int(current_user.money_cp_total or 0),
                "money_gold": gold,
                "money_silver": silver,
                "money_copper": copper,
                "money_label": format_split_price(gold, silver, copper),
            },
        }

    return router