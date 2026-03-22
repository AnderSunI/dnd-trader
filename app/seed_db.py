from app.models import SessionLocal, Trader, engine, Base
import json

# Создать таблицы, если их нет
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Проверяем, есть ли уже данные
if db.query(Trader).count() == 0:
    traders_data = [
        {
            "name": "Торговец Аркадий",
            "category": "всё",
            "items": json.dumps(["зелье лечения", "факел", "верёвка"]),
            "region": "север",
            "level_min": 1,
            "level_max": 3
        },
        {
            "name": "Оружейник Вольфганг",
            "category": "оружие",
            "items": json.dumps(["короткий меч", "лук", "кинжал"]),
            "region": "юг",
            "level_min": 2,
            "level_max": 5
        }
    ]
    for data in traders_data:
        trader = Trader(**data)
        db.add(trader)
    db.commit()
    print("База заполнена тестовыми данными")
else:
    print("Данные уже есть, пропускаем")

db.close()
