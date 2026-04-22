from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from ..models import Character, Item, Trader, TraderItem, User, UserItem
from .money import (
    add_cp,
    cp_payload,
    copper_to_split,
    format_split_price,
    has_enough_money,
    subtract_cp,
)
from .pricing import (
    calculate_buy_price_cp,
    calculate_sell_price_cp,
)
from .trader_progression import update_reputation_after_trade


def normalize_quantity(value: int | None) -> int:
    """
    Нормализуем количество для сделки.
    """
    try:
        quantity = int(value or 0)
    except (TypeError, ValueError):
        quantity = 0

    if quantity <= 0:
        raise ValueError("Количество должно быть больше нуля")

    return quantity


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


def cp_to_trader_gold_units(total_cp: int) -> int:
    """
    Legacy helper оставлен для совместимости / возможного старого кода.
    После исправления models.py сделки работают через trader.money_cp_total.
    """
    gold, _, _ = copper_to_split(int(total_cp or 0))
    return int(gold or 0)


def split_price_payload(prefix: str, total_cp: int) -> dict:
    gold, silver, copper = copper_to_split(int(total_cp or 0))
    return {
        f"{prefix}_cp": int(total_cp or 0),
        f"{prefix}_gold": int(gold or 0),
        f"{prefix}_silver": int(silver or 0),
        f"{prefix}_copper": int(copper or 0),
        f"{prefix}_label": format_split_price(gold, silver, copper),
    }


def build_inventory_item_payload(
    *,
    item: Item,
    quantity: int,
    trader: Trader | None = None,
) -> dict:
    sell_price_cp = calculate_sell_price_cp(
        base_gold=int(item.price_gold or 0),
        base_silver=int(item.price_silver or 0),
        base_copper=int(item.price_copper or 0),
        trader_reputation=int(trader.reputation or 0) if trader else 0,
    )

    sell_gold, sell_silver, sell_copper = copper_to_split(sell_price_cp)

    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "subcategory": item.subcategory,
        "rarity": item.rarity,
        "rarity_tier": int(item.rarity_tier or 0),
        "quality": item.quality,
        "description": item.description,
        "weight": float(item.weight or 0),
        "properties": item.properties or {},
        "requirements": item.requirements or {},
        "source": item.source,
        "is_magical": bool(item.is_magical),
        "attunement": bool(item.attunement),
        "quantity": int(quantity or 0),
        "price_gold": int(item.price_gold or 0),
        "price_silver": int(item.price_silver or 0),
        "price_copper": int(item.price_copper or 0),
        "sell_price_cp": int(sell_price_cp or 0),
        "sell_price_gold": int(sell_gold or 0),
        "sell_price_silver": int(sell_silver or 0),
        "sell_price_copper": int(sell_copper or 0),
        "sell_price_label": format_split_price(
            sell_gold,
            sell_silver,
            sell_copper,
        ),
    }


