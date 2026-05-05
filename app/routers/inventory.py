from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..models import User
from ..services.inventory import (
    buy_item,
    get_player_inventory,
    sell_item,
)
from ..services.money import cp_payload

# ============================================================
# 🧾 REQUEST MODELS
# ============================================================


class InventoryTradeRequest(BaseModel):
    trader_id: int
    item_id: int
    quantity: int = 1
    # Frontend может передать текущий баланс в медных монетах.
    # Это нужно для тестового GM-режима: поле золота на фронте
    # должно синхронизироваться с сервером перед покупкой.
    client_money_cp_total: int | None = None


class InventoryMoneyRequest(BaseModel):
    money_cp_total: int | None = None
    money_gold: int | None = None
    money_silver: int | None = None
    money_copper: int | None = None


# ============================================================
# 🧰 MONEY HELPERS
# ============================================================


def normalize_cp(value: int | None) -> int | None:
    if value is None:
        return None
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return None


def money_parts_to_cp(gold: int | None = None, silver: int | None = None, copper: int | None = None) -> int:
    def safe_int(raw: int | None) -> int:
        try:
            return max(0, int(raw or 0))
        except (TypeError, ValueError):
            return 0

    return safe_int(gold) * 10000 + safe_int(silver) * 100 + safe_int(copper)


def resolve_money_cp(payload: InventoryMoneyRequest) -> int:
    direct = normalize_cp(payload.money_cp_total)
    if direct is not None:
        return direct
    return money_parts_to_cp(
        payload.money_gold,
        payload.money_silver,
        payload.money_copper,
    )


def sync_user_money_from_client(
    *,
    db: Session,
    user: User,
    money_cp_total: int | None,
) -> None:
    cp = normalize_cp(money_cp_total)
    if cp is None:
        return

    user.money_cp_total = cp
    db.add(user)
    db.flush()


# ============================================================
# 🧩 ROUTER FACTORY
# ============================================================


def create_inventory_router(get_db) -> APIRouter:
    """
    Factory inventory router.
    """
    router = APIRouter(
        prefix="/inventory",
        tags=["inventory"],
    )

    # ========================================================
    # 🛒 BUY
    # ========================================================

    @router.post("/buy")
    def buy_endpoint(
        payload: InventoryTradeRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        """
        Купить предмет.
        """
        try:
            # Если frontend только что поменял тестовое золото,
            # синхронизируем его до проверки цены.
            sync_user_money_from_client(
                db=db,
                user=current_user,
                money_cp_total=payload.client_money_cp_total,
            )

            return buy_item(
                db=db,
                user_id=current_user.id,
                trader_id=payload.trader_id,
                item_id=payload.item_id,
                quantity=payload.quantity,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

    # ========================================================
    # 💸 SELL
    # ========================================================

    @router.post("/sell")
    def sell_endpoint(
        payload: InventoryTradeRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        """
        Продать предмет.
        """
        try:
            return sell_item(
                db=db,
                user_id=current_user.id,
                trader_id=payload.trader_id,
                item_id=payload.item_id,
                quantity=payload.quantity,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

    # ========================================================
    # 💰 MONEY SYNC
    # ========================================================

    @router.post("/money")
    @router.patch("/money")
    def update_money_endpoint(
        payload: InventoryMoneyRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        """
        Синхронизация тестового/текущего золота игрока.
        Нужна, чтобы кнопка изменения золота на фронте не расходилась
        с серверной проверкой покупки.
        """
        try:
            cp = resolve_money_cp(payload)
            current_user.money_cp_total = cp
            db.add(current_user)
            db.commit()
            db.refresh(current_user)
            return {
                "status": "ok",
                **cp_payload(current_user.money_cp_total),
            }
        except Exception as exc:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail=str(exc) or "Не удалось обновить золото",
            ) from exc

    # ========================================================
    # 🎒 MY INVENTORY
    # ========================================================

    @router.get("/me")
    def my_inventory(
        trader_id: int | None = None,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        """
        Получить inventory игрока.
        """
        try:
            return get_player_inventory(
                db=db,
                user_id=current_user.id,
                trader_id=trader_id,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

    # ========================================================
    # 🔁 LEGACY ALIASES
    # ========================================================
    # Чтобы старый frontend из main тоже не сломался
    # если он ходит по старым путям.
    # ========================================================

    @router.get("/player")
    def legacy_player_inventory(
        trader_id: int | None = None,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        """
        Legacy alias:
        /inventory/player
        """
        try:
            return get_player_inventory(
                db=db,
                user_id=current_user.id,
                trader_id=trader_id,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

    return router
