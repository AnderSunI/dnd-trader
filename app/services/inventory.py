from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from ..models import Character, Item, Trader, TraderItem, User, UserItem
from .money import (
    add_cp,
    cp_payload,
    has_enough_money,
    subtract_cp,
)
from .pricing import (
    calculate_buy_price_cp,
    calculate_sell_price_cp,
)

# ============================================================
# HELPERS
# ============================================================


def get_user(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError("Пользователь не найден")
    return user


def get_trader(db: Session, trader_id: int) -> Trader:
    trader = db.query(Trader).filter(Trader.id == trader_id).first()
    if not trader:
        raise ValueError("Торговец не найден")
    return trader


def get_item(db: Session, item_id: int) -> Item:
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise ValueError("Предмет не найден")
    return item


def get_trader_slot(
    db: Session,
    trader_id: int,
    item_id: int,
) -> TraderItem:
    slot = (
        db.query(TraderItem)
        .options(joinedload(TraderItem.item))
        .filter(
            TraderItem.trader_id == trader_id,
            TraderItem.item_id == item_id,
        )
        .first()
    )
    if not slot:
        raise ValueError("Товар отсутствует у торговца")
    return slot


def get_or_create_user_item(
    db: Session,
    user_id: int,
    item_id: int,
) -> UserItem:
    user_item = (
        db.query(UserItem)
        .filter(
            UserItem.user_id == user_id,
            UserItem.item_id == item_id,
        )
        .first()
    )

    if user_item:
        return user_item

    user_item = UserItem(
        user_id=user_id,
        item_id=item_id,
        quantity=0,
        source="trade",
    )
    db.add(user_item)
    db.flush()
    return user_item


def get_or_create_trader_slot(
    db: Session,
    trader_id: int,
    item_id: int,
    *,
    base_gold: int,
    base_silver: int,
    base_copper: int,
) -> TraderItem:
    slot = (
        db.query(TraderItem)
        .filter(
            TraderItem.trader_id == trader_id,
            TraderItem.item_id == item_id,
        )
        .first()
    )

    if slot:
        return slot

    slot = TraderItem(
        trader_id=trader_id,
        item_id=item_id,
        price_gold=int(base_gold or 0),
        price_silver=int(base_silver or 0),
        price_copper=int(base_copper or 0),
        quantity=0,
        discount=0,
        is_limited=False,
        restock_locked=False,
    )
    db.add(slot)
    db.flush()
    return slot


def get_primary_character(
    db: Session,
    user_id: int,
) -> Character | None:
    return (
        db.query(Character)
        .filter(Character.user_id == user_id)
        .order_by(Character.id.asc())
        .first()
    )


# ============================================================
# LEGACY SYNC
# ============================================================


def sync_character_inventory(
    db: Session,
    user_id: int,
) -> None:
    """
    Синхронизирует UserItem -> Character.inventory
    для полной совместимости со старым frontend.
    """
    character = get_primary_character(db, user_id)
    if not character:
        return

    rows = (
        db.query(UserItem)
        .options(joinedload(UserItem.item))
        .filter(UserItem.user_id == user_id)
        .all()
    )

    legacy_inventory = []
    for row in rows:
        if not row.item:
            continue

        legacy_inventory.append(
            {
                "id": row.item.id,
                "name": row.item.name,
                "category": row.item.category,
                "rarity": row.item.rarity,
                "quantity": int(row.quantity or 0),
                "price_gold": int(row.item.price_gold or 0),
                "price_silver": int(row.item.price_silver or 0),
                "price_copper": int(row.item.price_copper or 0),
            }
        )

    character.inventory = legacy_inventory
    db.add(character)


# ============================================================
# BUY
# ============================================================


def buy_item(
    *,
    db: Session,
    user_id: int,
    trader_id: int,
    item_id: int,
    quantity: int = 1,
) -> dict:
    """
    Купить предмет у торговца.
    """
    quantity = max(1, int(quantity or 1))

    user = get_user(db, user_id)
    trader = get_trader(db, trader_id)
    slot = get_trader_slot(db, trader_id, item_id)

    if int(slot.quantity or 0) < quantity:
        raise ValueError("Недостаточно товара у торговца")

    unit_buy_price_cp = calculate_buy_price_cp(
        base_gold=int(slot.price_gold or 0),
        base_silver=int(slot.price_silver or 0),
        base_copper=int(slot.price_copper or 0),
        trader_reputation=int(trader.reputation or 0),
    )
    total_price_cp = unit_buy_price_cp * quantity

    if not has_enough_money(user.money_cp_total, total_price_cp):
        raise ValueError("Недостаточно средств")

    # игрок платит
    user.money_cp_total = subtract_cp(
        user.money_cp_total,
        total_price_cp,
    )

    # торговец получает
    trader.gold = int(trader.gold or 0) + total_price_cp

    # товар у торговца уменьшается
    slot.quantity = int(slot.quantity or 0) - quantity

    # товар игроку
    user_item = get_or_create_user_item(
        db,
        user_id,
        item_id,
    )
    user_item.quantity = int(user_item.quantity or 0) + quantity

    db.add(user)
    db.add(trader)
    db.add(slot)
    db.add(user_item)

    sync_character_inventory(db, user_id)

    db.commit()
    db.refresh(user)
    db.refresh(trader)
    db.refresh(slot)

    return {
        "status": "ok",
        "action": "buy",
        "item_id": item_id,
        "quantity": quantity,
        "unit_buy_price_cp": unit_buy_price_cp,
        "total_paid_cp": total_price_cp,
        "trader_id": trader_id,
        "trader_gold": int(trader.gold or 0),
        "trader_stock": int(slot.quantity or 0),
        **cp_payload(user.money_cp_total),
    }


# ============================================================
# SELL
# ============================================================


def sell_item(
    *,
    db: Session,
    user_id: int,
    trader_id: int,
    item_id: int,
    quantity: int = 1,
) -> dict:
    """
    Продать предмет торговцу.
    """
    quantity = max(1, int(quantity or 1))

    user = get_user(db, user_id)
    trader = get_trader(db, trader_id)

    user_item = (
        db.query(UserItem)
        .options(joinedload(UserItem.item))
        .filter(
            UserItem.user_id == user_id,
            UserItem.item_id == item_id,
        )
        .first()
    )

    if not user_item:
        raise ValueError("Предмет отсутствует у игрока")

    if int(user_item.quantity or 0) < quantity:
        raise ValueError("Недостаточное количество предметов")

    item = user_item.item
    if not item:
        raise ValueError("Предмет не найден")

    unit_sell_price_cp = calculate_sell_price_cp(
        base_gold=int(item.price_gold or 0),
        base_silver=int(item.price_silver or 0),
        base_copper=int(item.price_copper or 0),
        trader_reputation=int(trader.reputation or 0),
    )
    total_reward_cp = unit_sell_price_cp * quantity

    # проверка, хватает ли торговцу денег
    if int(trader.gold or 0) < total_reward_cp:
        raise ValueError("У торговца недостаточно золота")

    # игрок получает деньги
    user.money_cp_total = add_cp(
        user.money_cp_total,
        total_reward_cp,
    )

    # торговец платит
    trader.gold = int(trader.gold or 0) - total_reward_cp

    # снимаем у игрока
    user_item.quantity = int(user_item.quantity or 0) - quantity
    if user_item.quantity <= 0:
        db.delete(user_item)
    else:
        db.add(user_item)

    # возвращаем/добавляем торговцу слот
    slot = get_or_create_trader_slot(
        db,
        trader_id,
        item_id,
        base_gold=int(item.price_gold or 0),
        base_silver=int(item.price_silver or 0),
        base_copper=int(item.price_copper or 0),
    )
    slot.quantity = int(slot.quantity or 0) + quantity

    db.add(slot)
    db.add(user)
    db.add(trader)

    sync_character_inventory(db, user_id)

    db.commit()
    db.refresh(user)
    db.refresh(trader)
    db.refresh(slot)

    return {
        "status": "ok",
        "action": "sell",
        "item_id": item_id,
        "quantity": quantity,
        "unit_sell_price_cp": unit_sell_price_cp,
        "total_received_cp": total_reward_cp,
        "trader_id": trader_id,
        "trader_gold": int(trader.gold or 0),
        "trader_stock": int(slot.quantity or 0),
        **cp_payload(user.money_cp_total),
    }


# ============================================================
# READ INVENTORY
# ============================================================


def get_player_inventory(
    *,
    db: Session,
    user_id: int,
    trader_id: int | None = None,
) -> dict:
    """
    Получить inventory игрока.
    trader_id optional для sell-preview на фронте.
    """
    rows = (
        db.query(UserItem)
        .options(joinedload(UserItem.item))
        .filter(UserItem.user_id == user_id)
        .all()
    )

    trader = None
    if trader_id:
        trader = get_trader(db, trader_id)

    items = []
    for row in rows:
        item = row.item
        if not item:
            continue

        sell_price_cp = calculate_sell_price_cp(
            base_gold=int(item.price_gold or 0),
            base_silver=int(item.price_silver or 0),
            base_copper=int(item.price_copper or 0),
            trader_reputation=int(trader.reputation or 0) if trader else 0,
        )

        from ..services.money import copper_to_split, format_split_price

        sell_gold, sell_silver, sell_copper = copper_to_split(sell_price_cp)

        items.append(
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "rarity": item.rarity,
                "quantity": int(row.quantity or 0),
                "price_gold": int(item.price_gold or 0),
                "price_silver": int(item.price_silver or 0),
                "price_copper": int(item.price_copper or 0),
                "sell_price_cp": sell_price_cp,
                "sell_price_gold": int(sell_gold or 0),
                "sell_price_silver": int(sell_silver or 0),
                "sell_price_copper": int(sell_copper or 0),
                "sell_price_label": format_split_price(sell_gold, sell_silver, sell_copper),
            }
        )

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
    }