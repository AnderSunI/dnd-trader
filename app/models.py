<<<<<<< Updated upstream
# ============================================================
# models.py – Описание таблиц базы данных (SQLAlchemy ORM)
# ============================================================

from sqlalchemy import create_engine, Column, Integer, String, JSON, Table, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship, sessionmaker
from sqlalchemy.ext.declarative import declarative_base
import os

# ----- Настройка подключения к PostgreSQL -----
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://trader:traderpass@db:5432/dnd_trader")
=======
# app/models.py
from __future__ import annotations

import os
from datetime import datetime

import bcrypt
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker


# ============================================================
# 🔧 БАЗОВАЯ НАСТРОЙКА SQLAlchemy
# ============================================================

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://trader:traderpass@db:5432/dnd_trader",
)

>>>>>>> Stashed changes
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

<<<<<<< Updated upstream
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
=======

# ============================================================
# 🧩 СВЯЗУЮЩАЯ МОДЕЛЬ: ТОВАР У ТОРГОВЦА
# ============================================================

class TraderItem(Base):
    """
    Конкретный предмет в ассортименте конкретного торговца.
    """

    __tablename__ = "trader_items"

    trader_id = Column(Integer, ForeignKey("traders.id"), primary_key=True)
    item_id = Column(Integer, ForeignKey("items.id"), primary_key=True)

    price_gold = Column(Integer, default=0, nullable=False)
    price_silver = Column(Integer, default=0, nullable=False)
    price_copper = Column(Integer, default=0, nullable=False)

    quantity = Column(Integer, default=1, nullable=False)
    discount = Column(Integer, default=0, nullable=False)
    is_limited = Column(Boolean, default=False, nullable=False)

    restock_locked = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader = relationship("Trader", back_populates="trader_items")
    item = relationship("Item", back_populates="trader_items")


# ============================================================
# 🎒 СВЯЗУЮЩАЯ МОДЕЛЬ: ПРЕДМЕТЫ ПОЛЬЗОВАТЕЛЯ
# ============================================================

class UserItem(Base):
    """
    Предметы, которые принадлежат пользователю.
    """

    __tablename__ = "user_items"
    __table_args__ = (
        UniqueConstraint("user_id", "item_id", name="uq_user_items_user_item"),
    )

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)

    quantity = Column(Integer, default=1, nullable=False)
    source = Column(String, default="trade")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="user_items")
    item = relationship("Item", back_populates="user_items")


# ============================================================
# 🧑‍💼 ТОРГОВЕЦ
# ============================================================

>>>>>>> Stashed changes
class Trader(Base):
    __tablename__ = "traders"

    # Основные поля
    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
<<<<<<< Updated upstream
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
=======
    type = Column(String, nullable=False)

    specialization = Column(JSON, default={})
    reputation = Column(Integer, default=0)

    region = Column(String, default="")
    settlement = Column(String, default="")

    level_min = Column(Integer, default=1)
    level_max = Column(Integer, default=10)

    restock_days = Column(Integer, default=7)
    last_restock = Column(String, default="")

    currency = Column(String, default="gold")

    description = Column(String, default="")
    image_url = Column(String, default="")

    personality = Column(String, default="")
    possessions = Column(JSON, default=[])
    rumors = Column(String, default="")

    # Пока оставляем для старой логики торговца
    gold = Column(Integer, default=0)

    race = Column(String, default="")
    class_name = Column(String, default="")
    trader_level = Column(Integer, default=0)

    stats = Column(JSON, default={})
    abilities = Column(JSON, default=[])

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader_items = relationship(
        "TraderItem",
        back_populates="trader",
        cascade="all, delete-orphan",
    )

    items = relationship(
        "Item",
        secondary="trader_items",
        viewonly=True,
        back_populates="traders",
    )


# ============================================================
# 🗡 ПРЕДМЕТ
# ============================================================

>>>>>>> Stashed changes
class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
<<<<<<< Updated upstream
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

    stock = Column(Integer, default=0)                   # сколько штук в наличии у торговца

    # Связь с торговцами
    traders = relationship("Trader", secondary=trader_items, back_populates="items")
=======

    name = Column(String, nullable=False)

    category = Column(String, default="misc")
    subcategory = Column(String, default="")

    rarity = Column(String, default="common")
    quality = Column(String, default="стандартное")

    # Базовая цена предмета
    price_gold = Column(Integer, default=0)
    price_silver = Column(Integer, default=0)
    price_copper = Column(Integer, default=0)

    weight = Column(Float, default=0.0)

    description = Column(String, default="")
    properties = Column(JSON, default={})
    requirements = Column(JSON, default={})

    source = Column(String, default="merged")

    is_magical = Column(Boolean, default=False)
    attunement = Column(Boolean, default=False)

    rarity_tier = Column(Integer, default=0, nullable=False)

    # Legacy-остаток, позже основной остаток будет только в TraderItem
    stock = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader_items = relationship(
        "TraderItem",
        back_populates="item",
        cascade="all, delete-orphan",
    )

    user_items = relationship(
        "UserItem",
        back_populates="item",
        cascade="all, delete-orphan",
    )

    traders = relationship(
        "Trader",
        secondary="trader_items",
        viewonly=True,
        back_populates="items",
    )


# ============================================================
# 👤 ПОЛЬЗОВАТЕЛЬ
# ============================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)

    is_active = Column(Boolean, default=True)

    # Основной кошелёк пользователя.
    # Всё храним в copper для точной математики.
    money_cp_total = Column(Integer, default=1000000, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    characters = relationship(
        "Character",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    user_items = relationship(
        "UserItem",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def set_password(self, password: str) -> None:
        self.hashed_password = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")

    def check_password(self, password: str) -> bool:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            self.hashed_password.encode("utf-8"),
        )


# ============================================================
# 🧙 ПЕРСОНАЖ
# ============================================================

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

    stats = Column(
        JSON,
        default={
            "str": 10,
            "dex": 10,
            "con": 10,
            "int": 10,
            "wis": 10,
            "cha": 10,
        },
    )

    data = Column(JSON, default={})

    # Legacy-поля пока оставляем
    gold = Column(Integer, default=1000)
    inventory = Column(JSON, default=[])
    cart = Column(JSON, default=[])
    reserved = Column(JSON, default=[])

    gm_notes = Column(JSON, default={})
    cabinet_data = Column(JSON, default={})

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="characters")
>>>>>>> Stashed changes
