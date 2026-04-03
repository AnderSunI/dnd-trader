# ============================================================
# models.py – Описание таблиц базы данных (SQLAlchemy ORM)
# Добавлены User и Character
# ============================================================

from sqlalchemy import create_engine, Column, Integer, String, JSON, Table, ForeignKey, Float, Boolean, DateTime
from sqlalchemy.orm import relationship, sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import bcrypt
import os

# ----- Настройка подключения -----
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://trader:traderpass@db:5432/dnd_trader")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ----- Связующая таблица "многие ко многим" (торговцы <-> предметы) -----
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

# ----- Модель торговца (без изменений) -----
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
    description = Column(String)
    image_url = Column(String)
    personality = Column(String)
    possessions = Column(JSON)
    rumors = Column(String)
    gold = Column(Integer, default=0)
    race = Column(String)
    class_name = Column(String)
    trader_level = Column(Integer, default=0)
    stats = Column(JSON)
    abilities = Column(JSON)

    items = relationship("Item", secondary=trader_items, back_populates="traders")

# ----- Модель предмета (без изменений) -----
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


# ----- НОВЫЕ МОДЕЛИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ И ПЕРСОНАЖЕЙ -----

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    characters = relationship("Character", back_populates="user", cascade="all, delete-orphan")
    
    def set_password(self, password):
        self.hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    def check_password(self, password):
        return bcrypt.checkpw(password.encode('utf-8'), self.hashed_password.encode('utf-8'))


class Character(Base):
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    class_name = Column(String, default="")
    level = Column(Integer, default=1)
    race = Column(String, default="")
    alignment = Column(String, default="")
    experience = Column(Integer, default=0)
    
    # Характеристики (stats) – JSON: {"str": 10, "dex": 10, ...}
    stats = Column(JSON, default={"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10})
    
    # Прочие данные (skills, spells, text_blocks) – позже расширим
    data = Column(JSON, default={})
    
    # Игровые данные (привязаны к персонажу)
    gold = Column(Integer, default=1000)
    inventory = Column(JSON, default=[])      # список предметов в инвентаре
    cart = Column(JSON, default=[])           # корзина
    reserved = Column(JSON, default=[])       # зарезервированное
    gm_notes = Column(JSON, default={})       # заметки ГМ по торговцам
    cabinet_data = Column(JSON, default={})   # история, квесты, файлы, карта
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User", back_populates="characters")