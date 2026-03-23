from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from .models import SessionLocal, Trader
import json

app = FastAPI(title="D&D Trader")

#@app.get("/")
#def read_root():
#    return {"message": "Hello, D&D trader!"}

@app.get("/traders")
def get_traders():
    db = SessionLocal()
    traders = db.query(Trader).all()
    db.close()
    result = []
    for t in traders:
        result.append({
            "id": t.id,
            "name": t.name,
            "category": t.category,
            "items": json.loads(t.items),
            "region": t.region,
            "level_min": t.level_min,
            "level_max": t.level_max
        })
    return result

# Подключаем статическую папку frontend, чтобы можно было открыть index.html
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
