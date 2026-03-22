from sqlalchemy import create_engine, Column, Integer, String, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://trader:traderpass@db:5432/dnd_trader")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class Trader(Base):
    __tablename__ = "traders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String)          # "всё", "оружие", "травник", "еда"
    items = Column(JSON)               # список товаров в JSON
    region = Column(String)            # "север", "юг", "восток", "запад"
    level_min = Column(Integer)
    level_max = Column(Integer)
