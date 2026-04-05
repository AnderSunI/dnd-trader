# app/routers/traders.py
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from ..models import Item, Trader


router = APIRouter(prefix="/traders", tags=["traders"])


# ============================================================
# 🛠 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================

def build_item_payload(
    item: Item,
    trader: Trader,
    calculate_buy_price_split,
    calculate_sell_price_split,
    format_split_price,
    build_price_debug,
) -> dict[str, Any]:
    """
    Формирует предмет для ответа API.
    Вынесено сюда, чтобы логика /traders жила в одном месте.
    """

    buy_gold, buy_silver, buy_copper = calculate_buy_price_split(item, trader)
    sell_gold, sell_silver, sell_copper = calculate_sell_price_split(item, trader)

    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "rarity": item.rarity,
        "rarity_tier": item.rarity_tier,

        # Базовая цена из БД
        "base_price_gold": int(item.price_gold or 0),
        "base_price_silver": int(item.price_silver or 0),
        "base_price_copper": int(item.price_copper or 0),
        "base_price_label": format_split_price(
            item.price_gold,
            item.price_silver,
            item.price_copper,
        ),

        # Цена покупки у торговца
        "buy_price_gold": buy_gold,
        "buy_price_silver": buy_silver,
        "buy_price_copper": buy_copper,
        "buy_price_label": format_split_price(buy_gold, buy_silver, buy_copper),

        # Цена продажи торговцу
        "sell_price_gold": sell_gold,
        "sell_price_silver": sell_silver,
        "sell_price_copper": sell_copper,
        "sell_price_label": format_split_price(sell_gold, sell_silver, sell_copper),

        # Совместимость со старым фронтом
        "price_gold": buy_gold,
        "price_silver": buy_silver,
        "price_copper": buy_copper,

        "weight": item.weight,
        "description": item.description,
        "properties": item.properties,
        "requirements": item.requirements,
        "is_magical": item.is_magical,
        "attunement": item.attunement,
        "quality": item.quality,
        "stock": item.stock,

        # Отладка экономики
        "pricing_debug": build_price_debug(item, trader),
    }


def build_trader_payload(
    trader: Trader,
    calculate_buy_price_split,
    calculate_sell_price_split,
    format_split_price,
    build_price_debug,
) -> dict[str, Any]:
    """
    Формирует торговца вместе с его ассортиментом.
    """

    items_data = [
        build_item_payload(
            item=item,
            trader=trader,
            calculate_buy_price_split=calculate_buy_price_split,
            calculate_sell_price_split=calculate_sell_price_split,
            format_split_price=format_split_price,
            build_price_debug=build_price_debug,
        )
        for item in trader.items
    ]

    return {
        "id": trader.id,
        "name": trader.name,
        "type": trader.type,
        "region": trader.region or "",
        "settlement": trader.settlement or "",
        "reputation": trader.reputation or 0,
        "description": trader.description or "",
        "image_url": trader.image_url or "",
        "gold": trader.gold or 0,
        "items": items_data,
    }


# ============================================================
# 🌍 API
# ============================================================

@router.get("")
def get_traders(
    db: Session = Depends(lambda: None),
):
    """
    Возвращает список торговцев со всеми предметами.
    Зависимости подменятся в main.py при подключении.
    """
    raise RuntimeError("Эта функция должна быть переопределена через dependency wiring")


def create_traders_router(
    get_db,
    calculate_buy_price_split,
    calculate_sell_price_split,
    format_split_price,
    build_price_debug,
):
    """
    Фабрика роутера.
    Нужна, чтобы не тащить циклические импорты из main.py.
    """

    wired_router = APIRouter(prefix="/traders", tags=["traders"])

    @wired_router.get("")
    def get_traders_endpoint(db: Session = Depends(get_db)):
        traders = db.query(Trader).options(joinedload(Trader.items)).all()

        return [
            build_trader_payload(
                trader=t,
                calculate_buy_price_split=calculate_buy_price_split,
                calculate_sell_price_split=calculate_sell_price_split,
                format_split_price=format_split_price,
                build_price_debug=build_price_debug,
            )
            for t in traders
        ]

    @wired_router.post("/{trader_id}/restock")
    def restock_trader(trader_id: int):
        """
        Пока заглушка.
        Потом сюда вынесем нормальный restock-сервис.
        """
        return {
            "status": "ok",
            "message": "Restock пока не реализован полностью",
            "trader_id": trader_id,
        }

    return wired_router
