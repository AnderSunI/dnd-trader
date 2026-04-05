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
    return copper_to_split(split_to_copper(gold, silver, copper))

def format_split_price(gold: int = 0, silver: int = 0, copper: int = 0) -> str:
    gold, silver, copper = normalize_split_price(gold, silver, copper)
    parts = []
    if gold: parts.append(f"{gold}з")
    if silver: parts.append(f"{silver}с")
    if copper: parts.append(f"{copper}м")
    return " ".join(parts) if parts else "0з"