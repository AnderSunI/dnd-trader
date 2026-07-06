from __future__ import annotations

from dataclasses import dataclass

from .money import (
    copper_to_split,
    format_split_price,
    split_to_copper,
)

# ============================================================
# ⚙️ ЭКОНОМИКА / РЕПУТАЦИЯ ТОРГОВЦА
# ============================================================
#
# Важно: reputation здесь больше НЕ процент скидки 0..100.
# Это накопительные очки отношений с торговцем.
#
# Идея:
# - познакомиться легко;
# - стать надёжным клиентом уже заметно дороже;
# - стать "своим человеком" долго и дорого;
# - скидка растёт медленно и имеет hard cap.
#
# В текущем legacy-слое reputation всё ещё лежит на Trader глобально.
# Следующий большой pass должен перенести эти очки в связку user_id + trader_id.

REPUTATION_MIN = -100
REPUTATION_MAX = 6000

MAX_BUY_DISCOUNT_PERCENT = 20
BASE_BUY_MULTIPLIER = 1.00
BEST_BUY_MULTIPLIER = 1.00 - (MAX_BUY_DISCOUNT_PERCENT / 100.0)  # 0.80

BASE_SELL_MULTIPLIER = 0.50
BEST_SELL_MULTIPLIER = 0.70

# start, label, next_start, min_discount, max_discount, tone
RELATIONSHIP_TIERS: list[dict] = [
    {
        "start": -100,
        "label": "Недоверие",
        "next_start": 0,
        "min_discount": 0,
        "max_discount": 0,
        "tone": "bad",
    },
    {
        "start": 0,
        "label": "Незнакомец",
        "next_start": 100,
        "min_discount": 0,
        "max_discount": 2,
        "tone": "neutral",
    },
    {
        "start": 100,
        "label": "Знакомый",
        "next_start": 300,
        "min_discount": 2,
        "max_discount": 4,
        "tone": "known",
    },
    {
        "start": 300,
        "label": "Надёжный клиент",
        "next_start": 700,
        "min_discount": 4,
        "max_discount": 7,
        "tone": "trusted",
    },
    {
        "start": 700,
        "label": "Уважаемый",
        "next_start": 1500,
        "min_discount": 7,
        "max_discount": 11,
        "tone": "respected",
    },
    {
        "start": 1500,
        "label": "Свой человек",
        "next_start": 3000,
        "min_discount": 11,
        "max_discount": 15,
        "tone": "friend",
    },
    {
        "start": 3000,
        "label": "Партнёр лавки",
        "next_start": 6000,
        "min_discount": 15,
        "max_discount": 20,
        "tone": "partner",
    },
]


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
    Нормализуем reputation как накопительные очки отношений.

    Старый код считал reputation процентом 0..100. Теперь это score:
    - 0..99: Незнакомец
    - 100..299: Знакомый
    - 300..699: Надёжный клиент
    - 700+: дальше тяжелее.
    """
    try:
        rep = int(reputation or 0)
    except (TypeError, ValueError):
        rep = 0

    return int(clamp(rep, REPUTATION_MIN, REPUTATION_MAX))


def _tier_for_score(score: int) -> dict:
    score = normalize_reputation(score)
    selected = RELATIONSHIP_TIERS[0]

    for tier in RELATIONSHIP_TIERS:
        if score >= int(tier["start"]):
            selected = tier
        else:
            break

    return selected


def relationship_state(reputation: int | None) -> dict:
    """
    Полное состояние отношений для backend/frontend.

    progress_current/progress_needed — это прогресс внутри текущего этапа,
    а не общий процент скидки.
    """
    score = normalize_reputation(reputation)
    tier = _tier_for_score(score)

    start = int(tier["start"])
    next_start = int(tier.get("next_start") or REPUTATION_MAX)
    needed = max(1, next_start - start)
    current = int(clamp(score - start, 0, needed))
    percent = int(round((current / needed) * 100))

    next_label = None
    for candidate in RELATIONSHIP_TIERS:
        if int(candidate["start"]) == next_start:
            next_label = str(candidate["label"])
            break

    return {
        "score": score,
        "label": str(tier["label"]),
        "tone": str(tier.get("tone") or "neutral"),
        "tier_start": start,
        "tier_next": next_start,
        "next_label": next_label,
        "progress_current": current,
        "progress_needed": needed,
        "progress_percent": int(clamp(percent, 0, 100)),
        "to_next": max(0, needed - current),
    }


def reputation_ratio(reputation: int | None) -> float:
    """
    Legacy helper: общий score в 0..1 по hard cap.
    Для UI лучше использовать relationship_state().
    """
    rep = normalize_reputation(reputation)
    return clamp(rep / float(REPUTATION_MAX), 0.0, 1.0)


def relationship_discount_percent(reputation: int | None) -> int:
    """
    Скидка покупки у торговца по этапу отношений.

    Это НЕ reputation percent. Скидка растёт медленно:
    - Незнакомец: 0..2%
    - Знакомый: 2..4%
    - Надёжный клиент: 4..7%
    - Уважаемый: 7..11%
    - Свой человек: 11..15%
    - Партнёр лавки: 15..20%
    """
    score = normalize_reputation(reputation)
    tier = _tier_for_score(score)
    state = relationship_state(score)

    min_discount = float(tier.get("min_discount") or 0)
    max_discount = float(tier.get("max_discount") or min_discount)
    progress_ratio = (state["progress_percent"] / 100.0)

    discount = min_discount + ((max_discount - min_discount) * progress_ratio)
    return int(clamp(round(discount), 0, MAX_BUY_DISCOUNT_PERCENT))


def relationship_sell_bonus_percent(reputation: int | None) -> int:
    """
    Бонус к продаже игроком торговцу.

    Покупочная скидка и sell-бонус не одинаковы:
    хороший торговец может покупать у знакомого дороже, но не по full price.
    """
    discount = relationship_discount_percent(reputation)
    return int(clamp(round(discount * 0.75), 0, 15))


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

    Теперь скидка берётся из ступенчатой relationship-модели.
    Hard cap: 20%, то есть лучший множитель 0.80.
    """
    discount = relationship_discount_percent(trader_reputation)
    multiplier = 1.0 - (discount / 100.0)

    return round(
        clamp(multiplier, BEST_BUY_MULTIPLIER, BASE_BUY_MULTIPLIER),
        4,
    )


