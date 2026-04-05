# ============================================================
# app/services/pricing.py
# Ценообразование:
# - базовая цена предмета
# - цена покупки игроком у торговца
# - цена продажи игроком торговцу
# - debug payload для фронта / отладки
#
# ВАЖНО:
# Сейчас делаем логику прозрачной и рабочей.
# Позже сюда легко докручиваются:
# - trader skill
# - trader class
# - scarcity
# - regional modifier
# - quest / faction bonus
# ============================================================

from __future__ import annotations

from dataclasses import dataclass

from .money import (
    copper_to_split,
    format_split_price,
    split_to_copper,
)

# ============================================================
# ⚙️ БАЗОВЫЕ НАСТРОЙКИ ЭКОНОМИКИ
# ============================================================

# Базовая наценка на покупку у торговца:
# игрок платит дороже базовой цены
BASE_BUY_MARKUP = 1.20

# Базовая цена выкупа у игрока:
# торговец покупает дешевле базовой цены
BASE_SELL_RATIO = 0.45

# Влияние репутации на цену покупки:
# каждая единица reputation немного снижает цену покупки
BUY_REPUTATION_STEP = 0.02

# Влияние репутации на цену продажи:
# каждая единица reputation немного повышает цену выкупа
SELL_REPUTATION_STEP = 0.015

# Ограничители, чтобы экономика не ломалась
MIN_BUY_MULTIPLIER = 0.75
MAX_BUY_MULTIPLIER = 1.60

MIN_SELL_MULTIPLIER = 0.10
MAX_SELL_MULTIPLIER = 0.80

# ============================================================
# 🧾 СЛУЖЕБНАЯ СТРУКТУРА
# ============================================================


@dataclass
class PriceComputation:
    """
    Внутреннее представление вычисленной цены.
    """
    base_cp: int
    multiplier: float
    final_cp: int


# ============================================================
# 🧰 HELPERS
# ============================================================

def clamp(value: float, min_value: float, max_value: float) -> float:
    """
    Ограничить число диапазоном.
    """
    return max(min_value, min(max_value, value))


def normalize_reputation(reputation: int | None) -> int:
    """
    Нормализуем reputation.
    """
    try:
        return int(reputation or 0)
    except (TypeError, ValueError):
        return 0


def split_price_to_cp(
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
) -> int:
    """
    Базовая цена в total copper.
    """
    return split_to_copper(
        gold=int(base_gold or 0),
        silver=int(base_silver or 0),
        copper=int(base_copper or 0),
    )


def cp_to_split_payload(total_cp: int) -> dict:
    """
    Преобразовать copper в payload.
    """
    gold, silver, copper = copper_to_split(total_cp)

    return {
        "cp_total": int(total_cp or 0),
        "gold": gold,
        "silver": silver,
        "copper": copper,
        "label": format_split_price(gold, silver, copper),
    }


# ============================================================
# 💰 MULTIPLIERS
# ============================================================

def get_buy_multiplier(trader_reputation: int = 0) -> float:
    """
    Множитель покупки:
    чем выше reputation, тем дешевле игрок покупает.
    """
    rep = normalize_reputation(trader_reputation)

    multiplier = BASE_BUY_MARKUP - (rep * BUY_REPUTATION_STEP)
    multiplier = clamp(
        multiplier,
        MIN_BUY_MULTIPLIER,
        MAX_BUY_MULTIPLIER,
    )

    return round(multiplier, 4)


def get_sell_multiplier(trader_reputation: int = 0) -> float:
    """
    Множитель выкупа:
    чем выше reputation, тем выгоднее игрок продаёт.
    """
    rep = normalize_reputation(trader_reputation)

    multiplier = BASE_SELL_RATIO + (rep * SELL_REPUTATION_STEP)
    multiplier = clamp(
        multiplier,
        MIN_SELL_MULTIPLIER,
        MAX_SELL_MULTIPLIER,
    )

    return round(multiplier, 4)


# ============================================================
# 🛒 BUY PRICE
# ============================================================

