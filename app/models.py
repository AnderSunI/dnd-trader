# ============================================================
# models.py – Описание таблиц базы данных (SQLAlchemy ORM)
# ============================================================

from sqlalchemy import create_engine, Column, Integer, String, JSON, Table, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship, sessionmaker
from sqlalchemy.ext.declarative import declarative_base
import os

# ----- Настройка подключения к PostgreSQL -----
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://trader:traderpass@db:5432/dnd_trader")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ----- Связующая таблица "многие ко многим" между торговцами и предметами -----
# Здесь хранятся дополнительные поля, специфичные для каждого торговца-предмета
trader_items = Table(
    "trader_items",
    Base.metadata,
    Column("trader_id", Integer, ForeignKey("traders.id"), primary_key=True),
    Column("item_id", Integer, ForeignKey("items.id"), primary_key=True),
    Column("price_gold", Integer, default=0),    # цена может отличаться у разных торговцев
    Column("quantity", Integer, default=1),      # количество в ассортименте (не stock!)
    Column("discount", Integer, default=0),      # персональная скидка
    Column("is_limited", Boolean, default=False),
)

# ----- Модель торговца -----
class Trader(Base):
    __tablename__ = "traders"

    # Основные поля
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)                # тип деятельности (кузнец, портной и т.д.)
    specialization = Column(JSON)                       # список товарных категорий
    reputation = Column(Integer, default=0)              # репутация (влияет на цены)
    region = Column(String)                              # регион
    settlement = Column(String)                          # поселение
    level_min = Column(Integer)                          # минимальный уровень для посещения
    level_max = Column(Integer)                          # максимальный уровень (опционально)
    restock_days = Column(Integer, default=7)            # через сколько дней обновляется ассортимент
    last_restock = Column(String)                        # дата последнего обновления
    currency = Column(String, default="gold")            # основная валюта (золотые, серебряные и т.д.)
        # Поля для ГМ (персональные данные торговца)
    race = Column(String)                    # раса
    class_name = Column(String)              # класс (class зарезервирован, поэтому class_name)
    trader_level = Column(Integer, default=0) # уровень торговца как персонажа
    stats = Column(JSON)                     # характеристики (str, dex, con, int, wis, cha)
    abilities = Column(JSON)                 # способности / черты
    description = Column(String)                         # описание торговца
    image_url = Column(String)                           # ссылка на картинку

    # Новые поля (добавлены для расширенной ролевой игры)
    personality = Column(String)                         # особенности поведения, характер
    possessions = Column(JSON)                           # личные вещи (список)
    rumors = Column(String)                              # слухи или квестовые зацепки

    # Золото торговца (для системы купли-продажи) – добавили отдельно
    gold = Column(Integer, default=0)

    # Связь с предметами (многие ко многим)
    items = relationship("Item", secondary=trader_items, back_populates="traders")


# ----- Модель предмета -----
class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                # название
    category = Column(String)                            # категория (оружие, броня, еда и т.д.)
    subcategory = Column(String)                         # подкатегория (меч, лук, кольчуга...)
    rarity = Column(String)                              # редкость (обычный, необычный, редкий...)
    quality = Column(String, default="стандартное")      # качество (стандартное, хорошее, отличное)

    # Цены в трёх валютах
    price_gold = Column(Integer)                         # цена в золотых
    price_silver = Column(Integer, default=0)            # цена в серебряных
    price_copper = Column(Integer, default=0)            # цена в медных

    weight = Column(Float)                               # вес в фунтах
    description = Column(String)                         # описание предмета

    # Игровые характеристики (хранятся в JSON)
    properties = Column(JSON)                            # свойства (урон, КД, бонусы и т.д.)
    requirements = Column(JSON)                          # требования (сила, уровень, класс)
    source = Column(String)                              # источник (книга, кампания)

    is_magical = Column(Boolean, default=False)          # магический предмет?
    attunement = Column(Boolean, default=False)          # требует настройки?
    rarity_tier = Column(Integer, default=0, nullable=False)   # 0-обычный,1-необычный,2-редкий,3-очень редкий,4-легендарный

    stock = Column(Integer, default=0)                   # сколько штук в наличии у торговца

    # Связь с торговцами
    traders = relationship("Trader", secondary=trader_items, back_populates="items")