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


def _text_key(value) -> str:
    """
    Нормализатор для сравнений категорий/редкостей.
    Нужен из-за смеси русских UI-категорий, старых english keys и BG3-экспортов.
    """
    text = str(value or "").strip().lower().replace("ё", "е")
    for ch in ("_", "-", "/", "\\", ",", ";", ":", "|", ".", "(", ")", "[", "]", "{", "}"):
        text = text.replace(ch, " ")
    return " ".join(text.split())


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
    - ui_category / category_clean
    - base_category
    - category
    """
    category = (
        raw.get("ui_category")
        or raw.get("category_clean")
        or raw.get("base_category")
        or raw.get("category")
        or "misc"
    )
    return str(category).strip().lower() or "misc"


def _extract_subcategory(raw: dict) -> str:
    return (
        raw.get("display_group")
        or raw.get("subcategory")
        or raw.get("source_category")
        or raw.get("item_subtype")
        or ""
    )


def _extract_description(raw: dict) -> str:
    description = raw.get("description")

    if isinstance(description, dict):
        return (
            description.get("full_text")
            or description.get("mechanics")
            or description.get("summary")
            or description.get("flavour")
            or ""
        )

    return (
        description
        or raw.get("description_ru")
        or raw.get("desc")
        or ""
    )


def _extract_weight(raw: dict) -> float:
    weight_obj = raw.get("weight")
    if isinstance(weight_obj, dict):
        return _to_float(weight_obj.get("value", 0.0), 0.0)

    return _to_float(
        weight_obj
        if weight_obj not in (None, "")
        else raw.get("weight_lb", 0.0),
        0.0,
    )


def _extract_attunement(raw: dict) -> bool:
    att = raw.get("attunement", False)

    if isinstance(att, dict):
        return _normalize_bool(att.get("required", False))

    equip = raw.get("equip")
    if isinstance(equip, dict) and "attunement" in equip:
        return _normalize_bool(equip.get("attunement"), False)

    return _normalize_bool(att, False)


def _extract_is_magical(raw: dict) -> bool:
    if "is_magical" in raw:
        return _normalize_bool(raw.get("is_magical"), False)
    if "is_magic" in raw:
        return _normalize_bool(raw.get("is_magic"), False)

    flags = raw.get("flags")
    if isinstance(flags, dict):
        return _normalize_bool(flags.get("magical"), False)
    if isinstance(flags, list):
        return "magical" in {_text_key(flag) for flag in flags}

    return False


def _extract_properties(raw: dict) -> dict:
    props = _normalize_dict(raw.get("properties"))
    if props:
        return props

    tags = _normalize_list(raw.get("tags"))
    damage_types = _normalize_list(raw.get("damage_types"))
    mechanics = _normalize_dict(raw.get("mechanics"))
    links = _normalize_dict(raw.get("links"))
    flags = _normalize_dict(raw.get("flags"))
    trading = _normalize_dict(raw.get("trading"))

    derived = {}
    if tags:
        derived["tags"] = tags
    if damage_types:
        derived["damage_types"] = damage_types
    if mechanics:
        derived["mechanics"] = mechanics
    if links:
        derived["links"] = links
    if flags:
        derived["flags"] = flags
    if trading:
        derived["trading"] = trading

    return derived


def _extract_requirements(raw: dict) -> dict:
    requirements = _normalize_dict(raw.get("requirements"))
    if requirements:
        return requirements

    mechanics = _normalize_dict(raw.get("mechanics"))
    if isinstance(mechanics.get("requirements"), list):
        return {"requirements": mechanics.get("requirements")}

    return {}


# ============================================================
# STOCK RULES
# ============================================================

TRADE_SKILL_RULES = {
    "новичок": {
        "count_bonus": 0,
        "rarity_bonus": 0,
        "quantity_bonus": 0,
    },
    "подмастерье": {
        "count_bonus": 2,
        "rarity_bonus": 0,
        "quantity_bonus": 0,
    },
    "умелый": {
        "count_bonus": 4,
        "rarity_bonus": 0,
        "quantity_bonus": 1,
    },
    "опытный": {
        "count_bonus": 6,
        "rarity_bonus": 1,
        "quantity_bonus": 1,
    },
    "мастер": {
        "count_bonus": 8,
        "rarity_bonus": 1,
        "quantity_bonus": 2,
    },
}

TYPE_STOCK_RULES = {
    "оружие и броня": {
        "base_count": 10,
        "max_count": 24,
        "type_rarity_cap": 5,
        "groups": {"weapon", "armor", "tool", "crafting", "combat_consumable"},
        "fallback_groups": {"weapon", "armor", "tool"},
    },
    "одежда и кожа": {
        "base_count": 8,
        "max_count": 20,
        "type_rarity_cap": 4,
        "groups": {"clothing", "armor", "accessory", "tool", "crafting", "misc"},
        "fallback_groups": {"clothing", "tool", "misc"},
    },
    "еда и ночлег": {
        "base_count": 6,
        "max_count": 16,
        "type_rarity_cap": 2,
        "groups": {"supply", "food", "drink", "tool", "misc"},
        "fallback_groups": {"supply", "food", "drink", "misc"},
    },
    "товары и редкости": {
        "base_count": 9,
        "max_count": 22,
        "type_rarity_cap": 4,
        "groups": {"misc", "tool", "accessory", "book", "scroll", "supply", "crafting"},
        "fallback_groups": {"misc", "tool", "supply"},
    },
    "ремесло и транспорт": {
        "base_count": 8,
        "max_count": 18,
        "type_rarity_cap": 3,
        "groups": {"tool", "supply", "misc", "crafting", "material"},
        "fallback_groups": {"tool", "supply", "misc"},
    },
    "травы и алхимия": {
        "base_count": 9,
        "max_count": 22,
        "type_rarity_cap": 4,
        "groups": {"potion", "poison", "alchemy", "ingredient", "crafting", "combat_consumable"},
        "fallback_groups": {"potion", "alchemy", "ingredient"},
    },
    "река и контрабанда": {
        "base_count": 7,
        "max_count": 18,
        "type_rarity_cap": 3,
        "groups": {"supply", "tool", "misc", "food", "drink", "combat_consumable", "accessory"},
        "fallback_groups": {"supply", "tool", "misc"},
    },
}

CATEGORY_GROUP_ALIASES = {
    "weapon": {
        "weapon", "weapons", "оружие", "мечи", "кинжалы", "топоры", "луки", "арбалеты",
        "молоты и булавы", "копья и древковое", "посохи", "боевое оружие",
    },
    "armor": {
        "armor", "armour", "броня", "доспехи", "shield", "shields", "щиты", "щит",
        "легкая броня", "средняя броня", "тяжелая броня", "особая броня",
    },
    "clothing": {
        "clothing", "clothes", "wearable", "wearables", "одежда", "мантии", "плащи",
        "головные уборы", "перчатки", "обувь", "нижняя одежда", "camp clothes", "robe", "cloak",
    },
    "accessory": {
        "accessory", "accessories", "jewelry", "jewellery", "украшения", "кольца", "амулеты",
        "ожерелья", "подвески", "броши", "талисманы", "реликвии", "ценности",
    },
    "combat_consumable": {
        "arrows", "arrow", "bolts", "bombs", "grenades", "throwable", "throwables",
        "стрелы гранаты", "стрелы", "болты", "бомбы", "гранаты", "метательные склянки",
        "боевые расходники", "ammunition", "ammo", "acid flask", "alchemist fire",
    },
    "tool": {
        "tool", "tools", "инструменты", "наборы", "kits", "kit", "utility", "utility tool",
        "воровские инструменты", "музыкальные инструменты", "ремесленные инструменты", "освещение",
        "контейнеры", "лагерные инструменты", "lockpick", "shovel",
    },
    "potion": {
        "potion", "potions", "potion elixirs", "potions elixirs", "зелья яды", "зелья",
        "зелья лечения", "зелья баффов", "эликсиры", "противоядия", "особые растворы",
    },
    "poison": {
        "poison", "poisons", "яды", "масла", "покрытия", "coating", "coatings", "oil", "oils",
    },
    "alchemy": {
        "alchemy", "алхимия", "алхимические применения", "алхимические throwable", "алхимический огонь",
    },
    "ingredient": {
        "ingredient", "ingredients", "ингредиенты экстракты", "ингредиенты", "экстракты", "травы", "грибы",
        "минералы", "части существ", "эссенции", "реагенты", "редкие компоненты", "alchemy component",
    },
    "crafting": {
        "crafting", "craft", "крафт", "крафтовое", "компоненты", "materials", "material", "материалы",
        "сырье", "ремесло",
    },
    "book": {
        "book", "books", "readable", "readables", "книги записки", "книги", "дневники", "письма",
        "записки", "таблички", "карты схемы", "лорные документы", "квестовые документы", "рецепты",
    },
    "scroll": {
        "scroll", "scrolls", "свитки", "spell scroll", "spell scrolls", "магические свитки",
        "ритуальные свитки",
    },
    "supply": {
        "supply", "supplies", "camp supply", "camp supplies", "припасы", "лагерные припасы",
        "рационы", "бытовые расходники", "survival supply", "household consumable",
    },
    "food": {
        "food", "еда", "кулинария", "мясо", "птица", "хлеб", "ration", "rations",
    },
    "drink": {
        "drink", "drinks", "напитки", "алкоголь", "эль", "вино", "пиво", "water", "водa", "вода",
    },
    "misc": {
        "misc", "other", "остальное", "хлам", "junk", "valuable", "valuables", "трофеи", "ключи",
        "сюжетные предметы", "квестовые предметы", "world objects", "декор", "бытовые предметы",
    },
}

RARITY_ALIASES = {
    "trash": 0,
    "junk": 0,
    "мусор": 0,
    "хлам": 0,
    "common": 1,
    "обычный": 1,
    "обычная": 1,
    "обычное": 1,
    "uncommon": 2,
    "необычный": 2,
    "необычная": 2,
    "необычное": 2,
    "rare": 3,
    "редкий": 3,
    "редкая": 3,
    "редкое": 3,
    "very rare": 4,
    "veryrare": 4,
    "очень редкий": 4,
    "очень редкая": 4,
    "очень редкое": 4,
    "epic": 5,
    "эпический": 5,
    "эпическая": 5,
    "эпическое": 5,
    "legendary": 6,
    "легендарный": 6,
    "легендарная": 6,
    "легендарное": 6,
    "artifact": 7,
    "артефакт": 7,
    "quest": 8,
    "квестовый": 8,
    "квестовая": 8,
    "story": 8,
    "сюжетный": 8,
    "сюжетная": 8,
    "unknown": 1,
    "неизвестно": 1,
}

STORY_LOCK_WORDS = {
    "artifact", "артефакт", "legendary", "легендар", "quest", "квест", "story", "сюжет",
    "fixed story", "fixed story item", "gm only", "not tradeable", "не продается", "не продаётся",
}


def _extract_trade_skill_label(trader: Trader) -> str:
    abilities = _normalize_list(getattr(trader, "abilities", []))

    for ability in abilities:
        text = str(ability or "").strip()
        key = _text_key(text)
        if key.startswith("навык торговли"):
            if ":" in text:
                label = text.split(":", 1)[1].strip()
                if label:
                    return label
            if "мастер" in key:
                return "Мастер"
            if "опытный" in key:
                return "Опытный"
            if "умелый" in key:
                return "Умелый"
            if "подмастерье" in key:
                return "Подмастерье"
            if "новичок" in key:
                return "Новичок"

    level = _to_int(getattr(trader, "trader_level", 1), 1)
    if level >= 7:
        return "Опытный"
    if level >= 5:
        return "Умелый"
    if level >= 3:
        return "Подмастерье"
    return "Новичок"


def _trade_skill_rule(trader: Trader) -> dict:
    label = _text_key(_extract_trade_skill_label(trader))
    return TRADE_SKILL_RULES.get(label, TRADE_SKILL_RULES["новичок"])


def _item_category_groups(item: Item) -> set[str]:
    haystack = {
        _text_key(getattr(item, "category", "")),
        _text_key(getattr(item, "subcategory", "")),
    }

    properties = _normalize_dict(getattr(item, "properties", {}))
    for tag in _normalize_list(properties.get("tags")):
        haystack.add(_text_key(tag))

    groups: set[str] = set()

    for group, aliases in CATEGORY_GROUP_ALIASES.items():
        normalized_aliases = {_text_key(alias) for alias in aliases}
        for token in haystack:
            if not token:
                continue
            if token in normalized_aliases:
                groups.add(group)
                continue
            if any(alias and alias in token for alias in normalized_aliases):
                groups.add(group)

    return groups or {"misc"}


def _item_rarity_tier(item: Item) -> int:
    tier = _to_int(getattr(item, "rarity_tier", 0), 0)
    if tier > 0:
        return tier

    rarity = _text_key(getattr(item, "rarity", "common"))
    if rarity in RARITY_ALIASES:
        return RARITY_ALIASES[rarity]

    # Ловим варианты вроде very_rare после _text_key -> very rare.
    if "very" in rarity and "rare" in rarity:
        return 4
    if "очень" in rarity and "ред" in rarity:
        return 4
    if "legend" in rarity or "легендар" in rarity:
        return 6
    if "artifact" in rarity or "артефакт" in rarity:
        return 7
    if "epic" in rarity or "эпич" in rarity:
        return 5
    if "rare" in rarity or "ред" in rarity:
        return 3
    if "uncommon" in rarity or "необыч" in rarity:
        return 2

    return 1


def _item_story_locked(item: Item) -> bool:
    rarity_tier = _item_rarity_tier(item)
    if rarity_tier >= 6:
        return True

    properties = _normalize_dict(getattr(item, "properties", {}))
    flags = _normalize_dict(properties.get("flags"))
    trading = _normalize_dict(properties.get("trading"))

    if _normalize_bool(flags.get("story"), False):
        return True
    if _normalize_bool(flags.get("quest"), False):
        return True
    if _normalize_bool(flags.get("fixed_story_item"), False):
        return True
    if _normalize_bool(flags.get("tradeable"), True) is False:
        return True
    if _normalize_bool(trading.get("tradeable"), True) is False:
        return True

    text = _text_key(
        " ".join(
            [
                str(getattr(item, "rarity", "") or ""),
                str(getattr(item, "category", "") or ""),
                str(getattr(item, "subcategory", "") or ""),
                str(getattr(item, "description", "") or ""),
                json.dumps(properties, ensure_ascii=False, default=str),
            ]
        )
    )

    return any(word in text for word in STORY_LOCK_WORDS)


def _trader_type_key(trader: Trader) -> str:
    return _text_key(getattr(trader, "type", ""))


def _trader_stock_rule(trader: Trader) -> dict:
    trader_type = _trader_type_key(trader)
    return TYPE_STOCK_RULES.get(
        trader_type,
        {
            "base_count": 7,
            "max_count": 16,
            "type_rarity_cap": 3,
            "groups": {"misc", "tool", "supply"},
            "fallback_groups": {"misc", "tool", "supply"},
        },
    )


def _trader_rarity_cap(trader: Trader) -> int:
    level = _to_int(getattr(trader, "trader_level", 1), 1)
    skill = _trade_skill_rule(trader)
    type_rule = _trader_stock_rule(trader)

    if level <= 2:
        level_cap = 2
    elif level <= 4:
        level_cap = 3
    elif level <= 6:
        level_cap = 4
    else:
        level_cap = 5

    # Навык торговли чуть помогает доставать лучшее, но не пробивает сюжетные запреты.
    cap = level_cap + _to_int(skill.get("rarity_bonus", 0), 0)
    cap = min(cap, _to_int(type_rule.get("type_rarity_cap", 3), 3))

    # Legendary/artifact/story никогда не попадают в random stock этим relink-pass.
    return max(1, min(cap, 5))


def _trader_stock_count(trader: Trader) -> int:
    type_rule = _trader_stock_rule(trader)
    skill = _trade_skill_rule(trader)
    level = _to_int(getattr(trader, "trader_level", 1), 1)

    base = _to_int(type_rule.get("base_count", 7), 7)
    max_count = _to_int(type_rule.get("max_count", 16), 16)
    count = base + _to_int(skill.get("count_bonus", 0), 0) + max(0, level // 2)

    return max(4, min(count, max_count))


def _allowed_item_for_trader(item: Item, trader: Trader, groups: set[str], rarity_cap: int) -> bool:
    if _item_story_locked(item):
        return False

    item_groups = _item_category_groups(item)
    if not item_groups.intersection(groups):
        return False

    return _item_rarity_tier(item) <= rarity_cap


def _weighted_stock_pool(items: list[Item], trader: Trader) -> list[Item]:
    type_rule = _trader_stock_rule(trader)
    rarity_cap = _trader_rarity_cap(trader)
    groups = set(type_rule.get("groups", set()))
    fallback_groups = set(type_rule.get("fallback_groups", groups))

    primary_pool = [
        item for item in items
        if _allowed_item_for_trader(item, trader, groups, rarity_cap)
    ]

    if primary_pool:
        return primary_pool

    # Безопасный fallback: только профильные common/uncommon, а не старое pool = items[:].
    fallback_pool = [
        item for item in items
        if _allowed_item_for_trader(item, trader, fallback_groups, min(rarity_cap, 2))
    ]

    return fallback_pool


def _stock_sort_weight(item: Item, trader: Trader) -> tuple[int, int, str]:
    """
    Чем меньше tuple, тем раньше предмет попадёт в выборку.
    Добавляем случайность, но слегка предпочитаем профильную и не слишком редкую базу.
    """
    tier = _item_rarity_tier(item)
    item_groups = _item_category_groups(item)
    preferred_groups = set(_trader_stock_rule(trader).get("groups", set()))
    group_penalty = 0 if item_groups.intersection(preferred_groups) else 1
    rarity_penalty = max(0, tier - 2)
    return (
        group_penalty,
        rarity_penalty,
        str(getattr(item, "name", "") or ""),
    )


def _stock_quantity(item: Item, trader: Trader) -> int:
    tier = _item_rarity_tier(item)
    groups = _item_category_groups(item)
    skill = _trade_skill_rule(trader)
    skill_bonus = _to_int(skill.get("quantity_bonus", 0), 0)

    if tier >= 4:
        return 1
    if tier == 3:
        return random.randint(1, 2)

    if groups.intersection({"food", "drink", "supply"}):
        return random.randint(2, 8 + skill_bonus)
    if groups.intersection({"potion", "poison", "combat_consumable"}):
        return random.randint(1, 5 + skill_bonus)
    if groups.intersection({"ingredient", "crafting"}):
        return random.randint(2, 6 + skill_bonus)
    if groups.intersection({"weapon", "armor", "accessory", "scroll"}):
        return random.randint(1, 2 + min(skill_bonus, 1))

    return random.randint(1, 4 + skill_bonus)


def _stock_discount(item: Item, trader: Trader) -> int:
    """
    Персональная репутация аккаунта будет отдельной фичей.
    Здесь скидку не разгоняем: seed/relink отвечает за ассортимент, не за отношение к игроку.
    """
    return 0


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
        abilities = _normalize_list(raw.get("abilities", []) or [])
        trade_skill = _normalize_dict(raw.get("trade_skill", {}))
        trade_skill_label = str(trade_skill.get("label", "") or "").strip()

        if trade_skill_label:
            skill_ability = f"Навык торговли: {trade_skill_label}"
            if not any(_text_key(ability).startswith("навык торговли") for ability in abilities):
                abilities.insert(0, skill_ability)

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
            abilities=abilities,
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
        pool = _weighted_stock_pool(items, trader)
        stock_count = _trader_stock_count(trader)

        if not pool:
            continue

        random.shuffle(pool)
        pool = sorted(pool, key=lambda item: _stock_sort_weight(item, trader))
        chosen = pool[: min(len(pool), stock_count)]

        for item in chosen:
            tier = _item_rarity_tier(item)
            slot = TraderItem(
                trader_id=trader.id,
                item_id=item.id,
                price_gold=_to_int(item.price_gold, 0),
                price_silver=_to_int(item.price_silver, 0),
                price_copper=_to_int(item.price_copper, 0),
                quantity=_stock_quantity(item, trader),
                discount=_stock_discount(item, trader),
                is_limited=tier >= 3,
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
