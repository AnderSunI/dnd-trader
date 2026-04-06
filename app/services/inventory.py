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
# 🧰 HELPERS
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
# 🔁 LEGACY SYNC
# ============================================================

def sync_character_inventory(
    db: Session,
    user_id: int,
) -> None:
    """
    Синхронизирует UserItem -> Character.inventory
    для полной совместимости со старым main frontend.
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
# 🛒 BUY
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

    if slot.quantity < quantity:
        raise ValueError("Недостаточно товара у торговца")

    total_price_cp = calculate_buy_price_cp(
        base_gold=int(slot.price_gold or 0),
        base_silver=int(slot.price_silver or 0),
        base_copper=int(slot.price_copper or 0),
        trader_reputation=int(trader.reputation or 0),
    ) * quantity

    if not has_enough_money(user.money_cp_total, total_price_cp):
        raise ValueError("Недостаточно средств")

    # 💰 деньги
    user.money_cp_total = subtract_cp(
        user.money_cp_total,
        total_price_cp,
    )

    # 📦 товар у торговца
    slot.quantity -= quantity

    # 🎒 товар игроку
    user_item = get_or_create_user_item(
        db,
        user_id,
        item_id,
    )
    user_item.quantity += quantity

    db.add(user)
    db.add(slot)
    db.add(user_item)

    sync_character_inventory(db, user_id)

    db.commit()
    db.refresh(user)

    return {
        "status": "ok",
        "action": "buy",
        "item_id": item_id,
        "quantity": quantity,
        "total_paid_cp": total_price_cp,
        **cp_payload(user.money_cp_total),
    }


# ============================================================
# 💸 SELL
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

    if user_item.quantity < quantity:
        raise ValueError("Недостаточное количество предметов")

    item = user_item.item
    if not item:
        raise ValueError("Предмет не найден")

    total_reward_cp = calculate_sell_price_cp(
        base_gold=int(item.price_gold or 0),
        base_silver=int(item.price_silver or 0),
        base_copper=int(item.price_copper or 0),
        trader_reputation=int(trader.reputation or 0),
    ) * quantity

    # 💰 деньги игроку
    user.money_cp_total = add_cp(
        user.money_cp_total,
        total_reward_cp,
    )

    # 📦 снимаем у игрока
    user_item.quantity -= quantity

    if user_item.quantity <= 0:
        db.delete(user_item)
    else:
        db.add(user_item)

    # 📦 возвращаем торговцу если слот уже есть
    slot = (
        db.query(TraderItem)
        .filter(
            TraderItem.trader_id == trader_id,
            TraderItem.item_id == item_id,
        )
        .first()
    )

    if slot:
        slot.quantity += quantity
        db.add(slot)

    db.add(user)

    sync_character_inventory(db, user_id)

    db.commit()
    db.refresh(user)

    return {
        "status": "ok",
        "action": "sell",
        "item_id": item_id,
        "quantity": quantity,
        "total_received_cp": total_reward_cp,
        **cp_payload(user.money_cp_total),
    }


# ============================================================
# 🎒 READ INVENTORY
# ============================================================

def get_player_inventory(
    *,
    db: Session,
    user_id: int,
    trader_id: int | None = None,
) -> dict:
    """
    Получить inventory игрока.
    trader_id optional для фронта sell-preview.
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
            }
        )

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
    }