# app/services/pricing.py
from __future__ import annotations

from typing import Any

from .money import split_to_copper, copper_to_split


# ------------------------------------------------------------
# CATEGORY AFFINITY
# ------------------------------------------------------------

TRADER_CATEGORY_BONUSES: dict[str, dict[str, float]] = {
    "кузнец": {
        "weapon": 1.10,
        "armor": 1.10,
        "tools": 1.05,
    },
    "оружейник": {
        "weapon": 1.15,
        "armor": 1.05,
    },
    "бронник": {
        "armor": 1.15,
        "weapon": 1.00,
    },
    "алхимик": {
        "potions_elixirs": 1.15,
        "alchemy": 1.15,
        "consumables": 1.05,
    },
    "друид-травница": {
        "potions_elixirs": 1.10,
        "alchemy": 1.10,
        "accessory": 1.00,
    },
    "библиотекарь": {
        "scrolls_books": 1.15,
    },
    "картограф": {
        "scrolls_books": 1.10,
        "tools": 1.10,
    },
    "портной": {
        "accessory": 1.10,
        "armor": 1.00,
    },
    "кожевник": {
        "armor": 1.10,
        "accessory": 1.05,
    },
    "торговец": {
        "misc": 1.05,
        "accessory": 1.05,
        "scrolls_books": 1.05,
    },
    "старьёвщик": {
        "misc": 1.10,
        "accessory": 1.05,
    },
    "трактирщик": {
        "food_drink": 1.15,
        "consumables": 1.05,
        "potions_elixirs": 1.00,
    },
    "тавернщик": {
        "food_drink": 1.15,
        "consumables": 1.05,
    },
}


RARITY_BUY_MOD: dict[int, float] = {
    0: 1.00,
    1: 1.10,
    2: 1.20,
    3: 1.35,
    4: 1.55,
    5: 1.80,
}

RARITY_SELL_MOD: dict[int, float] = {
    0: 1.00,
    1: 1.03,
    2: 1.06,
    3: 1.10,
    4: 1.15,
    5: 1.20,
}

QUALITY_BUY_MOD: dict[str, float] = {
    "poor": 0.85,
    "common": 1.00,
    "standard": 1.00,
    "good": 1.10,
    "excellent": 1.20,
    "masterwork": 1.35,
    "легендарное": 1.35,
    "отличное": 1.20,
    "хорошее": 1.10,
    "стандартное": 1.00,
    "обычное": 1.00,
    "плохое": 0.85,
}

QUALITY_SELL_MOD: dict[str, float] = {
    "poor": 0.70,
    "common": 1.00,
    "standard": 1.00,
    "good": 1.05,
    "excellent": 1.10,
    "masterwork": 1.20,
    "легендарное": 1.20,
    "отличное": 1.10,
    "хорошее": 1.05,
    "стандартное": 1.00,
    "обычное": 1.00,
    "плохое": 0.70,
}


# ------------------------------------------------------------
# REPUTATION
# ------------------------------------------------------------

def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def normalize_reputation(reputation: Any) -> int:
    try:
        rep = int(reputation or 0)
    except Exception:
        rep = 0
    return max(0, min(100, rep))


def get_buy_reputation_modifier(reputation: int) -> float:
    """
    Чем выше репутация, тем дешевле покупка у торговца.
    0   -> 1.00
    50  -> 0.90
    100 -> 0.80
    """
    reputation = normalize_reputation(reputation)
    return clamp(1.0 - (reputation * 0.002), 0.80, 1.00)


def get_sell_reputation_modifier(reputation: int) -> float:
    """
    Чем выше репутация, тем выгоднее игрок продаёт торговцу.
    0   -> 1.00
    50  -> 1.15
    100 -> 1.30
    """
    reputation = normalize_reputation(reputation)
    return clamp(1.0 + (reputation * 0.003), 1.00, 1.30)


# ------------------------------------------------------------
# LOOKUPS
# ------------------------------------------------------------

def normalize_quality_name(quality: Any) -> str:
    return str(quality or "standard").strip().lower()


def normalize_trader_type(trader_type: Any) -> str:
    return str(trader_type or "").strip().lower()


def get_rarity_tier(item: Any) -> int:
    try:
        return int(getattr(item, "rarity_tier", 0) or 0)
    except Exception:
        return 0


def get_item_category(item: Any) -> str:
    return str(getattr(item, "category", "misc") or "misc").strip().lower()


def get_item_quality(item: Any) -> str:
    return normalize_quality_name(getattr(item, "quality", "standard"))


def get_trader_type(trader: Any) -> str:
    return normalize_trader_type(getattr(trader, "type", ""))


def get_category_affinity_modifier(trader: Any, item: Any) -> float:
    trader_type = get_trader_type(trader)
    item_category = get_item_category(item)

    trader_bonuses = TRADER_CATEGORY_BONUSES.get(trader_type, {})
    return trader_bonuses.get(item_category, 1.00)


def get_rarity_buy_modifier(item: Any) -> float:
    return RARITY_BUY_MOD.get(get_rarity_tier(item), 1.00)


def get_rarity_sell_modifier(item: Any) -> float:
    return RARITY_SELL_MOD.get(get_rarity_tier(item), 1.00)


