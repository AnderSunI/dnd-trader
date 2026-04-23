from __future__ import annotations

from .pricing import get_buy_multiplier, normalize_reputation

# ============================================================
# 🧭 ПРОГРЕССИЯ ТОРГОВЦА (RU комментарии для читаемости)
# ============================================================
# Этот модуль НЕ ломает текущую экономику.
# Он добавляет поверх существующей логики:
# 1) "ранг"/скилл торговца по репутации;
# 2) отображаемую скидку в процентах;
# 3) мягкое изменение репутации после buy/sell.
#
# Важно: данные не удаляем, только аккуратно дополняем.

TRADER_SKILL_RANKS: list[tuple[int, str]] = [
    (0, "Новичок"),
    (20, "Подмастерье"),
    (40, "Опытный"),
    (60, "Эксперт"),
    (80, "Мастер"),
    (95, "Легенда торговли"),
]


def trader_skill_label(reputation: int | None) -> str:
    """
    Человекочитаемый ранг торговца по репутации.
    """
    rep = normalize_reputation(reputation)
    label = TRADER_SKILL_RANKS[0][1]

    for threshold, tier_label in TRADER_SKILL_RANKS:
        if rep >= threshold:
            label = tier_label
        else:
            break

    return label


def trader_discount_percent(reputation: int | None) -> int:
    """
    Скидка для покупки игроком у торговца.
    Возвращаем целый % для стабильного UI.
    """
    buy_multiplier = get_buy_multiplier(normalize_reputation(reputation))
    discount = (1.0 - buy_multiplier) * 100.0
    return max(0, int(round(discount)))


def update_reputation_after_trade(
    current_reputation: int | None,
    *,
    action: str,
    quantity: int,
) -> int:
    """
    Мягкая динамика репутации после сделки.
    - buy у торговца: +1 за предмет
    - sell торговцу: +1 за каждые 2 предмета
    Ограничение 0..100.
    """
    rep = normalize_reputation(current_reputation)
    qty = max(1, int(quantity or 1))

    if action == "buy":
        delta = qty
    elif action == "sell":
        delta = max(1, qty // 2)
    else:
        delta = 0

    return normalize_reputation(rep + delta)
