from sqlalchemy import create_engine, Column, Integer, String, JSON, Table, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship, sessionmaker
from sqlalchemy.ext.declarative import declarative_base

# --- Настройка подключения (уже было) ---
DATABASE_URL = "postgresql://trader:traderpass@db:5432/dnd_trader"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Связующая таблица "многие ко многим" между торговцами и предметами ---
# Здесь хранятся предметы, которые есть у конкретного торговца, с дополнительными полями.
trader_items = Table(
    "trader_items",
    Base.metadata,
    Column("trader_id", Integer, ForeignKey("traders.id"), primary_key=True),
    Column("item_id", Integer, ForeignKey("items.id"), primary_key=True),
    Column("price_gold", Integer, default=0),          # цена у этого торговца (может отличаться от базовой)
    Column("quantity", Integer, default=1),            # сколько есть в наличии
    Column("discount", Integer, default=0),            # скидка в процентах
    Column("is_limited", Boolean, default=False),      # ограниченный товар (только 1 штука)
)


class Trader(Base):
    """Модель торговца — теперь с множеством параметров"""
    __tablename__ = "traders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                # имя торговца
    type = Column(String, nullable=False)                # "оружейник", "алхимик", "торговец магией", "общая лавка"
    specialization = Column(JSON)                        # список категорий товаров, которые он продаёт (например, ["оружие", "броня"])
    reputation = Column(Integer, default=0)              # репутация (-10..10), влияет на цены и доступные предметы
    region = Column(String)                              # регион, где находится
    settlement = Column(String)                          # конкретное поселение
    level_min = Column(Integer)                          # минимальный уровень игроков для доступа
    level_max = Column(Integer)                          # максимальный уровень (если нужно)
    restock_days = Column(Integer, default=7)            # через сколько дней обновляется ассортимент
    last_restock = Column(String)                        # дата последнего обновления (можно хранить в ISO)
    currency = Column(String, default="gold")            # валюта, в которой торгует
    description = Column(String)                         # текстовое описание (внешность, характер)
    image_url = Column(String)                           # ссылка на аватарку

    # Связь с предметами (через связующую таблицу)
    items = relationship("Item", secondary=trader_items, back_populates="traders")


class Item(Base):
    """Модель предмета — все детали D&D"""
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                # название предмета
    category = Column(String)                            # "оружие", "броня", "зелье", "свиток", "артефакт"
    subcategory = Column(String)                         # "меч", "щит", "лечебное зелье", "огненный шар"
    rarity = Column(String)                              # "обычный", "необычный", "редкий", "очень редкий", "легендарный"
    quality = Column(String, default="стандартное")      # "низкое", "стандартное", "высокое", "мастерское"
    price_gold = Column(Integer)                         # базовая цена в золотых
    weight = Column(Float)                               # вес в фунтах
    description = Column(String)                         # описание предмета
    properties = Column(JSON)                            # дополнительные свойства (JSON): например, "damage": "1d8", "ac": +2
    requirements = Column(JSON)                          # требования к использованию (уровень, класс, сила и т.д.)
    source = Column(String)                              # откуда взят (книга, homebrew)
    is_magical = Column(Boolean, default=False)          # магический предмет?
    attunement = Column(Boolean, default=False)          # требуется настройка?

    # Связь с торговцами
    traders = relationship("Trader", secondary=trader_items, back_populates="items")
