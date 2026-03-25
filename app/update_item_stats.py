# ============================================================
# update_items_stats.py – Скрипт для обновления характеристик предметов
# Используется, когда нужно подправить статы, не пересоздавая всю БД.
# ============================================================

from app.models import SessionLocal, Item
import json
import sys
import os

# Добавляем путь к проекту, чтобы импорты работали из любого места
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

db = SessionLocal()

# ------------------------------------------------------------
# Словарь с новыми данными для предметов
# Ключ – название предмета (должно точно совпадать с названием в БД)
# ------------------------------------------------------------
stats_map = {
    # ===== ОРУЖИЕ =====
    "Длинный меч": {
        "weight": 3,
        "price_gold": 15.0,               # цена в золотых (будет разложена на золото/серебро)
        "properties": json.dumps({"damage": "1d8", "damage_type": "колющий"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Короткий меч": {
        "weight": 2,
        "price_gold": 10.0,
        "properties": json.dumps({"damage": "1d6", "damage_type": "колющий"}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": False,
        "attunement": False
    },
    "Короткий меч +1": {
        "weight": 2,
        "price_gold": 200.0,
        "properties": json.dumps({"damage": "1d6+1", "damage_type": "колющий", "bonus": 1}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": True,
        "attunement": False
    },
    "Боевой топор": {
        "weight": 4,
        "price_gold": 10.0,
        "properties": json.dumps({"damage": "1d8", "versatile": "1d10"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Длинный лук": {
        "weight": 2,
        "price_gold": 50.0,
        "properties": json.dumps({"damage": "1d8", "range": "150/600"}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": False,
        "attunement": False
    },
    "Лёгкий арбалет": {
        "weight": 5,
        "price_gold": 25.0,
        "properties": json.dumps({"damage": "1d8", "range": "80/320", "loading": True}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Лук охотника": {
        "weight": 2,
        "price_gold": 50.0,
        "properties": json.dumps({"damage": "1d8", "range": "150/600"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Кинжал культистов": {
        "weight": 1,
        "price_gold": 300.0,
        "properties": json.dumps({"damage": "1d4", "damage_type": "колющий", "curse": "проклятие при ударе"}),
        "requirements": json.dumps({}),
        "is_magical": True,
        "attunement": True
    },
    "Старый кинжал": {
        "weight": 1,
        "price_gold": 2.0,
        "properties": json.dumps({"damage": "1d4"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ДОСПЕХИ =====
    "Кольчуга": {
        "weight": 20,
        "price_gold": 75.0,
        "properties": json.dumps({"ac": 16, "stealth": "disadvantage"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Кожаный доспех": {
        "weight": 10,
        "price_gold": 10.0,
        "properties": json.dumps({"ac": 11, "type": "light"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Щит": {
        "weight": 6,
        "price_gold": 10.0,
        "properties": json.dumps({"ac": 2}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ИНСТРУМЕНТЫ И МАТЕРИАЛЫ =====
    "Набор кузнечных инструментов": {
        "weight": 8,
        "price_gold": 20.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Набор столярных инструментов": {
        "weight": 6,
        "price_gold": 8.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Железная цепь (10 футов)": {
        "weight": 10,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Подковы (4 шт)": {
        "weight": 12,
        "price_gold": 4.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Выделанная воловья шкура": {
        "weight": 15,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Мех лисы": {
        "weight": 1,
        "price_gold": 3.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Кожаный ремень": {
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ЕДА И НАПИТКИ =====
    "Крошковый пирог": {
        "weight": 0.5,
        "price_gold": 0.3,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Свежая буханка": {
        "weight": 0.3,
        "price_gold": 0.05,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Сырная булочка": {
        "weight": 0.2,
        "price_gold": 0.1,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Пирог с ягодами": {
        "weight": 0.4,
        "price_gold": 0.2,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Кружка эля": {
        "weight": 0.5,
        "price_gold": 0.1,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Тарелка жаркого": {
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Дорожный паёк (7 дней)": {
        "weight": 5,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== КНИГИ, КАРТЫ, СОКРОВИЩА =====
    "Путевой дневник купца": {
        "weight": 1,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Старая карта долины Дессарин": {
        "weight": 0.2,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Серебряное зеркальце": {
        "weight": 0.5,
        "price_gold": 15.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== УСЛУГИ =====
    "Стрижка и бритьё": {
        "weight": 0,
        "price_gold": 0.2,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Баня": {
        "weight": 0,
        "price_gold": 0.5,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Ночёвка в пансионе": {
        "weight": 0,
        "price_gold": 0.5,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ЗЕЛЬЯ, СВИТКИ =====
    "Зелье лечения": {
        "weight": 0.5,
        "price_gold": 50.0,
        "properties": json.dumps({"healing": "2d4+2"}),
        "requirements": json.dumps({}),
        "is_magical": True,
        "attunement": False
    },
    "Свиток «Небесные письмена»": {
        "weight": 0,
        "price_gold": 100.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({"spellcasting": True}),
        "is_magical": True,
        "attunement": False
    },
    "Яд слабости": {
        "weight": 0.1,
        "price_gold": 75.0,
        "properties": json.dumps({"effect": "ослабление"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Сбор трав (10 доз)": {
        "weight": 1,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ТРАНСПОРТ =====
    "Фургон (обычный)": {
        "weight": 500,
        "price_gold": 35.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Повозка (лёгкая)": {
        "weight": 300,
        "price_gold": 25.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Запасное колесо": {
        "weight": 30,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Ось": {
        "weight": 20,
        "price_gold": 3.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Б/у фургон": {
        "weight": 500,
        "price_gold": 20.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Колёса (б/у)": {
        "weight": 30,
        "price_gold": 2.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== КАМЕНЬ И СТРОЙМАТЕРИАЛЫ =====
    "Мраморная плита (2х2)": {
        "weight": 150,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Бутовый камень (корзина)": {
        "weight": 50,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ОДЕЖДА =====
    "Плащ с капюшоном": {
        "weight": 2,
        "price_gold": 2.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Шляпа с широкими полями": {
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Сапоги на меху": {
        "weight": 1,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Шёлковая рубашка": {
        "weight": 0.5,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # Добавь сюда остальные предметы, если нужно
}


# ------------------------------------------------------------
# Вспомогательная функция для конвертации цены из float в (золото, серебро, медь)
# ------------------------------------------------------------
def convert_price(price_gold_float):
    """
    Принимает цену в золотых как число с плавающей точкой (например, 1.23)
    Возвращает кортеж (gold, silver, copper) целых чисел
    """
    total_copper = int(round(price_gold_float * 10000))  # 1 зол. = 10000 медных
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper


# ------------------------------------------------------------
# Основной цикл обновления
# ------------------------------------------------------------
items = db.query(Item).all()
updated = 0
skipped = 0

for item in items:
    if item.name in stats_map:
        data = stats_map[item.name]
        # Обновляем поля, если они есть в словаре
        if "weight" in data:
            item.weight = data["weight"]
        if "properties" in data:
            item.properties = data["properties"]
        if "requirements" in data:
            item.requirements = data["requirements"]
        if "is_magical" in data:
            item.is_magical = data["is_magical"]
        if "attunement" in data:
            item.attunement = data["attunement"]

        # Обработка цены: если указан price_gold, пересчитываем gold, silver, copper
        if "price_gold" in data:
            gold_int, silver_int, copper_int = convert_price(data["price_gold"])
            item.price_gold = gold_int
            item.price_silver = silver_int
            item.price_copper = copper_int

        # Если нужно, можно добавить обновление stock или quality,
        # но в данном словаре их нет – оставляем как есть.

        print(f"Обновлён: {item.name} | нов.цена: {item.price_gold}з {item.price_silver}с {item.price_copper}м")
        updated += 1
    else:
        # Предмет не найден в словаре – просто пропускаем
        # (можно раскомментировать следующую строку для отладки)
        # print(f"Предмет не найден в словаре: {item.name}")
        skipped += 1

db.commit()
db.close()

print(f"\n✅ Готово. Обновлено {updated} предметов. Пропущено {skipped} (не были в словаре).")