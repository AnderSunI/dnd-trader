from __future__ import annotations

from .pricing import (
    relationship_discount_percent,
    relationship_sell_bonus_percent,
    relationship_state,
    normalize_reputation,
)

# ============================================================
# 🧭 ПРОГРЕССИЯ ОТНОШЕНИЙ С ТОРГОВЦЕМ
# ============================================================
#
# Важно:
# - "Навык торговли" NPC живёт в seed/abilities и НЕ считается здесь.
# - Этот модуль отвечает за отношение торговца к игроку.
# - В текущем legacy-слое score всё ещё лежит в Trader.reputation глобально.
# - Следующий большой pass должен перенести score в user_id + trader_id.

BUY_REP_DIVISOR_CP = 25 * 10_000  # 25з, если 1з = 100с = 10000м в текущей money-модели
SELL_REP_DIVISOR_CP = 50 * 10_000  # продажа качает отношение мягче

BUY_REP_CAP = 25
SELL_REP_CAP = 12

# Маленькие сделки не должны спамить репутацию за каждую булку.
MIN_BUY_CP_FOR_REP = 5 * 10_000
MIN_SELL_CP_FOR_REP = 10 * 10_000

# Legacy labels оставлены для совместимости старых импортов.
# Это НЕ торговый скилл NPC, а старое имя отношений по score.
TRADER_SKILL_RANKS: list[tuple[int, str]] = [
    (0, "Незнакомец"),
    (100, "Знакомый"),
    (300, "Надёжный клиент"),
    (700, "Уважаемый"),
    (1500, "Свой человек"),
    (3000, "Партнёр лавки"),
]


def relationship_label_from_score(reputation: int | None) -> str:
    """
    Человекочитаемый этап отношений.
    """
    return str(relationship_state(reputation).get("label") or "Незнакомец")


def relationship_progress_payload(reputation: int | None) -> dict:
    """
    Полный payload для фронта: score, этап, прогресс, скидка.
    """
    state = relationship_state(reputation)
    return {
        **state,
        "discount_percent": trader_discount_percent(reputation),
        "sell_bonus_percent": trader_sell_bonus_percent(reputation),
    }


def trader_skill_label(reputation: int | None) -> str:
    """
    Legacy alias.

    Старый код импортировал trader_skill_label(reputation), но теперь это
    именно этап отношений, а не навык торговли самого NPC.
    """
    return relationship_label_from_score(reputation)


def trader_discount_percent(reputation: int | None) -> int:
    """
    Скидка покупки по relationship score.
    """
    return relationship_discount_percent(reputation)


def trader_sell_bonus_percent(reputation: int | None) -> int:
    """
    Бонус к цене продажи игроком торговцу.
    """
    return relationship_sell_bonus_percent(reputation)


def calculate_reputation_delta(
    *,
    action: str,
    total_cp: int | None = None,
    quantity: int | None = None,
) -> int:
    """
    Считает прирост отношений от сделки.

    Основная логика теперь от суммы сделки, а не от количества кликов:
    - покупка: +1 за каждые 25з, cap +25;
    - продажа: +1 за каждые 50з, cap +12;
    - мелкие сделки ниже порога не качают отношение.

    quantity оставлен только для обратной совместимости вызовов.
    """
    normalized_action = str(action or "").strip().lower()

    try:
        cp_value = int(total_cp or 0)
    except (TypeError, ValueError):
        cp_value = 0

    # Fallback для старого кода, если total_cp ещё не передали.
    # Не разгоняем репутацию как раньше: даже 10 дешёвых предметов не дают +10.
    if cp_value <= 0:
        try:
            qty = max(1, int(quantity or 1))
        except (TypeError, ValueError):
            qty = 1

        if normalized_action == "buy":
            return min(BUY_REP_CAP, max(0, qty // 5))
        if normalized_action == "sell":
            return min(SELL_REP_CAP, max(0, qty // 10))
        return 0

    if normalized_action == "buy":
        if cp_value < MIN_BUY_CP_FOR_REP:
            return 0
        return min(BUY_REP_CAP, max(1, cp_value // BUY_REP_DIVISOR_CP))

    if normalized_action == "sell":
        if cp_value < MIN_SELL_CP_FOR_REP:
            return 0
        return min(SELL_REP_CAP, max(1, cp_value // SELL_REP_DIVISOR_CP))

    return 0


def update_reputation_after_trade(
    current_reputation: int | None,
    *,
    action: str,
    quantity: int | None = 1,
    total_cp: int | None = None,
) -> int:
    """
    Обновляет relationship score после сделки.

    В отличие от старой версии:
    - не +1% за покупку;
    - не от количества кликов;
    - от суммы сделки;
    - следующий этап требует больше очков.
    """
    rep = normalize_reputation(current_reputation)
    delta = calculate_reputation_delta(
        action=action,
        quantity=quantity,
        total_cp=total_cp,
    )
    return normalize_reputation(rep + delta)
