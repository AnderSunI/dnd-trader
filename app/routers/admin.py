# app/routers/admin.py
from __future__ import annotations

import json
import random
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models import Item, Trader, TraderItem
from ..seed_db import traders_data


def create_admin_router(get_db, cleaned_items_path: Path):
    """
    Фабрика admin-роутера.
    """

    admin_router = APIRouter(prefix="/admin", tags=["admin"])

    # ============================================================
    # 📥 ИМПОРТ ПРЕДМЕТОВ
    # ============================================================

    def import_items_from_json(db: Session, path: Path) -> int:
        """
        Импортирует предметы из cleaned_items.json
        под текущую модель Item.
        """
        if not path.exists():
            raise HTTPException(status_code=404, detail="cleaned_items.json не найден")

        with path.open("r", encoding="utf-8") as f:
            items_data = json.load(f)

        imported_count = 0

        for data in items_data:
            name = data.get("name")
            if not name:
                continue

            item = Item(
                name=name,
                category=data.get("category_clean", "misc"),
                rarity=data.get("rarity", "common"),
                rarity_tier=int(data.get("rarity_tier", 0) or 0),
                price_gold=int(data.get("price_gold", 0) or 0),
                price_silver=int(data.get("price_silver", 0) or 0),
                price_copper=int(data.get("price_copper", 0) or 0),
                weight=float(data.get("weight", 0.0) or 0.0),
                description=data.get("description", "") or "",
                properties=data.get("properties", {}) or {},
                requirements=data.get("requirements", {}) or {},
                is_magical=bool(data.get("is_magical", False)),
                attunement=bool(data.get("attunement", False)),
                stock=5,
                quality=data.get("quality", "стандартное") or "стандартное",
                source=data.get("source", "merged") or "merged",
                subcategory=data.get("subcategory", "") or "",
            )

            db.add(item)
            imported_count += 1

        db.commit()
        return imported_count

    # ============================================================
    # 🧑‍💼 ИМПОРТ ТОРГОВЦЕВ
    # ============================================================

    def import_traders_from_seed(db: Session) -> int:
        """
        Импортирует торговцев из app/seed_db.py
        """
        imported_count = 0

        for trader_data in traders_data:
            trader = Trader(
                name=trader_data["name"],
                type=trader_data["type"],
                specialization=trader_data.get("specialization", {}) or {},
                gold=int(trader_data.get("gold", 0) or 0),
                reputation=int(trader_data.get("reputation", 0) or 0),
                region=trader_data.get("region", "") or "",
                settlement=trader_data.get("settlement", "") or "",
                level_min=int(trader_data.get("level_min", 1) or 1),
                level_max=int(trader_data.get("level_max", 10) or 10),
                restock_days=int(trader_data.get("restock_days", 4) or 4),
                currency=trader_data.get("currency", "золотые") or "золотые",
                description=trader_data.get("description", "") or "",
                image_url=trader_data.get("image_url", "") or "",
                personality=trader_data.get("personality", "") or "",
                possessions=trader_data.get("possessions", []) or [],
                rumors=trader_data.get("rumors", "") or "",
                race=trader_data.get("race", "") or "",
                class_name=trader_data.get("class_name", "") or "",
                trader_level=int(trader_data.get("trader_level", 1) or 1),
                stats=trader_data.get("stats", {}) or {},
                abilities=trader_data.get("abilities", []) or [],
            )
            db.add(trader)
            imported_count += 1

        db.commit()
        return imported_count

    # ============================================================
    # 🗂 КАТЕГОРИИ ТОРГОВЦЕВ
    # ============================================================

    def get_trader_categories(trader: Trader) -> list[str]:
        """
        Определяет, какие категории предметов подходят торговцу.
        """
        trader_type = (trader.type or "").strip().lower()

        type_map = {
            "кузнец": ["weapon", "armor", "tools"],
            "оружейник": ["weapon", "armor"],
            "оружейный мастер": ["weapon", "armor", "tools"],
            "кожевник": ["armor", "accessory", "tools"],
            "портной": ["accessory", "misc"],
            "трактирщик": ["food_drink", "consumables", "misc"],
            "пекарь": ["food_drink", "consumables"],
            "мясник": ["food_drink", "consumables"],
            "торговец": ["misc", "accessory", "tools", "consumables"],
            "старьёвщик": ["misc", "scrolls_books", "tools", "accessory"],
            "цирюльник": ["misc", "accessory", "tools"],
            "банщица": ["misc", "accessory", "alchemy"],
            "пансион": ["food_drink", "misc", "accessory"],
            "складской владелец": ["tools", "misc", "consumables"],
            "контрабандист": ["misc", "scrolls_books", "alchemy", "accessory"],
            "друид-травница": ["alchemy", "potions_elixirs", "consumables", "scrolls_books"],
        }

        return type_map.get(trader_type, ["misc", "accessory"])

    # ============================================================
    # 📊 КВОТЫ ПО РЕДКОСТИ
    # ============================================================

    def get_rarity_quotas_for_trader(trader: Trader) -> dict[int, tuple[int, int]]:
        """
        Определяет, сколько предметов какой редкости выдавать торговцу.
        """
        level_max = int(trader.level_max or 1)

        if level_max <= 2:
            return {
                0: (8, 14),
                1: (1, 3),
            }

        if level_max <= 4:
            return {
                0: (8, 12),
                1: (2, 4),
                2: (0, 1),
            }

        if level_max <= 7:
            return {
                0: (6, 10),
                1: (3, 5),
                2: (1, 2),
                3: (0, 1),
            }

        return {
            0: (5, 8),
            1: (3, 5),
            2: (2, 3),
            3: (1, 2),
            4: (0, 1),
        }

    def get_quantity_by_rarity_tier(rarity_tier: int) -> int:
        """
        Чем предмет реже, тем меньше его количество.
        """
        quantity_map = {
            0: (3, 8),
            1: (2, 5),
            2: (1, 3),
            3: (1, 2),
            4: (1, 1),
            5: (1, 1),
        }

        low, high = quantity_map.get(int(rarity_tier or 0), (1, 2))
        return random.randint(low, high)

    # ============================================================
    # 🔁 RELINK АССОРТИМЕНТА
    # ============================================================

    def relink_all_items(db: Session) -> int:
        """
        Полностью пересобирает ассортимент торговцев
        через TraderItem.
        """
        db.query(TraderItem).delete()
        db.commit()

        traders = db.query(Trader).all()
        if not traders:
            return 0

        total_linked = 0
        globally_reserved_rare_ids: set[int] = set()

        for trader in traders:
            categories = get_trader_categories(trader)
            quotas = get_rarity_quotas_for_trader(trader)

            items = db.query(Item).filter(Item.category.in_(categories)).all()
            if not items:
                continue

            items_by_tier: dict[int, list[Item]] = {}

            for item in items:
                tier = int(item.rarity_tier or 0)

                if tier >= 3 and item.id in globally_reserved_rare_ids:
                    continue

                items_by_tier.setdefault(tier, []).append(item)

            selected_items: list[Item] = []

            for tier, (min_count, max_count) in quotas.items():
                pool = items_by_tier.get(tier, [])
                if not pool:
                    continue

                max_available = min(max_count, len(pool))
                if max_available <= 0:
                    continue

                count = random.randint(min_count, max_available) if max_available >= min_count else max_available
                if count <= 0:
                    continue

                chosen = random.sample(pool, count)
                selected_items.extend(chosen)

                if tier >= 3:
                    for item in chosen:
                        globally_reserved_rare_ids.add(item.id)

            for item in selected_items:
                slot = TraderItem(
                    trader_id=trader.id,
                    item_id=item.id,
                    quantity=get_quantity_by_rarity_tier(int(item.rarity_tier or 0)),
                    price_gold=int(item.price_gold or 0),
                    price_silver=int(item.price_silver or 0),
                    price_copper=int(item.price_copper or 0),
                    discount=0,
                    is_limited=bool(int(item.rarity_tier or 0) >= 3),
                )
                db.add(slot)

            total_linked += len(selected_items)

        db.commit()
        return total_linked

    # ============================================================
    # 🔐 ENDPOINTS
    # ============================================================

    @admin_router.post("/reset")
    def reset(db: Session = Depends(get_db)):
        """
        Полный сброс:
        - очищаем торговые слоты
        - очищаем торговцев
        - очищаем предметы
        - заново импортируем торговцев
        - заново импортируем предметы
        - заново собираем ассортимент
        """
        try:
            db.query(TraderItem).delete()
            db.query(Trader).delete()
            db.query(Item).delete()
            db.commit()

            traders_imported = import_traders_from_seed(db)
            items_imported = import_items_from_json(db, cleaned_items_path)
            linked = relink_all_items(db)

            return {
                "status": "ok",
                "traders_imported": traders_imported,
                "items_imported": items_imported,
                "linked": linked,
            }
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Ошибка reset: {e}")

    @admin_router.post("/relink-items")
    def relink_items(db: Session = Depends(get_db)):
        """
        Пересобирает ассортимент без удаления торговцев и предметов.
        """
        try:
            linked = relink_all_items(db)
            return {
                "status": "ok",
                "linked": linked,
            }
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Ошибка relink-items: {e}")

    @admin_router.get("/seed-preview")
    def seed_preview():
        """
        Быстрый предпросмотр текущего seed без записи в БД.
        """
        return {
            "status": "ok",
            "count": len(traders_data),
            "traders": traders_data,
        }

    return admin_router