def get_quality_buy_modifier(item: Any) -> float:
    return QUALITY_BUY_MOD.get(get_item_quality(item), 1.00)


def get_quality_sell_modifier(item: Any) -> float:
    return QUALITY_SELL_MOD.get(get_item_quality(item), 1.00)


# ------------------------------------------------------------
# BASE PRICE EXTRACTION
# ------------------------------------------------------------

def get_item_base_price_cp(item: Any) -> int:
    """
    Пока используем текущую цену предмета как базовую.
    Позже сюда можно воткнуть отдельный base_price_cp из БД.
    """
    gold = int(getattr(item, "price_gold", 0) or 0)
    silver = int(getattr(item, "price_silver", 0) or 0)
    copper = int(getattr(item, "price_copper", 0) or 0)
    return split_to_copper(gold, silver, copper)


# ------------------------------------------------------------
# BUY / SELL ECONOMY
# ------------------------------------------------------------

def get_trader_markup_modifier(trader: Any) -> float:
    """
    Наценка торговца на продажу игроку.
    """
    trader_type = get_trader_type(trader)

    markups = {
        "кузнец": 1.20,
        "оружейник": 1.25,
        "бронник": 1.25,
        "алхимик": 1.30,
        "друид-травница": 1.25,
        "библиотекарь": 1.20,
        "картограф": 1.20,
        "портной": 1.15,
        "кожевник": 1.15,
        "старьёвщик": 1.18,
        "торговец": 1.22,
        "трактирщик": 1.15,
        "тавернщик": 1.15,
    }

    return markups.get(trader_type, 1.20)


def get_trader_buyback_modifier(trader: Any) -> float:
    """
    Коэффициент выкупа у игрока.
    ВАЖНО: всегда сильно ниже продажи.
    """
    trader_type = get_trader_type(trader)

    buybacks = {
        "кузнец": 0.42,
        "оружейник": 0.45,
        "бронник": 0.45,
        "алхимик": 0.40,
        "друид-травница": 0.40,
        "библиотекарь": 0.38,
        "картограф": 0.38,
        "портной": 0.40,
        "кожевник": 0.40,
        "старьёвщик": 0.35,
        "торговец": 0.37,
        "трактирщик": 0.30,
        "тавернщик": 0.30,
    }

    return buybacks.get(trader_type, 0.35)


def calculate_buy_price_cp(item: Any, trader: Any, reputation: int | None = None) -> int:
    """
    Цена, за которую игрок ПОКУПАЕТ у торговца.
    """
    rep = normalize_reputation(
        reputation if reputation is not None else getattr(trader, "reputation", 0)
    )

    base_cp = get_item_base_price_cp(item)
    markup_mod = get_trader_markup_modifier(trader)
    rarity_mod = get_rarity_buy_modifier(item)
    quality_mod = get_quality_buy_modifier(item)
    rep_mod = get_buy_reputation_modifier(rep)

    result = base_cp * markup_mod * rarity_mod * quality_mod * rep_mod
    return max(1, int(round(result)))


def calculate_sell_price_cp(item: Any, trader: Any, reputation: int | None = None) -> int:
    """
    Цена, за которую игрок ПРОДАЁТ торговцу.
    """
    rep = normalize_reputation(
        reputation if reputation is not None else getattr(trader, "reputation", 0)
    )

    base_cp = get_item_base_price_cp(item)
    buyback_mod = get_trader_buyback_modifier(trader)
    affinity_mod = get_category_affinity_modifier(trader, item)
    rarity_mod = get_rarity_sell_modifier(item)
    quality_mod = get_quality_sell_modifier(item)
    rep_mod = get_sell_reputation_modifier(rep)

    result = base_cp * buyback_mod * affinity_mod * rarity_mod * quality_mod * rep_mod
    return max(1, int(round(result)))


def calculate_buy_price_split(item: Any, trader: Any, reputation: int | None = None) -> tuple[int, int, int]:
    return copper_to_split(calculate_buy_price_cp(item, trader, reputation))


def calculate_sell_price_split(item: Any, trader: Any, reputation: int | None = None) -> tuple[int, int, int]:
    return copper_to_split(calculate_sell_price_cp(item, trader, reputation))


def build_price_debug(item: Any, trader: Any, reputation: int | None = None) -> dict[str, Any]:
    rep = normalize_reputation(
        reputation if reputation is not None else getattr(trader, "reputation", 0)
    )

    return {
        "base_price_cp": get_item_base_price_cp(item),
        "buy_markup_modifier": get_trader_markup_modifier(trader),
        "buy_reputation_modifier": get_buy_reputation_modifier(rep),
        "buy_rarity_modifier": get_rarity_buy_modifier(item),
        "buy_quality_modifier": get_quality_buy_modifier(item),
        "sell_buyback_modifier": get_trader_buyback_modifier(trader),
        "sell_affinity_modifier": get_category_affinity_modifier(trader, item),
        "sell_reputation_modifier": get_sell_reputation_modifier(rep),
        "sell_rarity_modifier": get_rarity_sell_modifier(item),
        "sell_quality_modifier": get_quality_sell_modifier(item),
    }
