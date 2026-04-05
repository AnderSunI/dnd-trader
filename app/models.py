from sqlalchemy import Column, Integer, String, JSON, Table, ForeignKey, Float, Boolean, DateTime
from sqlalchemy.orm import relationship
from .database import Base
import bcrypt
from datetime import datetime

# Связующая таблица (без лишних полей)
trader_items = Table(
    "trader_items", Base.metadata,
    Column("trader_id", Integer, ForeignKey("traders.id"), primary_key=True),
    Column("item_id", Integer, ForeignKey("items.id"), primary_key=True),
    Column("price_gold", Integer, default=0),
    Column("quantity", Integer, default=1),
    Column("discount", Integer, default=0),
    Column("is_limited", Boolean, default=False),
)

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
    rarity_tier = Column(Integer, default=0)
    stock = Column(Integer, default=0)
    traders = relationship("Trader", secondary=trader_items, back_populates="items")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    characters = relationship("Character", back_populates="user", cascade="all, delete-orphan")

    def set_password(self, password):
        self.hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    def check_password(self, password):
        return bcrypt.checkpw(password.encode(), self.hashed_password.encode())

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
    stats = Column(JSON, default={"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10})
    data = Column(JSON, default={})
    gold = Column(Integer, default=1000)
    inventory = Column(JSON, default=[])
    cart = Column(JSON, default=[])
    reserved = Column(JSON, default=[])
    gm_notes = Column(JSON, default={})
    cabinet_data = Column(JSON, default={"history":"","quests":[],"files":[],"playerNotes":"","mapImage":""})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user = relationship("User", back_populates="characters")