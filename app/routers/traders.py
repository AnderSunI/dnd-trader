# ============================================================
# app/routers/traders.py
# Роутер торговцев и их ассортимента.
# ============================================================

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from ..models import Item, Trader, TraderItem

# ============================================================
# 🧩 ROUTER FACTORY
# ============================================================


def create_traders_router(
    *,
    get_db,
    calculate_buy_price_split,
    calculate_sell_price_split,
    format_split_price,
    build_price_debug,
) -> APIRouter:
    """
    Factory router.
    Все pricing helpers инжектим из main.py,
    чтобы не ломать DI и старую архитектуру.
    """
    router = APIRouter(tags=["traders"])

    # ========================================================
    # 🧾 SERIALIZERS
    # ========================================================

    def serialize_item(
        item: Item,
        trader_slot: TraderItem | None = None,
        trader: Trader | None = None,
    ) -> dict:
        """
        Сериализация предмета с учётом локального слота торговца.
        """
        slot_gold = (
            trader_slot.price_gold
            if trader_slot
            else int(item.price_gold or 0)
        )
        slot_silver = (
            trader_slot.price_silver
            if trader_slot
            else int(item.price_silver or 0)
        )
        slot_copper = (
            trader_slot.price_copper
            if trader_slot
            else int(item.price_copper or 0)
        )

        quantity = (
            trader_slot.quantity
            if trader_slot
            else int(item.stock or 0)
        )

        # Цена покупки игроком
        buy_price = calculate_buy_price_split(
            base_gold=slot_gold,
            base_silver=slot_silver,
            base_copper=slot_copper,
            trader_reputation=int(trader.reputation or 0) if trader else 0,
        )

        # Цена продажи торговцу
        sell_price = calculate_sell_price_split(
            base_gold=slot_gold,
            base_silver=slot_silver,
            base_copper=slot_copper,
            trader_reputation=int(trader.reputation or 0) if trader else 0,
        )

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
            "stock": quantity,
            "quantity": quantity,
            "base_price_gold": slot_gold,
            "base_price_silver": slot_silver,
            "base_price_copper": slot_copper,
            "price_gold": slot_gold,
            "price_silver": slot_silver,
            "price_copper": slot_copper,
            "buy_price_gold": buy_price["gold"],
            "buy_price_silver": buy_price["silver"],
            "buy_price_copper": buy_price["copper"],
            "buy_price_label": format_split_price(
                buy_price["gold"],
                buy_price["silver"],
                buy_price["copper"],
            ),
            "sell_price_gold": sell_price["gold"],
            "sell_price_silver": sell_price["silver"],
            "sell_price_copper": sell_price["copper"],
            "sell_price_label": format_split_price(
                sell_price["gold"],
                sell_price["silver"],
                sell_price["copper"],
            ),
            "pricing_debug": build_price_debug(
                buy_price=buy_price,
                sell_price=sell_price,
            ),
        }

    def serialize_trader(trader: Trader) -> dict:
        """
        Полная сериализация торговца.
        """
        slots = trader.trader_items or []

        items = [
            serialize_item(
                slot.item,
                trader_slot=slot,
                trader=trader,
            )
            for slot in slots
            if slot.item
        ]

        return {
            "id": trader.id,
            "name": trader.name,
            "type": trader.type,
            "specialization": trader.specialization or [],
            "reputation": int(trader.reputation or 0),
            "region": trader.region,
            "settlement": trader.settlement,
            "level_min": int(trader.level_min or 1),
            "level_max": int(trader.level_max or 1),
            "restock_days": int(trader.restock_days or 0),
            "last_restock": trader.last_restock,
            "currency": trader.currency,
            "description": trader.description,
            "image_url": trader.image_url,
            "personality": trader.personality,
            "possessions": trader.possessions or [],
            "rumors": trader.rumors,
            "gold": int(trader.gold or 0),
            "race": trader.race,
            "class_name": trader.class_name,
            "trader_level": int(trader.trader_level or 1),
            "stats": trader.stats or {},
            "abilities": trader.abilities or [],
            "items": items,
            "inventory_count": len(items),
        }

    # ========================================================
    # 🏪 LIST ALL TRADERS
    # ========================================================

    @router.get("/traders")
    def get_traders(
        category: str | None = Query(default=None),
        rarity: str | None = Query(default=None),
        region: str | None = Query(default=None),
        trader_type: str | None = Query(default=None),
        search: str | None = Query(default=None),
        db: Session = Depends(get_db),
    ):
        """
        Главный endpoint фронта:
        возвращает список торговцев.
        """
        query = (
            db.query(Trader)
            .options(
                joinedload(Trader.trader_items)
                .joinedload(TraderItem.item)
            )
            .order_by(Trader.id.asc())
        )

        traders = query.all()

        result = []

        for trader in traders:
            serialized = serialize_trader(trader)

            # ---------------- FILTERS ----------------
            if region and region != "all":
                if str(serialized["region"]).lower() != region.lower():
                    continue

            if trader_type and trader_type != "all":
                if str(serialized["type"]).lower() != trader_type.lower():
                    continue

            if category and category != "all":
                if not any(
                    item["category"] == category
                    for item in serialized["items"]
                ):
                    continue

            if rarity and rarity != "all":
                if not any(
                    item["rarity"] == rarity
                    for item in serialized["items"]
                ):
                    continue

            if search:
                needle = search.lower().strip()

                trader_match = (
                    needle in serialized["name"].lower()
                    or needle in serialized["description"].lower()
                    or needle in serialized["type"].lower()
                )

                item_match = any(
                    needle in item["name"].lower()
                    for item in serialized["items"]
                )

                if not trader_match and not item_match:
                    continue

            result.append(serialized)

        return {
            "status": "ok",
            "count": len(result),
            "traders": result,
        }

    # ========================================================
    # 👤 SINGLE TRADER
    # ========================================================

    @router.get("/traders/{trader_id}")
    def get_trader(
        trader_id: int,
        db: Session = Depends(get_db),
    ):
        """
        Получить одного торговца.
        """
        trader = (
            db.query(Trader)
            .options(
                joinedload(Trader.trader_items)
                .joinedload(TraderItem.item)
            )
            .filter(Trader.id == trader_id)
            .first()
        )

        if not trader:
            return {
                "status": "error",
                "detail": "Торговец не найден",
            }

        return {
            "status": "ok",
            "trader": serialize_trader(trader),
        }

    # ========================================================
    # 📚 FILTER META
    # ========================================================

    @router.get("/traders/meta")
    def get_traders_meta(
        db: Session = Depends(get_db),
    ):
        """
        Данные для dropdown фильтров на фронте.
        """
        traders = db.query(Trader).all()

        regions = sorted(
            {
                t.region
                for t in traders
                if t.region
            }
        )

        trader_types = sorted(
            {
                t.type
                for t in traders
                if t.type
            }
        )

        categories = sorted(
            {
                slot.item.category
                for t in traders
                for slot in (t.trader_items or [])
                if slot.item and slot.item.category
            }
        )

        rarities = sorted(
            {
                slot.item.rarity
                for t in traders
                for slot in (t.trader_items or [])
                if slot.item and slot.item.rarity
            }
        )

        return {
            "status": "ok",
            "regions": regions,
            "types": trader_types,
            "categories": categories,
            "rarities": rarities,
        }

    return router