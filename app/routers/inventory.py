# app/routers/inventory.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..models import User
from ..services.inventory import buy_item, get_player_inventory, sell_item


def create_inventory_router(get_db):
    router = APIRouter(prefix="/inventory", tags=["inventory"])

    @router.post("/buy")
    def buy(
        item_id: int,
        trader_id: int,
        quantity: int = 1,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        try:
            return buy_item(
                db=db,
                user_id=current_user.id,
                trader_id=trader_id,
                item_id=item_id,
                quantity=quantity,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/sell")
    def sell(
        item_id: int,
        trader_id: int,
        quantity: int = 1,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        try:
            return sell_item(
                db=db,
                user_id=current_user.id,
                trader_id=trader_id,
                item_id=item_id,
                quantity=quantity,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/player")
    def player_inventory(
        trader_id: int | None = None,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        try:
            return get_player_inventory(
                db=db,
                user_id=current_user.id,
                trader_id=trader_id,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    return router