def calculate_buy_price_cp(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> int:
    """
    Считает цену покупки в copper.
    """
    base_cp = split_price_to_cp(
        base_gold=base_gold,
        base_silver=base_silver,
        base_copper=base_copper,
    )

    multiplier = get_buy_multiplier(trader_reputation)
    final_cp = int(round(base_cp * multiplier))

    return max(0, final_cp)


def calculate_buy_price_split(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> dict:
    """
    Считает цену покупки в split-виде.
    """
    total_cp = calculate_buy_price_cp(
        base_gold=base_gold,
        base_silver=base_silver,
        base_copper=base_copper,
        trader_reputation=trader_reputation,
    )

    gold, silver, copper = copper_to_split(total_cp)

    return {
        "cp_total": total_cp,
        "gold": gold,
        "silver": silver,
        "copper": copper,
        "label": format_split_price(gold, silver, copper),
        "multiplier": get_buy_multiplier(trader_reputation),
    }


# ============================================================
# 💸 SELL PRICE
# ============================================================

def calculate_sell_price_cp(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> int:
    """
    Считает цену продажи в copper.
    """
    base_cp = split_price_to_cp(
        base_gold=base_gold,
        base_silver=base_silver,
        base_copper=base_copper,
    )

    multiplier = get_sell_multiplier(trader_reputation)
    final_cp = int(round(base_cp * multiplier))

    return max(0, final_cp)


def calculate_sell_price_split(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> dict:
    """
    Считает цену продажи в split-виде.
    """
    total_cp = calculate_sell_price_cp(
        base_gold=base_gold,
        base_silver=base_silver,
        base_copper=base_copper,
        trader_reputation=trader_reputation,
    )

    gold, silver, copper = copper_to_split(total_cp)

    return {
        "cp_total": total_cp,
        "gold": gold,
        "silver": silver,
        "copper": copper,
        "label": format_split_price(gold, silver, copper),
        "multiplier": get_sell_multiplier(trader_reputation),
    }


# ============================================================
# 🔍 DEBUG / ОБЪЯСНЕНИЕ ЦЕНЫ
# ============================================================

def build_price_debug(
    *,
    buy_price: dict,
    sell_price: dict,
) -> dict:
    """
    Готовый debug payload для фронта.
    """
    return {
        "buy": {
            "cp_total": buy_price.get("cp_total", 0),
            "gold": buy_price.get("gold", 0),
            "silver": buy_price.get("silver", 0),
            "copper": buy_price.get("copper", 0),
            "label": buy_price.get("label", "0м"),
            "multiplier": buy_price.get("multiplier", 1.0),
        },
        "sell": {
            "cp_total": sell_price.get("cp_total", 0),
            "gold": sell_price.get("gold", 0),
            "silver": sell_price.get("silver", 0),
            "copper": sell_price.get("copper", 0),
            "label": sell_price.get("label", "0м"),
            "multiplier": sell_price.get("multiplier", 1.0),
        },
        "summary": {
            "spread_cp": int(buy_price.get("cp_total", 0)) - int(sell_price.get("cp_total", 0)),
            "spread_label": format_cp_or_zero(
                int(buy_price.get("cp_total", 0)) - int(sell_price.get("cp_total", 0))
            ),
        },
    }


def format_cp_or_zero(total_cp: int) -> str:
    """
    Форматирование arbitrary cp.
    """
    if total_cp <= 0:
        return "0м"

    gold, silver, copper = copper_to_split(total_cp)
    return format_split_price(gold, silver, copper)


# ============================================================
# 📦 OPTIONAL ADVANCED API
# На будущее: удобно для расширения, но уже рабочее сейчас.
# ============================================================

def compute_buy_price(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> PriceComputation:
    """
    Возвращает полное вычисление buy price.
    """
    base_cp = split_price_to_cp(
        base_gold=base_gold,
        base_silver=base_silver,
        base_copper=base_copper,
    )
    multiplier = get_buy_multiplier(trader_reputation)
    final_cp = int(round(base_cp * multiplier))

    return PriceComputation(
        base_cp=base_cp,
        multiplier=multiplier,
        final_cp=max(0, final_cp),
    )


def compute_sell_price(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> PriceComputation:
    """
    Возвращает полное вычисление sell price.
    """
    base_cp = split_price_to_cp(
        base_gold=base_gold,
        base_silver=base_silver,
        base_copper=base_copper,
    )
    multiplier = get_sell_multiplier(trader_reputation)
    final_cp = int(round(base_cp * multiplier))

    return PriceComputation(
        base_cp=base_cp,
        multiplier=multiplier,
        final_cp=max(0, final_cp),
    )