def get_sell_multiplier(trader_reputation: int = 0) -> float:
    """
    Множитель выкупа предмета у игрока.

    База: 50%.
    При лучшей репутации: до 70%.
    """
    bonus = relationship_sell_bonus_percent(trader_reputation)
    multiplier = BASE_SELL_MULTIPLIER + (bonus / 100.0)

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
    payload["relationship"] = relationship_state(trader_reputation)
    payload["discount_percent"] = relationship_discount_percent(trader_reputation)
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
    payload["relationship"] = relationship_state(trader_reputation)
    payload["sell_bonus_percent"] = relationship_sell_bonus_percent(trader_reputation)
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
            "relationship": buy_price.get("relationship") or {},
            "discount_percent": int(buy_price.get("discount_percent", 0) or 0),
        },
        "sell": {
            "cp_total": sell_cp,
            "gold": int(sell_price.get("gold", 0) or 0),
            "silver": int(sell_price.get("silver", 0) or 0),
            "copper": int(sell_price.get("copper", 0) or 0),
            "label": sell_price.get("label", "0м"),
            "multiplier": float(sell_price.get("multiplier", 1.0) or 1.0),
            "reputation": int(sell_price.get("reputation", 0) or 0),
            "relationship": sell_price.get("relationship") or {},
            "sell_bonus_percent": int(sell_price.get("sell_bonus_percent", 0) or 0),
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
