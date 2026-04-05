from __future__ import annotations

from typing import Any

from .money import split_to_copper, copper_to_split

TRADER_CATEGORY_BONUSES: dict[str, dict[str, float]] = {
    "кузнец": {"weapon": 1.10, "armor": 1.10, "tools": 1.05},
    "оружейник": {"weapon": 1.15, "armor": 1.05},
    "портной": {"accessory": 1.10, "armor": 1.00},
    "трактирщик": {"food_drink": 1.15, "consumables": 1.05, "potions_elixirs": 1.00},
    "торговец": {"misc": 1.05, "accessory": 1.05, "scrolls_books": 1.05},
}

RARITY_BUY_MOD = {0: 1.00, 1: 1.10, 2: 1.20, 3: 1.35, 4: 1.55, 5: 1.80}
RARITY_SELL_MOD = {0: 1.00, 1: 1.03, 2: 1.06, 3: 1.10, 4: 1.15, 5: 1.20}

QUALITY_BUY_MOD = {"стандартное": 1.00, "хорошее": 1.10, "отличное": 1.20}
QUALITY_SELL_MOD = {"стандартное": 1.00, "хорошее": 1.05, "отличное": 1.10}

def normalize_reputation(rep: Any) -> int:
    try:
        return max(0, min(100, int(rep or 0)))
    except:
        return 0

def get_buy_reputation_modifier(reputation: int) -> float:
    rep = normalize_reputation(reputation)
    return 1.0 - (rep * 0.002)  # 0% скидка при 0, 20% при 100

def get_sell_reputation_modifier(reputation: int) -> float:
    rep = normalize_reputation(reputation)
    return 1.0 + (rep * 0.003)  # 0% бонус при 0, 30% при 100

def get_rarity_buy_modifier(item: Any) -> float:
    return RARITY_BUY_MOD.get(getattr(item, "rarity_tier", 0), 1.00)

def get_rarity_sell_modifier(item: Any) -> float:
    return RARITY_SELL_MOD.get(getattr(item, "rarity_tier", 0), 1.00)

def get_quality_buy_modifier(item: Any) -> float:
    q = getattr(item, "quality", "стандартное") or "стандартное"
    return QUALITY_BUY_MOD.get(q, 1.00)

def get_quality_sell_modifier(item: Any) -> float:
    q = getattr(item, "quality", "стандартное") or "стандартное"
    return QUALITY_SELL_MOD.get(q, 1.00)

def get_item_base_price_cp(item: Any) -> int:
    g = getattr(item, "price_gold", 0) or 0
    s = getattr(item, "price_silver", 0) or 0
    c = getattr(item, "price_copper", 0) or 0
    return split_to_copper(g, s, c)

def get_trader_markup_modifier(trader: Any) -> float:
    ttype = (getattr(trader, "type", "") or "").strip().lower()
    markups = {"кузнец": 1.20, "оружейник": 1.25, "портной": 1.15, "трактирщик": 1.15, "торговец": 1.22}
    return markups.get(ttype, 1.20)

def get_trader_buyback_modifier(trader: Any) -> float:
    ttype = (getattr(trader, "type", "") or "").strip().lower()
    buybacks = {"кузнец": 0.42, "оружейник": 0.45, "портной": 0.40, "трактирщик": 0.30, "торговец": 0.37}
    return buybacks.get(ttype, 0.35)

def get_category_affinity_modifier(trader: Any, item: Any) -> float:
    ttype = (getattr(trader, "type", "") or "").strip().lower()
    category = getattr(item, "category", "misc") or "misc"
    bonuses = TRADER_CATEGORY_BONUSES.get(ttype, {})
    return bonuses.get(category, 1.00)

def calculate_buy_price_cp(item: Any, trader: Any, reputation: int | None = None) -> int:
    rep = normalize_reputation(reputation if reputation is not None else getattr(trader, "reputation", 0))
    base = get_item_base_price_cp(item)
    markup = get_trader_markup_modifier(trader)
    rarity_mod = get_rarity_buy_modifier(item)
    quality_mod = get_quality_buy_modifier(item)
    rep_mod = get_buy_reputation_modifier(rep)
    result = base * markup * rarity_mod * quality_mod * rep_mod
    return max(1, int(round(result)))

def calculate_sell_price_cp(item: Any, trader: Any, reputation: int | None = None) -> int:
    rep = normalize_reputation(reputation if reputation is not None else getattr(trader, "reputation", 0))
    base = get_item_base_price_cp(item)
    buyback = get_trader_buyback_modifier(trader)
    affinity = get_category_affinity_modifier(trader, item)
    rarity_mod = get_rarity_sell_modifier(item)
    quality_mod = get_quality_sell_modifier(item)
    rep_mod = get_sell_reputation_modifier(rep)
    result = base * buyback * affinity * rarity_mod * quality_mod * rep_mod
    return max(1, int(round(result)))

def build_price_debug(item: Any, trader: Any, reputation: int | None = None) -> dict[str, Any]:
    rep = normalize_reputation(reputation if reputation is not None else getattr(trader, "reputation", 0))
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