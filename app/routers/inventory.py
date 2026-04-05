from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import get_db
from ..models import User, Item, Trader, UserItem, TraderItem
from ..services.money import copper_to_split, format_split_price
from ..services.pricing import calculate_buy_price_cp, calculate_sell_price_cp

def create_inventory_router():
    router = APIRouter(prefix="/inventory", tags=["inventory"])

    @router.post("/buy")
    def buy_item(
        item_id: int, trader_id: int, quantity: int = 1,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db)
    ):
        item = db.query(Item).get(item_id)
        if not item:
            raise HTTPException(404, "Item not found")
        trader = db.query(Trader).get(trader_id)
        if not trader:
            raise HTTPException(404, "Trader not found")
        trader_item = db.query(TraderItem).filter_by(trader_id=trader_id, item_id=item_id).first()
        if not trader_item or trader_item.quantity < quantity:
            raise HTTPException(400, "Not enough stock")
        price_cp = calculate_buy_price_cp(item, trader) * quantity
        if current_user.money_cp_total < price_cp:
            raise HTTPException(400, "Not enough money")
        current_user.money_cp_total -= price_cp
        trader_item.quantity -= quantity
        user_item = db.query(UserItem).filter_by(user_id=current_user.id, item_id=item_id).first()
        if user_item:
            user_item.quantity += quantity
        else:
            db.add(UserItem(user_id=current_user.id, item_id=item_id, quantity=quantity, source="buy"))
        db.commit()
        gold, silver, copper = copper_to_split(price_cp)
        return {
            "status": "ok", "action": "buy", "quantity": quantity,
            "spent_price_gold": gold, "spent_price_silver": silver, "spent_price_copper": copper,
            "spent_price_label": format_split_price(gold, silver, copper),
            "remaining_money_cp_total": current_user.money_cp_total,
            "remaining_money_gold": copper_to_split(current_user.money_cp_total)[0],
            "remaining_money_silver": copper_to_split(current_user.money_cp_total)[1],
            "remaining_money_copper": copper_to_split(current_user.money_cp_total)[2],
            "remaining_money_label": format_split_price(*copper_to_split(current_user.money_cp_total))
        }

    @router.post("/sell")
    def sell_item(
        item_id: int, trader_id: int, quantity: int = 1,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db)
    ):
        item = db.query(Item).get(item_id)
        if not item:
            raise HTTPException(404, "Item not found")
        trader = db.query(Trader).get(trader_id)
        if not trader:
            raise HTTPException(404, "Trader not found")
        user_item = db.query(UserItem).filter_by(user_id=current_user.id, item_id=item_id).first()
        if not user_item or user_item.quantity < quantity:
            raise HTTPException(400, "Not enough items")
        price_cp = calculate_sell_price_cp(item, trader) * quantity
        current_user.money_cp_total += price_cp
        user_item.quantity -= quantity
        if user_item.quantity <= 0:
            db.delete(user_item)
        trader_item = db.query(TraderItem).filter_by(trader_id=trader_id, item_id=item_id).first()
        if trader_item:
            trader_item.quantity += quantity
        else:
            db.add(TraderItem(trader_id=trader_id, item_id=item_id, quantity=quantity,
                              price_gold=item.price_gold, price_silver=item.price_silver, price_copper=item.price_copper))
        db.commit()
        gold, silver, copper = copper_to_split(price_cp)
        return {
            "status": "ok", "action": "sell", "quantity": quantity,
            "earned_price_gold": gold, "earned_price_silver": silver, "earned_price_copper": copper,
            "earned_price_label": format_split_price(gold, silver, copper),
            "remaining_money_cp_total": current_user.money_cp_total,
            "remaining_money_gold": copper_to_split(current_user.money_cp_total)[0],
            "remaining_money_silver": copper_to_split(current_user.money_cp_total)[1],
            "remaining_money_copper": copper_to_split(current_user.money_cp_total)[2],
            "remaining_money_label": format_split_price(*copper_to_split(current_user.money_cp_total))
        }

    @router.get("/player")
    def player_inventory(
        trader_id: int | None = None,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db)
    ):
        user_items = db.query(UserItem).filter_by(user_id=current_user.id).all()
        items_list = []
        for ui in user_items:
            item = ui.item
            if not item:
                continue
            sell_price_cp = calculate_sell_price_cp(item, db.query(Trader).get(trader_id)) if trader_id else 0
            sell_g, sell_s, sell_c = copper_to_split(sell_price_cp)
            items_list.append({
                "item_id": item.id, "name": item.name, "category": item.category,
                "rarity": item.rarity, "rarity_tier": item.rarity_tier, "quality": item.quality,
                "quantity": ui.quantity,
                "base_price_gold": item.price_gold, "base_price_silver": item.price_silver, "base_price_copper": item.price_copper,
                "base_price_label": format_split_price(item.price_gold, item.price_silver, item.price_copper),
                "sell_price_gold": sell_g, "sell_price_silver": sell_s, "sell_price_copper": sell_c,
                "sell_price_label": format_split_price(sell_g, sell_s, sell_c)
            })
        gold, silver, copper = copper_to_split(current_user.money_cp_total)
        return {
            "status": "ok", "user_id": current_user.id,
            "money_cp_total": current_user.money_cp_total,
            "money_gold": gold, "money_silver": silver, "money_copper": copper,
            "money_label": format_split_price(gold, silver, copper),
            "items": items_list
        }

    return router