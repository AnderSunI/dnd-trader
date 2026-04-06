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

# ============================================================
# 🧾 REQUEST MODELS
# ============================================================


class InventoryTradeRequest(BaseModel):
    trader_id: int
    item_id: int
    quantity: int = 1


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