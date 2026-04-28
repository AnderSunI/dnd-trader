from __future__ import annotations

import json
import random
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..models import Item, PartyGrant, PartyTraderAccess, Trader, TraderItem, User, UserItem
from ..seed_db import traders_data


# ============================================================
# HELPERS
# ============================================================

def require_admin_user(current_user: User = Depends(get_current_active_user)) -> User:
    role = str(current_user.role or "").strip().lower()
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Требуется роль admin",
        )
    return current_user


def _to_int(value, default: int = 0) -> int:
    try:
        if value in (None, "", False):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _to_float(value, default: float = 0.0) -> float:
    try:
        if value in (None, "", False):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_dict(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return {}
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _normalize_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else [value]
        except Exception:
            return [value]
    return []


def _normalize_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "да"}:
            return True
        if normalized in {"false", "0", "no", "n", "нет", ""}:
            return False
    return default


def _extract_price(raw: dict) -> tuple[int, int, int]:
    """
    Поддержка нескольких схем:
    1) price: {gold, silver, copper}
    2) price_gold / price_silver / price_copper
    3) value_gp
    """
    price_obj = raw.get("price", {})

    if isinstance(price_obj, dict):
        gold = _to_int(price_obj.get("gold", 0))
        silver = _to_int(price_obj.get("silver", 0))
        copper = _to_int(price_obj.get("copper", 0))

        if gold or silver or copper:
            return gold, silver, copper

    gold = _to_int(raw.get("price_gold", 0))
    silver = _to_int(raw.get("price_silver", 0))
    copper = _to_int(raw.get("price_copper", 0))

    if gold or silver or copper:
        return gold, silver, copper

    value_gp = _to_int(raw.get("value_gp", 0))
    if value_gp:
        return value_gp, 0, 0

    return 0, 0, 0


def _extract_category(raw: dict) -> str:
    """
    Поддержка разных источников:
    - category_clean
    - base_category
    - category
    """
    category = (
        raw.get("category_clean")
        or raw.get("base_category")
        or raw.get("category")
        or "misc"
    )
    return str(category).strip().lower() or "misc"


def _extract_subcategory(raw: dict) -> str:
    return (
        raw.get("subcategory")
        or raw.get("source_category")
        or ""
    )


def _extract_description(raw: dict) -> str:
    return (
        raw.get("description")
        or raw.get("description_ru")
        or raw.get("desc")
        or ""
    )


def _extract_weight(raw: dict) -> float:
    return _to_float(
        raw.get("weight")
        if raw.get("weight") not in (None, "")
        else raw.get("weight_lb", 0.0),
        0.0,
    )


def _extract_attunement(raw: dict) -> bool:
    att = raw.get("attunement", False)

    if isinstance(att, dict):
        return _normalize_bool(att.get("required", False))

    return _normalize_bool(att, False)


def _extract_is_magical(raw: dict) -> bool:
    if "is_magical" in raw:
        return _normalize_bool(raw.get("is_magical"), False)
    if "is_magic" in raw:
        return _normalize_bool(raw.get("is_magic"), False)
    return False


def _extract_properties(raw: dict) -> dict:
    props = _normalize_dict(raw.get("properties"))
    if props:
        return props

    tags = _normalize_list(raw.get("tags"))
    damage_types = _normalize_list(raw.get("damage_types"))

    derived = {}
    if tags:
        derived["tags"] = tags
    if damage_types:
        derived["damage_types"] = damage_types

    return derived


def _extract_requirements(raw: dict) -> dict:
    return _normalize_dict(raw.get("requirements"))


# ============================================================
# IMPORTERS
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

        price_gold, price_silver, price_copper = _extract_price(raw)

        item = Item(
            name=name,
            category=_extract_category(raw),
            subcategory=_extract_subcategory(raw),
            rarity=raw.get("rarity", "common") or "common",
            rarity_tier=_to_int(raw.get("rarity_tier", 0), 0),
            quality=raw.get("quality", "standard") or "standard",
            price_gold=price_gold,
            price_silver=price_silver,
            price_copper=price_copper,
            weight=_extract_weight(raw),
            description=_extract_description(raw),
            properties=_extract_properties(raw),
            requirements=_extract_requirements(raw),
            source=raw.get("source", "merged") or "merged",
            is_magical=_extract_is_magical(raw),
            attunement=_extract_attunement(raw),
            stock=_to_int(raw.get("stock", 5), 5) or 5,
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
            reputation=_to_int(raw.get("reputation", 0), 0),
            region=raw.get("region", "") or "",
            settlement=raw.get("settlement", "") or "",
            level_min=_to_int(raw.get("level_min", 1), 1),
            level_max=_to_int(raw.get("level_max", 10), 10),
            restock_days=_to_int(raw.get("restock_days", 4), 4),
            last_restock=raw.get("last_restock", "") or "",
            currency=raw.get("currency", "gold") or "gold",
            description=raw.get("description", "") or "",
            image_url=raw.get("image_url", "") or "",
            personality=raw.get("personality", "") or "",
            possessions=raw.get("possessions", []) or [],
            rumors=raw.get("rumors", "") or "",
            gold=_to_int(raw.get("gold", 0), 0),
            race=raw.get("race", "") or "",
            class_name=raw.get("class_name", "") or "",
            trader_level=_to_int(raw.get("trader_level", 1), 1),
            stats=raw.get("stats", {}) or {},
            abilities=raw.get("abilities", []) or [],
        )
        db.add(trader)
        imported_count += 1

    db.commit()
    return imported_count


def relink_all_items(db: Session) -> int:
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
                price_gold=_to_int(item.price_gold, 0),
                price_silver=_to_int(item.price_silver, 0),
                price_copper=_to_int(item.price_copper, 0),
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
# ROUTER FACTORY
# ============================================================

def create_admin_router(*, get_db, cleaned_items_path) -> APIRouter:
    router = APIRouter(prefix="/admin", tags=["admin"])

    def run_seed_reset(db: Session) -> dict:
        db.query(PartyGrant).delete()
        db.query(PartyTraderAccess).delete()
        db.query(UserItem).delete()
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

    @router.post("/reset")
    def reset_db(
        db: Session = Depends(get_db),
        _admin: User = Depends(require_admin_user),
    ):
        try:
            return run_seed_reset(db)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Ошибка reset: {exc}") from exc

    @router.post("/full-reset")
    def full_reset(
        db: Session = Depends(get_db),
        _admin: User = Depends(require_admin_user),
    ):
        try:
            return run_seed_reset(db)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Ошибка reset: {exc}") from exc

    @router.post("/relink-items")
    def relink_items(
        db: Session = Depends(get_db),
        _admin: User = Depends(require_admin_user),
    ):
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
    def seed_preview(_admin: User = Depends(require_admin_user)):
        return {
            "status": "ok",
            "count": len(traders_data),
            "traders": [t["name"] for t in traders_data[:20]],
        }

    return router
