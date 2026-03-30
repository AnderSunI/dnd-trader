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

# ----- Связующая таблица "многие ко многим" -----
trader_items = Table(
    "trader_items",
    Base.metadata,
    Column("trader_id", Integer, ForeignKey("traders.id"), primary_key=True),
    Column("item_id", Integer, ForeignKey("items.id"), primary_key=True),
    Column("price_gold", Integer, default=0),
    Column("quantity", Integer, default=1),
    Column("discount", Integer, default=0),
    Column("is_limited", Boolean, default=False),
)

# ----- Модель торговца -----
class Trader(Base):
    __tablename__ = "traders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    specialization = Column(JSON)
    reputation = Column(Integer, default=0)
    region = Column(String)
    settlement = Column(String)
    level_min = Column(Integer)
    level_max = Column(Integer)
    restock_days = Column(Integer, default=7)
    last_restock = Column(String)
    currency = Column(String, default="gold")

    # Поля, которые были в seed_db.py
    description = Column(String)
    image_url = Column(String)

    # Расширенные поля
    personality = Column(String)
    possessions = Column(JSON)
    rumors = Column(String)
    gold = Column(Integer, default=0)

    # Поля для ГМ
    race = Column(String)
    class_name = Column(String)
    trader_level = Column(Integer, default=0)
    stats = Column(JSON)
    abilities = Column(JSON)

    items = relationship("Item", secondary=trader_items, back_populates="traders")


# ----- Модель предмета -----
class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String)
    subcategory = Column(String)
    rarity = Column(String)
    quality = Column(String, default="стандартное")

    price_gold = Column(Integer)
    price_silver = Column(Integer, default=0)
    price_copper = Column(Integer, default=0)

    weight = Column(Float)
    description = Column(String)

    properties = Column(JSON)
    requirements = Column(JSON)
    source = Column(String)

    is_magical = Column(Boolean, default=False)
    attunement = Column(Boolean, default=False)
    rarity_tier = Column(Integer, default=0, nullable=False)

    stock = Column(Integer, default=0)

    traders = relationship("Trader", secondary=trader_items, back_populates="items")