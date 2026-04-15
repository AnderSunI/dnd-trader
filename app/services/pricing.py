from __future__ import annotations

from dataclasses import dataclass

from .money import (
    copper_to_split,
    format_split_price,
    split_to_copper,
)

# ============================================================
# ⚙️ ЭКОНОМИКА
# ============================================================
#
# Опора на две вещи:
# 1) old main:
#    price = base * (1 - reputation / 100)
#    то есть репутация просто снижала цену покупки у торговца.
#
# 2) текущая целевая логика пользователя:
#    - базовая цена предмета, например 150
#    - игрок покупает у торговца дешевле при хорошей репутации:
#      примерно до 100 за предмет ценой 150
#    - игрок продаёт торговцу по базе 50%
#      и до ~80 при хорошей репутации
#
# Поэтому вводим одну понятную модель:
# - reputation нормализуется в диапазон 0..100
# - buy multiplier:
#     от 1.00 (без репутации)
#     до 0.6667 (очень хорошая репутация)
# - sell multiplier:
#     от 0.50 (база)
#     до 0.80 (очень хорошая репутация)
#
# Это ближе к main, но уже соответствует новой задумке.

REPUTATION_MIN = 0
REPUTATION_MAX = 100

# Игрок покупает у торговца:
# 0 репутации  -> 100% базовой цены
# 100 репутации -> 66.67% базовой цены
BASE_BUY_MULTIPLIER = 1.00
BEST_BUY_MULTIPLIER = 2.0 / 3.0  # ~0.6667

# Игрок продаёт торговцу:
# 0 репутации  -> 50% базовой цены
# 100 репутации -> 80% базовой цены
BASE_SELL_MULTIPLIER = 0.50
BEST_SELL_MULTIPLIER = 0.80


# ============================================================
# 🧾 СЛУЖЕБНАЯ СТРУКТУРА
# ============================================================

@dataclass
class PriceComputation:
    """
    Полное вычисление цены.
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
    Нормализуем reputation к диапазону 0..100.

    В old main репутация использовалась как процент.
    """
    try:
        rep = int(reputation or 0)
    except (TypeError, ValueError):
        rep = 0

    return int(clamp(rep, REPUTATION_MIN, REPUTATION_MAX))


def reputation_ratio(reputation: int | None) -> float:
    """
    Репутация как доля от 0 до 1.
    """
    rep = normalize_reputation(reputation)
    return rep / 100.0


def split_price_to_cp(
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
) -> int:
    """
    Перевести split-цену в total copper.
    """
    return split_to_copper(
        gold=int(base_gold or 0),
        silver=int(base_silver or 0),
        copper=int(base_copper or 0),
    )


def cp_to_split_payload(total_cp: int) -> dict:
    """
    Преобразовать total copper в split payload.
    """
    total_cp = max(0, int(total_cp or 0))
    gold, silver, copper = copper_to_split(total_cp)

    return {
        "cp_total": total_cp,
        "gold": int(gold or 0),
        "silver": int(silver or 0),
        "copper": int(copper or 0),
        "label": format_split_price(gold, silver, copper),
    }


def format_cp_or_zero(total_cp: int) -> str:
    """
    Форматирование arbitrary cp.
    """
    total_cp = int(total_cp or 0)
    if total_cp <= 0:
        return "0м"

    gold, silver, copper = copper_to_split(total_cp)
    return format_split_price(gold, silver, copper)


# ============================================================
# 💰 MULTIPLIERS
# ============================================================

def get_buy_multiplier(trader_reputation: int = 0) -> float:
    """
    Множитель покупки игроком у торговца.

    Логика:
    - при 0 репутации игрок платит базовую цену
    - при 100 репутации игрок платит ~66.67% базовой цены

    Пример:
    база 150 -> при хорошей репутации ~100
    """
    ratio = reputation_ratio(trader_reputation)

    multiplier = BASE_BUY_MULTIPLIER - (
        (BASE_BUY_MULTIPLIER - BEST_BUY_MULTIPLIER) * ratio
    )

    return round(
        clamp(multiplier, BEST_BUY_MULTIPLIER, BASE_BUY_MULTIPLIER),
        4,
    )


def get_sell_multiplier(trader_reputation: int = 0) -> float:
    """
    Множитель выкупа предмета у игрока.

    Логика:
    - при 0 репутации игрок продаёт по 50% базы
    - при 100 репутации игрок продаёт по 80% базы

    Пример:
    база 150 -> 75 без репутации, до 120 при очень хорошей
    база 100 -> 50 без репутации, до 80 при очень хорошей
    """
    ratio = reputation_ratio(trader_reputation)

    multiplier = BASE_SELL_MULTIPLIER + (
        (BEST_SELL_MULTIPLIER - BASE_SELL_MULTIPLIER) * ratio
    )

    return round(
        clamp(multiplier, BASE_SELL_MULTIPLIER, BEST_SELL_MULTIPLIER),
        4,
    )


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
    Считает цену покупки игроком у торговца в copper.
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

    payload = cp_to_split_payload(total_cp)
    payload["multiplier"] = get_buy_multiplier(trader_reputation)
    payload["reputation"] = normalize_reputation(trader_reputation)
    return payload


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
    Считает цену продажи игроком торговцу в copper.
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

    payload = cp_to_split_payload(total_cp)
    payload["multiplier"] = get_sell_multiplier(trader_reputation)
    payload["reputation"] = normalize_reputation(trader_reputation)
    return payload


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
    buy_cp = int(buy_price.get("cp_total", 0) or 0)
    sell_cp = int(sell_price.get("cp_total", 0) or 0)
    spread_cp = max(0, buy_cp - sell_cp)

    return {
        "buy": {
            "cp_total": buy_cp,
            "gold": int(buy_price.get("gold", 0) or 0),
            "silver": int(buy_price.get("silver", 0) or 0),
            "copper": int(buy_price.get("copper", 0) or 0),
            "label": buy_price.get("label", "0м"),
            "multiplier": float(buy_price.get("multiplier", 1.0) or 1.0),
            "reputation": int(buy_price.get("reputation", 0) or 0),
        },
        "sell": {
            "cp_total": sell_cp,
            "gold": int(sell_price.get("gold", 0) or 0),
            "silver": int(sell_price.get("silver", 0) or 0),
            "copper": int(sell_price.get("copper", 0) or 0),
            "label": sell_price.get("label", "0м"),
            "multiplier": float(sell_price.get("multiplier", 1.0) or 1.0),
            "reputation": int(sell_price.get("reputation", 0) or 0),
        },
        "summary": {
            "spread_cp": spread_cp,
            "spread_label": format_cp_or_zero(spread_cp),
        },
    }


# ============================================================
# 📦 ADVANCED API
# ============================================================

def compute_buy_price(
    *,
    base_gold: int = 0,
    base_silver: int = 0,
    base_copper: int = 0,
    trader_reputation: int = 0,
) -> PriceComputation:
    """
    Полное вычисление цены покупки.
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
    Полное вычисление цены продажи.
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