def sync_character_inventory(
    db: Session,
    user_id: int,
) -> None:
    """
    Синхронизация со старым форматом inventory у Character,
    чтобы поведение оставалось совместимым с legacy main.
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

    legacy_inventory: list[dict] = []

    for row in rows:
        if not row.item:
            continue

        row_quantity = int(row.quantity or 0)
        if row_quantity <= 0:
            continue

        legacy_inventory.append(
            {
                "id": row.item.id,
                "name": row.item.name,
                "category": row.item.category,
                "subcategory": row.item.subcategory,
                "rarity": row.item.rarity,
                "rarity_tier": int(row.item.rarity_tier or 0),
                "quality": row.item.quality,
                "quantity": row_quantity,
                "price_gold": int(row.item.price_gold or 0),
                "price_silver": int(row.item.price_silver or 0),
                "price_copper": int(row.item.price_copper or 0),
                "description": row.item.description,
                "weight": float(row.item.weight or 0),
                "is_magical": bool(row.item.is_magical),
                "attunement": bool(row.item.attunement),
            }
        )

    character.inventory = legacy_inventory
    db.add(character)
    db.flush()


def buy_item(
    *,
    db: Session,
    user_id: int,
    trader_id: int,
    item_id: int,
    quantity: int = 1,
) -> dict:
    quantity = normalize_quantity(quantity)

    try:
        user = get_user(db, user_id)
        trader = get_trader(db, trader_id)
        slot = get_trader_slot(db, trader_id, item_id)

        if not slot.item:
            raise ValueError("Предмет не найден у торговца")

        current_stock = int(slot.quantity or 0)
        if current_stock < quantity:
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

        if user.money_cp_total < total_price_cp:
            raise ValueError("Недостаточно средств")

        user.money_cp_total = subtract_cp(
            user.money_cp_total,
            total_price_cp,
        )

        trader.money_cp_total = add_cp(
            trader.money_cp_total,
            total_price_cp,
        )
        # Репутация растёт после покупки у торговца:
        # чем больше покупок, тем лучше отношение и цены в будущем.
        trader.reputation = update_reputation_after_trade(
            trader.reputation,
            action="buy",
            quantity=quantity,
        )

        slot.quantity = current_stock - quantity

        user_item = get_or_create_user_item(
            db=db,
            user_id=user_id,
            item_id=item_id,
        )
        user_item.quantity = int(user_item.quantity or 0) + quantity

        db.add(user)
        db.add(trader)
        db.add(slot)
        db.add(user_item)
        db.flush()

        sync_character_inventory(db, user_id)

        db.commit()
        db.refresh(user)
        db.refresh(trader)
        db.refresh(slot)
        db.refresh(user_item)

        return {
            "status": "ok",
            "action": "buy",
            "item_id": item_id,
            "quantity": quantity,
            **split_price_payload("unit_buy_price", unit_buy_price_cp),
            **split_price_payload("total_paid", total_price_cp),
            "trader_id": trader_id,
            "trader_gold": int(trader.gold or 0),
            "trader_stock": int(slot.quantity or 0),
            # Явно отдаём новую репутацию, чтобы фронт не пересчитывал её сам.
            "trader_reputation": int(trader.reputation or 0),
            "player_item_quantity": int(user_item.quantity or 0),
            **split_price_payload("trader_money", trader.money_cp_total),
            **cp_payload(user.money_cp_total),
        }

    except Exception:
        db.rollback()
        raise


def sell_item(
    *,
    db: Session,
    user_id: int,
    trader_id: int,
    item_id: int,
    quantity: int = 1,
) -> dict:
    quantity = normalize_quantity(quantity)

    try:
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

        current_user_quantity = int(user_item.quantity or 0)
        if current_user_quantity < quantity:
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

        if not has_enough_money(trader.money_cp_total, total_reward_cp):
            raise ValueError("У торговца недостаточно золота")

        user.money_cp_total = add_cp(
            user.money_cp_total,
            total_reward_cp,
        )

        trader.money_cp_total = subtract_cp(
            trader.money_cp_total,
            total_reward_cp,
        )
        # Репутация тоже растёт после продажи торговцу,
        # но мягче, чем при покупке (чтобы не абьюзить фарм).
        trader.reputation = update_reputation_after_trade(
            trader.reputation,
            action="sell",
            quantity=quantity,
        )

        new_user_quantity = current_user_quantity - quantity
        if new_user_quantity <= 0:
            db.delete(user_item)
            player_item_quantity = 0
        else:
            user_item.quantity = new_user_quantity
            db.add(user_item)
            player_item_quantity = int(user_item.quantity or 0)

        slot = get_or_create_trader_slot(
            db=db,
            trader_id=trader_id,
            item_id=item_id,
            base_gold=int(item.price_gold or 0),
            base_silver=int(item.price_silver or 0),
            base_copper=int(item.price_copper or 0),
        )
        slot.quantity = int(slot.quantity or 0) + quantity

        db.add(slot)
        db.add(user)
        db.add(trader)
        db.flush()

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
            **split_price_payload("unit_sell_price", unit_sell_price_cp),
            **split_price_payload("total_received", total_reward_cp),
            "trader_id": trader_id,
            "trader_gold": int(trader.gold or 0),
            "trader_stock": int(slot.quantity or 0),
            # Отдаём текущее значение для мгновенного обновления UI.
            "trader_reputation": int(trader.reputation or 0),
            "player_item_quantity": int(player_item_quantity or 0),
            **split_price_payload("trader_money", trader.money_cp_total),
            **cp_payload(user.money_cp_total),
        }

    except Exception:
        db.rollback()
        raise


def get_player_inventory(
    *,
    db: Session,
    user_id: int,
    trader_id: int | None = None,
) -> dict:
    user = get_user(db, user_id)

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

        row_quantity = int(row.quantity or 0)
        if row_quantity <= 0:
            continue

        items.append(
            build_inventory_item_payload(
                item=item,
                quantity=row_quantity,
                trader=trader,
            )
        )

    return {
        "status": "ok",
        "count": len(items),
        "items": items,
        **cp_payload(user.money_cp_total),
    }
