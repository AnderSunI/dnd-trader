# app/services/money.py
from __future__ import annotations


def split_to_copper(gold: int = 0, silver: int = 0, copper: int = 0) -> int:
    gold = int(gold or 0)
    silver = int(silver or 0)
    copper = int(copper or 0)
    return gold * 10000 + silver * 100 + copper


def copper_to_split(total_copper: int) -> tuple[int, int, int]:
    total_copper = max(0, int(total_copper or 0))

    gold = total_copper // 10000
    remainder = total_copper % 10000

    silver = remainder // 100
    copper = remainder % 100

    return gold, silver, copper


def normalize_split_price(gold: int = 0, silver: int = 0, copper: int = 0) -> tuple[int, int, int]:
    total_copper = split_to_copper(gold, silver, copper)
    return copper_to_split(total_copper)


def apply_percent_discount_to_split_price(
    gold: int = 0,
    silver: int = 0,
    copper: int = 0,
    discount_percent: int = 0,
) -> tuple[int, int, int]:
    total_copper = split_to_copper(gold, silver, copper)

    discount_percent = max(0, int(discount_percent or 0))
    discount_percent = min(discount_percent, 95)

    discounted_total = int(round(total_copper * (100 - discount_percent) / 100.0))
    return copper_to_split(discounted_total)


def format_split_price(gold: int = 0, silver: int = 0, copper: int = 0) -> str:
    gold, silver, copper = normalize_split_price(gold, silver, copper)

    parts = []
    if gold:
        parts.append(f"{gold} зм")
    if silver:
        parts.append(f"{silver} см")
    if copper:
        parts.append(f"{copper} мм")

    return " ".join(parts) if parts else "0 зм"
