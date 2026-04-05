# app/services/inventory.py
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session, joinedload

from ..models import Item, Trader, TraderItem, User, UserItem
from .money import copper_to_split, format_split_price
from .pricing import calculate_buy_price_cp, calculate_sell_price_cp


# ============================================================
# 💰 ДЕНЬГИ ПОЛЬЗОВАТЕЛЯ
# ============================================================

def get_user_or_raise(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"Пользователь с id={user_id} не найден")
    return user


def get_user_money_cp(user: User) -> int:
    """
    Возвращает весь кошелёк пользователя в copper.
    """
    return int(user.money_cp_total or 0)


def set_user_money_cp(user: User, total_cp: int) -> None:
    """
    Сохраняет кошелёк пользователя в copper.
    """
    user.money_cp_total = max(0, int(total_cp or 0))


# ============================================================
# 🧑‍💼 ТОРГОВЕЦ / ПРЕДМЕТ
# ============================================================

def get_trader_or_raise(db: Session, trader_id: int) -> Trader:
    trader = db.query(Trader).filter(Trader.id == trader_id).first()
    if not trader:
        raise ValueError(f"Торговец с id={trader_id} не найден")
    return trader


def get_item_or_raise(db: Session, item_id: int) -> Item:
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise ValueError(f"Предмет с id={item_id} не найден")
    return item


def get_trader_item_slot(
    db: Session,
    trader_id: int,
    item_id: int,
) -> TraderItem | None:
    return (
        db.query(TraderItem)
        .filter(
            TraderItem.trader_id == trader_id,
            TraderItem.item_id == item_id,
        )
        .first()
    )


def get_trader_item_slot_or_raise(
    db: Session,
    trader_id: int,
    item_id: int,
) -> TraderItem:
    slot = get_trader_item_slot(db, trader_id, item_id)
    if not slot:
        raise ValueError("У этого торговца нет такого предмета")
    return slot


# ============================================================
# 🎒 ПРЕДМЕТЫ ПОЛЬЗОВАТЕЛЯ
# ============================================================

def get_user_item_slot(
    db: Session,
    user_id: int,
    item_id: int,
) -> UserItem | None:
    return (
        db.query(UserItem)
        .filter(
            UserItem.user_id == user_id,
            UserItem.item_id == item_id,
        )
        .first()
    )


def add_item_to_user(
    db: Session,
    user_id: int,
    item_id: int,
    quantity: int,
    source: str = "trade",
) -> UserItem:
    slot = get_user_item_slot(db, user_id, item_id)

    if slot:
        slot.quantity = int(slot.quantity or 0) + quantity
        return slot

    slot = UserItem(
        user_id=user_id,
        item_id=item_id,
        quantity=quantity,
        source=source,
    )
    db.add(slot)
    db.flush()
    return slot


def remove_item_from_user(
    db: Session,
    user_id: int,
    item_id: int,
    quantity: int,
) -> None:
    slot = get_user_item_slot(db, user_id, item_id)

    if not slot:
        raise ValueError("У пользователя нет такого предмета")

    current_qty = int(slot.quantity or 0)
    if current_qty < quantity:
        raise ValueError("Недостаточно предметов у пользователя")

    new_qty = current_qty - quantity

    if new_qty > 0:
        slot.quantity = new_qty
    else:
        db.delete(slot)


# ============================================================
# 🛒 ПОКУПКА
# ============================================================

def buy_item(
    db: Session,
    user_id: int,
    trader_id: int,
    item_id: int,
    quantity: int = 1,
) -> dict[str, Any]:
    if quantity <= 0:
        raise ValueError("Количество должно быть больше 0")

    user = get_user_or_raise(db, user_id)
    trader = get_trader_or_raise(db, trader_id)
    item = get_item_or_raise(db, item_id)

    trader_slot = get_trader_item_slot_or_raise(db, trader_id, item_id)

    available_qty = int(trader_slot.quantity or 0)
    if available_qty < quantity:
        raise ValueError("У торговца недостаточно предметов в наличии")

    unit_price_cp = calculate_buy_price_cp(item, trader)
    total_price_cp = unit_price_cp * quantity

    user_money_cp = get_user_money_cp(user)
    if user_money_cp < total_price_cp:
        raise ValueError("Недостаточно денег")

    new_user_money_cp = user_money_cp - total_price_cp
    set_user_money_cp(user, new_user_money_cp)

    trader_slot.quantity = available_qty - quantity

    add_item_to_user(
        db=db,
        user_id=user_id,
        item_id=item_id,
        quantity=quantity,
        source="buy",
    )

    db.commit()

    total_gold, total_silver, total_copper = copper_to_split(total_price_cp)
    wallet_gold, wallet_silver, wallet_copper = copper_to_split(user.money_cp_total)

    return {
        "status": "ok",
        "action": "buy",
        "user_id": user_id,
        "trader_id": trader_id,
        "item_id": item_id,
        "quantity": quantity,
        "spent_price_gold": total_gold,
        "spent_price_silver": total_silver,
        "spent_price_copper": total_copper,
        "spent_price_label": format_split_price(total_gold, total_silver, total_copper),
        "remaining_money_cp_total": int(user.money_cp_total or 0),
        "remaining_money_gold": wallet_gold,
        "remaining_money_silver": wallet_silver,
        "remaining_money_copper": wallet_copper,
        "remaining_money_label": format_split_price(wallet_gold, wallet_silver, wallet_copper),
        "trader_remaining_quantity": int(trader_slot.quantity or 0),
    }


