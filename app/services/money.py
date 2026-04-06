from __future__ import annotations

from typing import Dict

# ============================================================
# 💰 БАЗОВЫЕ КОНСТАНТЫ
# ============================================================

COPPER_IN_SILVER = 100
SILVER_IN_GOLD = 100
COPPER_IN_GOLD = COPPER_IN_SILVER * SILVER_IN_GOLD

# ============================================================
# 🔁 SPLIT → COPPER
# ============================================================

def split_to_copper(
    gold: int = 0,
    silver: int = 0,
    copper: int = 0,
) -> int:
    """
    Перевод split price в общее количество copper.
    """
    gold = int(gold or 0)
    silver = int(silver or 0)
    copper = int(copper or 0)

    return (
        gold * COPPER_IN_GOLD
        + silver * COPPER_IN_SILVER
        + copper
    )

# ============================================================
# 🔁 COPPER → SPLIT
# ============================================================

def copper_to_split(total_copper: int) -> tuple[int, int, int]:
    """
    Перевод общего количества copper
    в gold / silver / copper.
    """
    total = max(0, int(total_copper or 0))

    gold = total // COPPER_IN_GOLD
    total %= COPPER_IN_GOLD

    silver = total // COPPER_IN_SILVER
    copper = total % COPPER_IN_SILVER

    return gold, silver, copper

# ============================================================
# 🏷️ FORMATTERS
# ============================================================

def format_split_price(
    gold: int = 0,
    silver: int = 0,
    copper: int = 0,
) -> str:
    """
    Красивый вывод цены:
    1з 25с 10м
    """
    parts = []

    gold = int(gold or 0)
    silver = int(silver or 0)
    copper = int(copper or 0)

    if gold:
        parts.append(f"{gold}з")

    if silver:
        parts.append(f"{silver}с")

    if copper:
        parts.append(f"{copper}м")

    if not parts:
        return "0м"

    return " ".join(parts)


def format_cp_price(total_copper: int) -> str:
    """
    Форматирование total copper напрямую.
    """
    gold, silver, copper = copper_to_split(total_copper)
    return format_split_price(gold, silver, copper)

# ============================================================
# ➕ SAFE MONEY MATH
# ============================================================

def add_cp(current: int, delta: int) -> int:
    """
    Безопасное добавление денег.
    """
    return max(0, int(current or 0) + int(delta or 0))


def subtract_cp(current: int, delta: int) -> int:
    """
    Безопасное списание денег.
    """
    result = int(current or 0) - int(delta or 0)
    return max(0, result)


def has_enough_money(current: int, required: int) -> bool:
    """
    Хватает ли денег.
    """
    return int(current or 0) >= int(required or 0)

# ============================================================
# 🧾 PAYLOAD HELPERS
# ============================================================

def cp_payload(total_copper: int) -> Dict[str, int | str]:
    """
    Готовый payload для API ответа.
    """
    gold, silver, copper = copper_to_split(total_copper)

    return {
        "money_cp_total": int(total_copper or 0),
        "money_gold": gold,
        "money_silver": silver,
        "money_copper": copper,
        "money_label": format_split_price(
            gold,
            silver,
            copper,
        ),
    }