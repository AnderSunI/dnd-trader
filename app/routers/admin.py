from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models import Item, Trader, TraderItem
from ..seed_db import traders_data

# ============================================================
# 🧰 HELPERS
# ============================================================

def import_items_from_json(db: Session, path: Path) -> int:
    if not path.exists():
        raise HTTPException(status_code=404, detail="cleaned_items.json не найден")

    with path.open("r", encoding="utf-8") as f:
        items_data = json.load(f)

    imported_count = 0

    for raw in items_data:
        name = raw.get("name")
        if not name:
            continue

        item = Item(
            name=name,
            category=raw.get("category_clean", "misc"),
            subcategory=raw.get("subcategory", "") or "",
            rarity=raw.get("rarity", "common"),
            rarity_tier=int(raw.get("rarity_tier", 0) or 0),
            quality=raw.get("quality", "стандартное") or "стандартное",
            price_gold=int(raw.get("price_gold", 0) or 0),
            price_silver=int(raw.get("price_silver", 0) or 0),
            price_copper=int(raw.get("price_copper", 0) or 0),
            weight=float(raw.get("weight", 0.0) or 0.0),
            description=raw.get("description", "") or "",
            properties=raw.get("properties", {}) or {},
            requirements=raw.get("requirements", {}) or {},
            source=raw.get("source", "merged") or "merged",
            is_magical=bool(raw.get("is_magical", False)),
            attunement=bool(raw.get("attunement", False)),
            stock=5,
        )
        db.add(item)
        imported_count += 1

    db.commit()
    return imported_count


def import_traders_from_seed(db: Session) -> int:
    imported_count = 0

    for raw in traders_data:
        trader = Trader(
            name=raw["name"],
            type=raw["type"],
            specialization=raw.get("specialization", []) or [],
            reputation=int(raw.get("reputation", 0) or 0),
            region=raw.get("region", "") or "",
            settlement=raw.get("settlement", "") or "",
            level_min=int(raw.get("level_min", 1) or 1),
            level_max=int(raw.get("level_max", 10) or 10),
            restock_days=int(raw.get("restock_days", 4) or 4),
            last_restock=raw.get("last_restock", "") or "",
            currency=raw.get("currency", "gold") or "gold",
            description=raw.get("description", "") or "",
            image_url=raw.get("image_url", "") or "",
            personality=raw.get("personality", "") or "",
            possessions=raw.get("possessions", []) or [],
            rumors=raw.get("rumors", "") or "",
            gold=int(raw.get("gold", 0) or 0),
            race=raw.get("race", "") or "",
            class_name=raw.get("class_name", "") or "",
            trader_level=int(raw.get("trader_level", 1) or 1),
            stats=raw.get("stats", {}) or {},
            abilities=raw.get("abilities", []) or [],
        )
        db.add(trader)
        imported_count += 1

    db.commit()
    return imported_count


def relink_all_items(db: Session) -> int:
    import random

    db.query(TraderItem).delete()
    db.commit()

    traders = db.query(Trader).all()
    items = db.query(Item).all()

    if not traders or not items:
        return 0

    total_linked = 0

    for trader in traders:
        categories = []

        trader_type = str(trader.type or "").strip().lower()

        if trader_type in {"кузнец", "оружейник", "оружейный мастер"}:
            categories = ["weapon", "armor", "tools"]
        elif trader_type in {"кожевник", "портной", "портниха", "дубильщик"}:
            categories = ["armor", "accessory", "misc"]
        elif trader_type in {"трактирщик", "пекарь", "мясник", "пансион", "банщица"}:
            categories = ["food_drink", "consumables", "misc"]
        elif trader_type in {"друид-травница", "алхимик"}:
            categories = ["alchemy", "potions_elixirs", "consumables"]
        elif trader_type in {"книготорговец", "старьёвщик", "художник"}:
            categories = ["scrolls_books", "misc", "accessory"]
        else:
            categories = ["misc", "tools", "accessory"]

        pool = [item for item in items if item.category in categories]
        if not pool:
            pool = items[:]

        random.shuffle(pool)
        chosen = pool[: min(len(pool), 12)]

        for item in chosen:
            slot = TraderItem(
                trader_id=trader.id,
                item_id=item.id,
                price_gold=int(item.price_gold or 0),
                price_silver=int(item.price_silver or 0),
                price_copper=int(item.price_copper or 0),
                quantity=random.randint(1, 6),
                discount=0,
                is_limited=False,
                restock_locked=False,
            )
            db.add(slot)
            total_linked += 1

    db.commit()
    return total_linked

# ============================================================
# 🧩 ROUTER FACTORY
# ============================================================

def create_admin_router(*, get_db, cleaned_items_path) -> APIRouter:
    router = APIRouter(prefix="/admin", tags=["admin"])

    @router.post("/reset")
    def reset_db(db: Session = Depends(get_db)):
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
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Ошибка reset: {exc}") from exc

    @router.post("/full-reset")
    def full_reset(db: Session = Depends(get_db)):
        return reset_db(db)

    @router.post("/relink-items")
    def relink_items(db: Session = Depends(get_db)):
        try:
            linked = relink_all_items(db)
            return {
                "status": "ok",
                "linked": linked,
            }
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Ошибка relink-items: {exc}") from exc

    @router.get("/seed-preview")
    def seed_preview():
        return {
            "status": "ok",
            "count": len(traders_data),
            "traders": [t["name"] for t in traders_data[:20]],
        }

    return router