# ============================================================
# 💸 ПРОДАЖА
# ============================================================

def sell_item(
    db: Session,
    user_id: int,
    trader_id: int,
    item_id: int,
    quantity: int = 1,
) -> dict[str, Any]:
    if quantity <= 0:
        raise ValueError("Количество должно быть больше 0")

    user = get_user_or_raise(db, user_id)
    trader = get_trader_or_raise(db, trader_id)
    item = get_item_or_raise(db, item_id)

    user_slot = get_user_item_slot(db, user_id, item_id)
    if not user_slot:
        raise ValueError("У пользователя нет такого предмета")

    current_user_qty = int(user_slot.quantity or 0)
    if current_user_qty < quantity:
        raise ValueError("Недостаточно предметов у пользователя")

    unit_price_cp = calculate_sell_price_cp(item, trader)
    total_price_cp = unit_price_cp * quantity

    user_money_cp = get_user_money_cp(user)
    new_user_money_cp = user_money_cp + total_price_cp
    set_user_money_cp(user, new_user_money_cp)

    remove_item_from_user(
        db=db,
        user_id=user_id,
        item_id=item_id,
        quantity=quantity,
    )

    trader_slot = get_trader_item_slot(db, trader_id, item_id)
    if trader_slot:
        trader_slot.quantity = int(trader_slot.quantity or 0) + quantity
    else:
        trader_slot = TraderItem(
            trader_id=trader_id,
            item_id=item_id,
            quantity=quantity,
            price_gold=int(item.price_gold or 0),
            price_silver=int(item.price_silver or 0),
            price_copper=int(item.price_copper or 0),
            discount=0,
            is_limited=False,
        )
        db.add(trader_slot)

    db.commit()

    total_gold, total_silver, total_copper = copper_to_split(total_price_cp)
    wallet_gold, wallet_silver, wallet_copper = copper_to_split(user.money_cp_total)

    return {
        "status": "ok",
        "action": "sell",
        "user_id": user_id,
        "trader_id": trader_id,
        "item_id": item_id,
        "quantity": quantity,
        "earned_price_gold": total_gold,
        "earned_price_silver": total_silver,
        "earned_price_copper": total_copper,
        "earned_price_label": format_split_price(total_gold, total_silver, total_copper),
        "remaining_money_cp_total": int(user.money_cp_total or 0),
        "remaining_money_gold": wallet_gold,
        "remaining_money_silver": wallet_silver,
        "remaining_money_copper": wallet_copper,
        "remaining_money_label": format_split_price(wallet_gold, wallet_silver, wallet_copper),
        "trader_quantity_after": int(trader_slot.quantity or 0),
    }


# ============================================================
# 👁 ИНВЕНТАРЬ ПОЛЬЗОВАТЕЛЯ
# ============================================================

def get_player_inventory(
    db: Session,
    user_id: int,
    trader_id: int | None = None,
) -> dict[str, Any]:
    """
    Возвращает инвентарь пользователя.
    Если передан trader_id — дополнительно считает sell price для этого торговца.
    """
    user = get_user_or_raise(db, user_id)

    trader = None
    if trader_id is not None:
        trader = get_trader_or_raise(db, trader_id)

    rows = (
        db.query(UserItem)
        .options(joinedload(UserItem.item))
        .filter(UserItem.user_id == user_id)
        .all()
    )

    items_payload: list[dict[str, Any]] = []

    for row in rows:
        item = row.item
        if not item:
            continue

        payload = {
            "item_id": item.id,
            "name": item.name,
            "category": item.category,
            "rarity": item.rarity,
            "rarity_tier": item.rarity_tier,
            "quality": item.quality,
            "quantity": int(row.quantity or 0),

            "base_price_gold": int(item.price_gold or 0),
            "base_price_silver": int(item.price_silver or 0),
            "base_price_copper": int(item.price_copper or 0),
            "base_price_label": format_split_price(
                int(item.price_gold or 0),
                int(item.price_silver or 0),
                int(item.price_copper or 0),
            ),
        }

        if trader is not None:
            sell_cp = calculate_sell_price_cp(item, trader)
            sell_gold, sell_silver, sell_copper = copper_to_split(sell_cp)

            payload.update(
                {
                    "sell_price_gold": sell_gold,
                    "sell_price_silver": sell_silver,
                    "sell_price_copper": sell_copper,
                    "sell_price_label": format_split_price(
                        sell_gold,
                        sell_silver,
                        sell_copper,
                    ),
                }
            )

        items_payload.append(payload)

    wallet_gold, wallet_silver, wallet_copper = copper_to_split(user.money_cp_total)

    return {
        "status": "ok",
        "user_id": user_id,
        "money_cp_total": int(user.money_cp_total or 0),
        "money_gold": wallet_gold,
        "money_silver": wallet_silver,
        "money_copper": wallet_copper,
        "money_label": format_split_price(wallet_gold, wallet_silver, wallet_copper),
        "items": items_payload,
    }