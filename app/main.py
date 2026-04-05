from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from .config import APP_TITLE, FRONTEND_DIR
from .database import engine
from .models import Base
from .routers import traders, auth, characters, admin
from .routers.inventory import router as inventory_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title=APP_TITLE)

app.include_router(traders.router)
app.include_router(auth.create_auth_router())
app.include_router(characters.router)
app.include_router(admin.router)      # если у тебя есть admin.py
app.include_router(inventory_router)  # если нужен

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR / "images")), name="static")
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")