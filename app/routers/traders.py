from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from ..auth import get_optional_current_user
from ..models import (
    Item,
    PartyMembership,
    PartyTable,
    PartyTraderAccess,
    Trader,
    TraderItem,
    User,
)


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

    Важно:
    - сохраняем модульную структуру develop
    - сериализацию держим совместимой и со старым фронтом, и с текущим frontend/js/app.js
    - деньги торговца наружу отдаём уже через новую money-модель
    """
    router = APIRouter(tags=["traders"])

    # ========================================================
    # 🧰 HELPERS
    # ========================================================

    COPPER_IN_SILVER = 100
    SILVER_IN_GOLD = 100
    COPPER_IN_GOLD = COPPER_IN_SILVER * SILVER_IN_GOLD

    def safe_int(value, default: int = 0) -> int:
        try:
            return int(value if value is not None else default)
        except (TypeError, ValueError):
            return default

    def safe_float(value, default: float = 0.0) -> float:
        try:
            return float(value if value is not None else default)
        except (TypeError, ValueError):
            return default

    def safe_str(value, default: str = "") -> str:
        if value is None:
            return default
        return str(value)

    def parse_json_list(value) -> list:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, tuple):
            return list(value)
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return parsed
                if parsed in (None, "", {}):
                    return []
                return [parsed]
            except Exception:
                return [value]
        return [value]

    def parse_json_dict(value) -> dict:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return {}
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    return parsed
                return {}
            except Exception:
                return {}
        return {}

    def normalize_category(value: str | None) -> str:
        return safe_str(value, "").strip()

    def normalize_rarity(value: str | None) -> str:
        return safe_str(value, "").strip()

    def cp_to_split(total_cp: int) -> tuple[int, int, int]:
        total = max(0, safe_int(total_cp, 0))

        gold = total // COPPER_IN_GOLD
        total %= COPPER_IN_GOLD

        silver = total // COPPER_IN_SILVER
        copper = total % COPPER_IN_SILVER

        return gold, silver, copper

    def build_trader_money_payload(trader: Trader) -> dict:
        """
        Единый денежный payload торговца.

        Источник истины: Trader.money_cp_total.
        Legacy gold оставляем для совместимости,
        но наружу даём и split/cp-представление.
        """
        total_cp = max(0, safe_int(getattr(trader, "money_cp_total", 0), 0))
        gold, silver, copper = cp_to_split(total_cp)
        label = format_split_price(gold, silver, copper)

        return {
            # Новая money-модель
            "money_cp_total": total_cp,
            "money_gold": gold,
            "money_silver": silver,
            "money_copper": copper,
            "money_label": label,

            # Совместимость с текущим фронтом
            "gold_label": label,
            "trader_money_cp": total_cp,
            "trader_money_gold": gold,
            "trader_money_silver": silver,
            "trader_money_copper": copper,
            "trader_money_label": label,

            # Legacy-совместимость
            "gold": safe_int(trader.gold, 0),
        }

    # ========================================================
    # 🧾 SERIALIZERS
    # ========================================================

    def serialize_item(
        item: Item,
        trader_slot: TraderItem | None = None,
        trader: Trader | None = None,
    ) -> dict:
        """
        Сериализация предмета для фронта.

        Подход:
        - если есть TraderItem, используем его цены и количество
        - если нет, fallback на Item
        - отдаём совместимый набор полей для старого и нового фронта
        """
        base_gold = safe_int(
            trader_slot.price_gold if trader_slot else item.price_gold,
            0,
        )
        base_silver = safe_int(
            trader_slot.price_silver if trader_slot else item.price_silver,
            0,
        )
        base_copper = safe_int(
            trader_slot.price_copper if trader_slot else item.price_copper,
            0,
        )

        quantity = safe_int(
            trader_slot.quantity if trader_slot else item.stock,
            0,
        )
        if quantity < 0:
            quantity = 0

        reputation = safe_int(trader.reputation if trader else 0, 0)

        buy_price = calculate_buy_price_split(
            base_gold=base_gold,
            base_silver=base_silver,
            base_copper=base_copper,
            trader_reputation=reputation,
        )

        sell_price = calculate_sell_price_split(
            base_gold=base_gold,
            base_silver=base_silver,
            base_copper=base_copper,
            trader_reputation=reputation,
        )

        buy_label = format_split_price(
            safe_int(buy_price.get("gold"), 0),
            safe_int(buy_price.get("silver"), 0),
            safe_int(buy_price.get("copper"), 0),
        )

        sell_label = format_split_price(
            safe_int(sell_price.get("gold"), 0),
            safe_int(sell_price.get("silver"), 0),
            safe_int(sell_price.get("copper"), 0),
        )

        base_label = format_split_price(
            base_gold,
            base_silver,
            base_copper,
        )

        return {
            # Базовые поля
            "id": item.id,
            "item_id": item.id,
            "name": safe_str(item.name),
            "category": normalize_category(item.category),
            "subcategory": safe_str(item.subcategory),
            "rarity": normalize_rarity(item.rarity),
            "rarity_tier": safe_int(item.rarity_tier, 0),
            "quality": safe_str(item.quality),
            "description": safe_str(item.description),
            "weight": safe_float(item.weight, 0.0),
            "properties": parse_json_dict(item.properties),
            "requirements": parse_json_dict(item.requirements),
            "source": safe_str(item.source),
            "is_magical": bool(item.is_magical),
            "attunement": bool(item.attunement),

            # Остатки
            "stock": quantity,
            "quantity": quantity,
            "stock_orig": safe_int(item.stock, quantity),

            # База / original
            "base_price_gold": base_gold,
            "base_price_silver": base_silver,
            "base_price_copper": base_copper,
            "price_gold_orig": safe_int(item.price_gold, 0),
            "price_silver_orig": safe_int(item.price_silver, 0),
            "price_copper_orig": safe_int(item.price_copper, 0),
            "base_price_label": base_label,

            # Совместимость с фронтом:
            # price_* = итоговая цена покупки у торговца
            "price_gold": safe_int(buy_price.get("gold"), 0),
            "price_silver": safe_int(buy_price.get("silver"), 0),
            "price_copper": safe_int(buy_price.get("copper"), 0),
            "price_label": buy_label,
            "display_price_label": buy_label,

            # Явная buy-цена
            "buy_price_gold": safe_int(buy_price.get("gold"), 0),
            "buy_price_silver": safe_int(buy_price.get("silver"), 0),
            "buy_price_copper": safe_int(buy_price.get("copper"), 0),
            "buy_price_label": buy_label,

            # Явная sell-цена
            "sell_price_gold": safe_int(sell_price.get("gold"), 0),
            "sell_price_silver": safe_int(sell_price.get("silver"), 0),
            "sell_price_copper": safe_int(sell_price.get("copper"), 0),
            "sell_price_label": sell_label,

            # Debug / объяснение цены
            "pricing_debug": build_price_debug(
                buy_price=buy_price,
                sell_price=sell_price,
            ),
        }

    def serialize_trader(trader: Trader) -> dict:
        """
        Полная сериализация торговца.

        Совместимость:
        - old main / старый фронт: legacy gold
        - current frontend/js/app.js: money_cp_total + split money fields
        """
        slots = trader.trader_items or []

        items: list[dict] = []
        for slot in slots:
            if not slot.item:
                continue

            items.append(
                serialize_item(
                    slot.item,
                    trader_slot=slot,
                    trader=trader,
                )
            )

        money_payload = build_trader_money_payload(trader)

        return {
            "id": trader.id,
            "name": safe_str(trader.name),
            "type": safe_str(trader.type),
            "specialization": parse_json_list(trader.specialization),
            "reputation": safe_int(trader.reputation, 0),
            "region": safe_str(trader.region),
            "settlement": safe_str(trader.settlement),
            "level_min": safe_int(trader.level_min, 1),
            "level_max": safe_int(trader.level_max, 1),
            "restock_days": safe_int(trader.restock_days, 0),
            "last_restock": safe_str(trader.last_restock),
            "currency": safe_str(trader.currency, "gold"),
            "description": safe_str(trader.description),
            "image_url": safe_str(trader.image_url),
            "personality": safe_str(trader.personality),
            "possessions": parse_json_list(trader.possessions),
            "rumors": safe_str(trader.rumors),
            "race": safe_str(trader.race),
            "class_name": safe_str(trader.class_name),
            "trader_level": safe_int(trader.trader_level, 1),
            "stats": parse_json_dict(trader.stats),
            "abilities": parse_json_list(trader.abilities),

            # Деньги торговца в полном формате
            **money_payload,

            # Товары
            "items": items,
            "inventory_count": len(items),
        }

    def get_allowed_trader_ids_for_user(
        db: Session,
        current_user: User | None,
    ) -> set[int] | None:
        if not current_user:
            return None

        role = str(current_user.role or "").strip().lower()
        if role in {"gm", "admin"}:
            return None

        memberships = (
            db.query(PartyMembership)
            .join(PartyTable, PartyTable.id == PartyMembership.table_id)
            .filter(
                PartyMembership.user_id == current_user.id,
                PartyMembership.status == "active",
                PartyTable.status == "active",
            )
            .all()
        )

        if not memberships:
            return None

        restricted_table_ids = {
            int(membership.table_id)
            for membership in memberships
            if membership.table and str(membership.table.trader_access_mode or "open") == "restricted"
        }

        if not restricted_table_ids:
            return None

        rows = (
            db.query(PartyTraderAccess)
            .filter(
                PartyTraderAccess.table_id.in_(restricted_table_ids),
                PartyTraderAccess.is_enabled.is_(True),
            )
            .all()
        )
        return {int(row.trader_id) for row in rows}

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
        current_user: User | None = Depends(get_optional_current_user),
        db: Session = Depends(get_db),
    ):
        """
        Главный endpoint фронта.
        Возвращает список торговцев в стабильном формате.
        """
        traders = (
            db.query(Trader)
            .options(
                joinedload(Trader.trader_items).joinedload(TraderItem.item)
            )
            .order_by(Trader.id.asc())
            .all()
        )
        allowed_trader_ids = get_allowed_trader_ids_for_user(db, current_user)

        normalized_category = safe_str(category).strip().lower()
        normalized_rarity = safe_str(rarity).strip().lower()
        normalized_region = safe_str(region).strip().lower()
        normalized_trader_type = safe_str(trader_type).strip().lower()
        needle = safe_str(search).strip().lower()

        result: list[dict] = []

        for trader in traders:
            if allowed_trader_ids is not None and trader.id not in allowed_trader_ids:
                continue

            serialized = serialize_trader(trader)

            if normalized_region and normalized_region != "all":
                if safe_str(serialized.get("region")).strip().lower() != normalized_region:
                    continue

            if normalized_trader_type and normalized_trader_type != "all":
                if safe_str(serialized.get("type")).strip().lower() != normalized_trader_type:
                    continue

            if normalized_category and normalized_category != "all":
                if not any(
                    safe_str(item.get("category")).strip().lower() == normalized_category
                    for item in serialized["items"]
                ):
                    continue

            if normalized_rarity and normalized_rarity != "all":
                if not any(
                    safe_str(item.get("rarity")).strip().lower() == normalized_rarity
                    for item in serialized["items"]
                ):
                    continue

            if needle:
                trader_match = any(
                    needle in safe_str(serialized.get(field)).lower()
                    for field in ("name", "description", "type", "region", "settlement")
                )

                item_match = any(
                    needle in safe_str(item.get("name")).lower()
                    or needle in safe_str(item.get("category")).lower()
                    or needle in safe_str(item.get("subcategory")).lower()
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
        current_user: User | None = Depends(get_optional_current_user),
        db: Session = Depends(get_db),
    ):
        """
        Получить одного торговца с актуальным составом items.
        """
        allowed_trader_ids = get_allowed_trader_ids_for_user(db, current_user)
        if allowed_trader_ids is not None and trader_id not in allowed_trader_ids:
            return {
                "status": "error",
                "detail": "Торговец недоступен для текущей партии",
            }

        trader = (
            db.query(Trader)
            .options(
                joinedload(Trader.trader_items).joinedload(TraderItem.item)
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
        Данные для dropdown-фильтров фронта.
        """
        traders = (
            db.query(Trader)
            .options(
                joinedload(Trader.trader_items).joinedload(TraderItem.item)
            )
            .order_by(Trader.id.asc())
            .all()
        )

        regions = sorted(
            {
                safe_str(t.region).strip()
                for t in traders
                if safe_str(t.region).strip()
            }
        )

        trader_types = sorted(
            {
                safe_str(t.type).strip()
                for t in traders
                if safe_str(t.type).strip()
            }
        )

        categories = sorted(
            {
                safe_str(slot.item.category).strip()
                for t in traders
                for slot in (t.trader_items or [])
                if slot.item and safe_str(slot.item.category).strip()
            }
        )

        rarities = sorted(
            {
                safe_str(slot.item.rarity).strip()
                for t in traders
                for slot in (t.trader_items or [])
                if slot.item and safe_str(slot.item.rarity).strip()
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
