<<<<<<< Updated upstream
# ============================================================
# seed_db.py – Скрипт наполнения базы данных начальными данными
# ============================================================

from app.models import SessionLocal, Trader, Item, Base, engine, trader_items
import json
from sqlalchemy import text
=======
# app/seed_db.py
from __future__ import annotations

>>>>>>> Stashed changes

# -------------------- 1. СОЗДАНИЕ ТАБЛИЦ И ДОБАВЛЕНИЕ НОВЫХ КОЛОНОК --------------------
# Создаём таблицы, если их ещё нет (на основе моделей)
Base.metadata.create_all(bind=engine)

# Добавляем колонки, которые могли появиться позже, чтобы не сломать старые базы
with engine.connect() as conn:
    # Для предметов
    conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0"))
    conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS price_silver INTEGER DEFAULT 0"))
    conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS price_copper INTEGER DEFAULT 0"))
    # Для торговцев (расширенная информация и золото)
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS personality TEXT"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS possessions JSON"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS rumors TEXT"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS gold INTEGER DEFAULT 0"))
    conn.commit()

db = SessionLocal()

# Очистка старых данных (чтобы не было дублей)
db.query(trader_items).delete()
db.query(Item).delete()
db.query(Trader).delete()
db.commit()
print("Старые данные удалены.")

# -------------------- 2. ТОРГОВЦЫ (26 штук, с золотом и расширенными полями) --------------------
traders_data = [
    {
        "name": "Элдрас Тантур",
        "type": "кузнец",
<<<<<<< Updated upstream
        "specialization": json.dumps(["оружие", "доспехи", "инструменты", "цепи"]),
        "gold": 500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 5,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Суровый, немногословный кузнец. Его семья куёт оружие и доспехи уже три поколения. Работает от зари до зари, ценит надёжность, а не красоту.",
        "image_url": "/static/images/eldras.jpg",
        "personality": "Молчалив и суров. Не терпит брака. Уважает тех, кто умеет работать руками. Может дать скидку, если попросить его о помощи в кузнечном деле.",
        "possessions": json.dumps(["Старый семейный молот", "Амулет с руной Морадина", "Кусок метеоритного железа"]),
        "rumors": "Говорят, у него в подвале хранится незаконченный клинок из звёздного металла. Если помочь ему найти редкий ингредиент, он, возможно, закончит его для героев."
=======
        "specialization": {
            "primary": "оружие и доспехи",
            "tags": ["оружие", "доспехи", "инструменты"],
        },
        "gold": 1500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 10,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Суровый кузнец. Его семья куёт оружие и доспехи уже не одно поколение.",
        "image_url": "/static/eldras.jpg",
        "personality": "Молчаливый, требовательный к качеству, уважает ремесло и тяжёлый труд.",
        "possessions": [
            "Старый семейный молот",
            "Амулет с кузнечной руной",
            "Кусок редкого железа",
        ],
        "rumors": "Говорят, у него в мастерской лежит незавершённый клинок для важного заказчика.",
        "race": "дварф",
        "class_name": "воин",
        "trader_level": 8,
        "stats": {
            "str": 17,
            "dex": 10,
            "con": 16,
            "int": 11,
            "wis": 12,
            "cha": 9,
        },
        "abilities": [
            "Кузнечное дело (мастер)",
            "Оценка металла",
            "Ремонт оружия и доспехов",
            "Владение молотом",
            "Выносливость",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Фенг Железноголовый",
        "type": "оружейник",
<<<<<<< Updated upstream
        "specialization": json.dumps(["мечи", "луки", "арбалеты", "щиты"]),
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 6,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Полуорк, отставной наёмник. Знает толк в оружии, сам чинит и продаёт. Добродушен, но сразу определит, какой меч прослужит дольше.",
        "image_url": "/static/images/feng.jpg",
        "personality": "Добродушный, но не терпит халтуры. Любит рассказывать байки о своих приключениях. Всегда предложит что-то крепкое выпить.",
        "possessions": json.dumps(["Старый боевой топор", "Пара самодельных наручей", "Фляга с крепким элем"]),
        "rumors": "В молодости служил в наёмниках у одного лорда. Говорят, знает тайный проход в старые рудники."
=======
        "specialization": {
            "primary": "вооружение",
            "tags": ["мечи", "луки", "арбалеты", "щиты"],
        },
        "gold": 1200,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 10,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Полуорк, отставной наёмник. Знает толк в хорошем оружии и плохих решениях.",
        "image_url": "/static/feng.jpg",
        "personality": "Прямолинейный, практичный, не терпит халтуры, уважает силу и надёжность.",
        "possessions": [
            "Боевой топор прошлой службы",
            "Пара самодельных наручей",
            "Фляга с крепким элем",
        ],
        "rumors": "Ходят слухи, что он когда-то служил в отряде, исчезнувшем в Холмах.",
        "race": "полуорк",
        "class_name": "воин",
        "trader_level": 7,
        "stats": {
            "str": 17,
            "dex": 13,
            "con": 15,
            "int": 9,
            "wis": 11,
            "cha": 10,
        },
        "abilities": [
            "Оценка клинков",
            "Подгонка оружия под владельца",
            "Воинская выучка",
            "Запугивание",
            "Сильный удар",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Хельвур Тарнлар",
        "type": "портной",
<<<<<<< Updated upstream
        "specialization": json.dumps(["мужская одежда", "плащи", "шляпы", "обувь"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "одежда и ткани",
            "tags": ["одежда", "плащи", "шляпы", "обувь"],
        },
        "gold": 450,
>>>>>>> Stashed changes
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 4,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Надменный портной, строит из себя знатока высшего света. Продаёт добротные плащи и сапоги, но любит приврать о своих клиентах из Невервинтера.",
        "image_url": "/static/images/helvur.jpg",
        "personality": "Надменный, любит приврать о знатных клиентах. Ценит тонкие ткани и хорошие манеры.",
        "possessions": json.dumps(["Золотая игла", "Ткань из эльфийской паутины", "Список 'важных' клиентов"]),
        "rumors": "Поговаривают, что он шьёт для членов Культа Дракона, но сам он отрицает."
    },
    {
        "name": "Мэйгла Тарнлар",
        "type": "портниха",
        "specialization": json.dumps(["женская одежда", "платья", "шарфы", "перчатки"]),
        "gold": 500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 4,
        "restock_days": 10,
        "currency": "золотые",
        "description": "Жена Хельвура, настоящий талант в шитье. Более приятна в общении, может подобрать одежду для любого случая.",
        "image_url": "/static/images/maegla.jpg",
        "personality": "Добрая и заботливая. Умеет успокоить клиента, всегда даст полезный совет.",
        "possessions": json.dumps(["Семейный напёрсток", "Коллекция образцов тканей", "Портрет мужа"]),
        "rumors": "Она тайно помогает Арфистам, передавая информацию через одежду."
=======
        "description": "Надменный портной, строящий из себя знатока моды и хороших манер.",
        "image_url": "/static/helvur.jpg",
        "personality": "Тщеславный, язвительный, любит хвастаться редкими тканями и клиентами.",
        "possessions": [
            "Золотая игла",
            "Рулон дорогой ткани",
            "Книга заказов",
        ],
        "rumors": "Говорят, он шьёт не только знатью, но и людям с сомнительной репутацией.",
        "race": "человек",
        "class_name": "эксперт",
        "trader_level": 3,
        "stats": {
            "str": 8,
            "dex": 15,
            "con": 10,
            "int": 13,
            "wis": 11,
            "cha": 15,
        },
        "abilities": [
            "Портняжное дело (эксперт)",
            "Оценка тканей",
            "Подгонка одежды",
            "Этикет",
            "Ловкость рук",
        ],
>>>>>>> Stashed changes
    },
    # Остальные торговцы – без кастомных personality/possessions/rumors, но с золотом
    {
        "name": "Фаендра Чансирл",
        "type": "кожевник",
<<<<<<< Updated upstream
        "specialization": json.dumps(["кожаные доспехи", "сбруя", "сумки", "сапоги"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "кожа и снаряжение",
            "tags": ["кожаные доспехи", "сумки", "сапоги", "сбруя"],
        },
        "gold": 650,
>>>>>>> Stashed changes
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
<<<<<<< Updated upstream
        "level_max": 4,
        "restock_days": 8,
        "currency": "золотые",
        "description": "Молодая женщина, мечтающая о приключениях. Шьёт отличные кожаные доспехи и упряжь. Сама носит кожаный доспех с тиснением.",
        "image_url": "/static/images/phaendra.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Улро Лурут",
        "type": "дубильщик",
        "specialization": json.dumps(["кожа", "меха", "шкуры", "ремни"]),
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Пропах дубильными растворами, но шкуры выделывает на совесть. Продаёт готовую кожу, меха, ремни. Молчалив, но может рассказать о зверях в округе.",
        "image_url": "/static/images/ulro.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Кайлесса Иркелл",
        "type": "трактирщица",
        "specialization": json.dumps(["горячие блюда", "эль", "вино", "ночлег"]),
=======
        "level_max": 5,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Молодая мастерица, шьющая крепкие дорожные вещи и кожаные доспехи.",
        "image_url": "/static/phaendra.jpg",
        "personality": "Собранная, любознательная, любит истории о дальних дорогах.",
        "possessions": [
            "Дорожный кожаный доспех",
            "Нож для выделки",
            "Книга о приключенцах",
        ],
        "rumors": "Слышала о заброшенном лагере искателей приключений неподалёку.",
        "race": "полуэльф",
        "class_name": "следопыт",
        "trader_level": 4,
        "stats": {
            "str": 10,
            "dex": 16,
            "con": 12,
            "int": 10,
            "wis": 14,
            "cha": 12,
        },
        "abilities": [
            "Кожевничество (мастер)",
            "Починка дорожного снаряжения",
            "Выживание",
            "Следопытство",
            "Меткий выстрел",
        ],
    },
    {
        "name": "Кайлесса Иркелл",
        "type": "трактирщик",
        "specialization": {
            "primary": "еда и ночлег",
            "tags": ["горячие блюда", "эль", "вино", "ночлег"],
        },
>>>>>>> Stashed changes
        "gold": 500,
        "reputation": 3,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Хозяйка «Раскачивающегося меча». Заботливая, знает все новости. Готовит сытные обеды, наливает отличный эль.",
        "image_url": "/static/images/kaylessa.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Гарлен Харлатурл",
        "type": "тавернщик",
        "specialization": json.dumps(["эль", "пиво", "жаркое", "суп"]),
        "gold": 500,
=======
        "description": "Хозяйка трактира, знающая местные новости лучше многих стражников.",
        "image_url": "/static/kaylessa.jpg",
        "personality": "Тёплая, наблюдательная, умеет быстро понять, кто перед ней.",
        "possessions": [
            "Семейная поваренная книга",
            "Связка ключей от комнат",
            "Старый короткий меч",
        ],
        "rumors": "Слышала разговоры подозрительных путников и запомнила больше, чем показывает.",
        "race": "человек",
        "class_name": "эксперт",
        "trader_level": 2,
        "stats": {
            "str": 10,
            "dex": 11,
            "con": 12,
            "int": 12,
            "wis": 15,
            "cha": 15,
        },
        "abilities": [
            "Кулинария (мастер)",
            "Ведение трактира",
            "Сбор слухов",
            "Чтение людей",
            "Убеждение",
        ],
    },
    {
        "name": "Гарлен Харлатурл",
        "type": "трактирщик",
        "specialization": {
            "primary": "еда и выпивка",
            "tags": ["пиво", "эль", "жаркое", "ночлег"],
        },
        "gold": 350,
>>>>>>> Stashed changes
        "reputation": -1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Владелец «Полуденного шлема». Циничный, но внимательный хозяин. У него всегда есть местное пиво и недорогие закуски.",
        "image_url": "/static/images/garlen.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Циничный хозяин трактира с хорошей памятью на лица, долги и неприятности.",
        "image_url": "/static/garlen.jpg",
        "personality": "Недоверчивый, сухой, приземлённый и расчётливый.",
        "possessions": [
            "Бухгалтерская книга",
            "Нож для разделки мяса",
            "Тайная полка с хорошим вином",
        ],
        "rumors": "Имеет старые долги перед людьми, с которыми лучше не спорить.",
        "race": "человек",
        "class_name": "эксперт",
        "trader_level": 2,
        "stats": {
            "str": 11,
            "dex": 10,
            "con": 12,
            "int": 12,
            "wis": 13,
            "cha": 10,
        },
        "abilities": [
            "Ведение хозяйства",
            "Оценка риска",
            "Торговый расчёт",
            "Наблюдательность",
            "Крепкая рука",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Мангобарл Лоррен",
        "type": "пекарь",
<<<<<<< Updated upstream
        "specialization": json.dumps(["хлеб", "пироги", "булочки", "кексы"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "выпечка",
            "tags": ["хлеб", "пироги", "булочки", "сладости"],
        },
        "gold": 300,
>>>>>>> Stashed changes
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Энергичный пекарь, знает все сплетни. Его «крошковый пирог» знаменит на всю округу. Втайне сотрудничает с Жентаримом.",
        "image_url": "/static/images/mangobarl.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Нахазлья Дроут",
        "type": "птицевод",
        "specialization": json.dumps(["куры", "гуси", "яйца", "перья"]),
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 2,
        "currency": "золотые",
        "description": "Владелица «Домашней птицы Дроут». Продаёт живую птицу, яйца, потроха. Практичная женщина, не любит пустых разговоров.",
        "image_url": "/static/images/nahaeliya.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Энергичный пекарь, через которого проходят все местные сплетни.",
        "image_url": "/static/mangobarl.jpg",
        "personality": "Шустрый, общительный, любопытный, но не дурак.",
        "possessions": [
            "Секретный рецепт",
            "Тетрадь с именами клиентов",
            "Небольшой тайник с выручкой",
        ],
        "rumors": "За плату может сказать, кто с кем встречался и кто что покупал.",
        "race": "полурослик",
        "class_name": "эксперт",
        "trader_level": 2,
        "stats": {
            "str": 8,
            "dex": 14,
            "con": 12,
            "int": 12,
            "wis": 11,
            "cha": 15,
        },
        "abilities": [
            "Выпечка (мастер)",
            "Сбор слухов",
            "Торговая сеть",
            "Ловкость рук",
            "Быстрые ноги",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Ялесса Орнра",
        "type": "мясник",
<<<<<<< Updated upstream
        "specialization": json.dumps(["говядина", "свинина", "колбасы", "копчёности"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "мясо и копчёности",
            "tags": ["мясо", "колбасы", "копчёности", "жир"],
        },
        "gold": 320,
>>>>>>> Stashed changes
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Крепкая женщина, забивает скот и продаёт мясо. Живёт вместе с констеблем. Умеет разделать тушу и посоветовать лучший кусок.",
        "image_url": "/static/images/yalesa.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Минтра Мандивьер",
        "type": "птицевод",
        "specialization": json.dumps(["цыплята", "яйца", "маринованные яйца"]),
        "gold": 500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 2,
        "currency": "золотые",
        "description": "Милая старушка, торгует живностью и соленьями. Знает многие городские тайны, но не болтлива.",
        "image_url": "/static/images/minthra.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Крепкая женщина, привыкшая к тяжёлой работе и резким разговорам.",
        "image_url": "/static/yalesa.jpg",
        "personality": "Суровая, честная, не любит пустых угроз.",
        "possessions": [
            "Большой мясницкий нож",
            "Тяжёлый фартук",
            "Запас специй для копчения",
        ],
        "rumors": "Может знать больше о недавних смертях, чем хочет показывать.",
        "race": "человек",
        "class_name": "воин",
        "trader_level": 2,
        "stats": {
            "str": 16,
            "dex": 10,
            "con": 14,
            "int": 9,
            "wis": 12,
            "cha": 10,
        },
        "abilities": [
            "Разделка туш",
            "Знание анатомии",
            "Физическая мощь",
            "Владение тесаком",
            "Хладнокровие",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Грунд",
        "type": "торговец",
<<<<<<< Updated upstream
        "specialization": json.dumps(["соленья", "овощи", "грибы"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "простая провизия",
            "tags": ["соленья", "овощи", "грибы", "мелкий провиант"],
        },
        "gold": 250,
>>>>>>> Stashed changes
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Полуорк, местный дурачок. Торгует соленьями на рынке. Наивный и добрый, часто раздаёт товар даром.",
        "image_url": "/static/images/grund.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Полуорк, торгующий запасами и соленьями. Простоват, но по-своему сметлив.",
        "image_url": "/static/grund.jpg",
        "personality": "Добрый, упрямый, прямой, не любит обман.",
        "possessions": [
            "Большая кадка с огурцами",
            "Потрёпанный фартук",
            "Нож для резки овощей",
        ],
        "rumors": "Иногда вспоминает странных покупателей и места, о которых сам не всё понимает.",
        "race": "полуорк",
        "class_name": "простолюдин",
        "trader_level": 1,
        "stats": {
            "str": 14,
            "dex": 8,
            "con": 13,
            "int": 9,
            "wis": 10,
            "cha": 10,
        },
        "abilities": [
            "Засолка и хранение продуктов",
            "Переноска грузов",
            "Тяжёлый труд",
            "Добродушие",
            "Сильные руки",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Эндрит Валливой",
        "type": "старьёвщик",
<<<<<<< Updated upstream
        "specialization": json.dumps(["книги", "карты", "инструменты", "раритеты"]),
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 5,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Застенчивый коллекционер. В его лавке можно найти всё: от старых книг до загадочных артефактов. Сотрудничает с Арфистами.",
        "image_url": "/static/images/endrith.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Марландро Газлькур",
        "type": "цирюльник / старьёвщик",
        "specialization": json.dumps(["стрижка", "подержанные вещи", "слухи", "фальшивомонетничество"]),
=======
        "specialization": {
            "primary": "книги и редкости",
            "tags": ["книги", "карты", "инструменты", "артефакты"],
        },
        "gold": 900,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 9,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Собиратель редкостей и старых книг, внимательный к деталям и слишком любопытный.",
        "image_url": "/static/endrith.jpg",
        "personality": "Замкнутый, наблюдательный, эрудированный, немного нервный.",
        "possessions": [
            "Увеличительное стекло",
            "Блокнот с заметками",
            "Старая карта с пометками",
        ],
        "rumors": "Может знать легенду о древних камнях стихий лучше, чем говорит вслух.",
        "race": "гном",
        "class_name": "учёный",
        "trader_level": 6,
        "stats": {
            "str": 8,
            "dex": 11,
            "con": 11,
            "int": 17,
            "wis": 14,
            "cha": 10,
        },
        "abilities": [
            "История",
            "Археология",
            "Оценка артефактов",
            "Идентификация магических свойств",
            "Древние языки",
        ],
    },
    {
        "name": "Марландро Газлькур",
        "type": "цирюльник",
        "specialization": {
            "primary": "услуги и подержанный товар",
            "tags": ["стрижка", "бритьё", "подержанные вещи", "слухи"],
        },
>>>>>>> Stashed changes
        "gold": 500,
        "reputation": -2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
<<<<<<< Updated upstream
        "level_min": 1,
        "level_max": 4,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Цирюльник и торговец подержанными вещами. Сомнительная личность, но у него можно узнать последние новости и купить недорогой инструмент.",
        "image_url": "/static/images/marlandro.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Хазлия Ханадроум",
        "type": "банщица / портниха",
        "specialization": json.dumps(["баня", "женские платья", "аромамасла"]),
        "gold": 500,
=======
        "level_min": 2,
        "level_max": 5,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Цирюльник и скупщик вещей. Скользкий тип, умеющий быть полезным в неприятных делах.",
        "image_url": "/static/marlandro.jpg",
        "personality": "Хитрый, осторожный, любит выгоду и чужие секреты.",
        "possessions": [
            "Набор бритв",
            "Краплёная колода карт",
            "Книжка долгов и слухов",
        ],
        "rumors": "Знает путь в старые подвалы и не всегда спрашивает, зачем он нужен.",
        "race": "человек",
        "class_name": "плут",
        "trader_level": 4,
        "stats": {
            "str": 8,
            "dex": 16,
            "con": 10,
            "int": 14,
            "wis": 11,
            "cha": 14,
        },
        "abilities": [
            "Цирюльное дело",
            "Ловкость рук",
            "Сбор слухов",
            "Подделка мелочей",
            "Скрытная атака",
        ],
    },
    {
        "name": "Хазлия Ханадроум",
        "type": "банщица",
        "specialization": {
            "primary": "баня и уход",
            "tags": ["баня", "масла", "платья", "травы"],
        },
        "gold": 420,
>>>>>>> Stashed changes
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Управляет купальней и шьёт женские платья. Помогает Изумрудному Анклаву. В её заведении приятно отдохнуть после дороги.",
        "image_url": "/static/images/hazlia.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Управляет купальней и разбирается в травах, ароматах и чужом самочувствии.",
        "image_url": "/static/hazlia.jpg",
        "personality": "Доброжелательная, собранная, умеет успокаивать и слушать.",
        "possessions": [
            "Сборник рецептов масел",
            "Швейный набор",
            "Связки сушёных трав",
        ],
        "rumors": "Знает, где искать редкие растения для сильных зелий.",
        "race": "полуэльф",
        "class_name": "друид",
        "trader_level": 3,
        "stats": {
            "str": 8,
            "dex": 12,
            "con": 12,
            "int": 12,
            "wis": 16,
            "cha": 13,
        },
        "abilities": [
            "Травничество",
            "Банное дело",
            "Шитьё",
            "Знание природы",
            "Природная интуиция",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Мамаша Яланта Дрин",
        "type": "пансион",
<<<<<<< Updated upstream
        "specialization": json.dumps(["ночлег", "слухи", "временные работники"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "дешёвый ночлег",
            "tags": ["комнаты", "слухи", "еда", "временный постой"],
        },
        "gold": 300,
>>>>>>> Stashed changes
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Сдаёт дешёвые комнаты. Любит послушать и рассказать сплетни. Иногда может найти подёнщика для работы.",
        "image_url": "/static/images/yalanta.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Тёрск Телорн",
        "type": "мастер фургонов",
        "specialization": json.dumps(["фургоны", "колёса", "ремонт"]),
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 4,
        "restock_days": 10,
        "currency": "золотые",
        "description": "Вместе с братом Асданом делает лучшие фургоны на Север. Всегда занят, но найдёт время помочь путнику.",
        "image_url": "/static/images/thorsk.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Асдан Телорн",
        "type": "мастер фургонов",
        "specialization": json.dumps(["фургоны", "колёса", "ремонт"]),
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 4,
        "restock_days": 10,
        "currency": "золотые",
        "description": "Младший брат Тёрска, такой же умелец. С ним можно договориться о срочном ремонте.",
        "image_url": "/static/images/asdan.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Ильмет Вэльвур",
        "type": "мастер фургонов",
        "specialization": json.dumps(["дешёвые фургоны", "запчасти", "б/у"]),
        "gold": 500,
        "reputation": -1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 4,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Конкурент Телорнов, делает более дешёвые фургоны. Пьющий, но с ним можно поторговаться.",
        "image_url": "/static/images/ilmet.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Албери Миллико",
        "type": "каменотёс",
        "specialization": json.dumps(["каменные блоки", "мрамор", "строительный камень"]),
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 5,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Владелица каменоломни. Поставщик камня для Глубоководья. Весёлая женщина, но скрывает тайну подземного хода.",
        "image_url": "/static/images/albaeri.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Сдаёт дешёвые комнаты и всегда знает, кто приехал, кто соврал и кто что скрывает.",
        "image_url": "/static/yalanta.jpg",
        "personality": "Болтливая, цепкая, наблюдательная, любит порядок по-своему.",
        "possessions": [
            "Тетрадь постояльцев",
            "Ключница",
            "Тяжёлая деревянная ложка",
        ],
        "rumors": "Через её пансион проходят люди, которым не по карману хорошие гостиницы и не по вкусу лишние вопросы.",
        "race": "человек",
        "class_name": "эксперт",
        "trader_level": 2,
        "stats": {
            "str": 9,
            "dex": 10,
            "con": 12,
            "int": 12,
            "wis": 14,
            "cha": 13,
        },
        "abilities": [
            "Ведение пансиона",
            "Сбор слухов",
            "Чтение людей",
            "Организация труда",
            "Жёсткий характер",
        ],
    },
    {
        "name": "Тарм Громовой Молот",
        "type": "оружейный мастер",
        "specialization": {
            "primary": "боевое снаряжение",
            "tags": ["оружие", "броня", "ремонт", "воинские заказы"],
        },
        "gold": 1400,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Ред-Ларч",
        "level_min": 4,
        "level_max": 8,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Старый мастер, кующий снаряжение не для красоты, а для выживания в бою.",
        "image_url": "/static/tarm.jpg",
        "personality": "Сдержанный, опытный, не любит пустую браваду.",
        "possessions": [
            "Клещи из чёрной стали",
            "Старый нагрудник",
            "Журнал заказов",
        ],
        "rumors": "Когда-то ковал снаряжение для наёмников, исчезнувших в Холмах.",
        "race": "дварф",
        "class_name": "воин",
        "trader_level": 6,
        "stats": {
            "str": 17,
            "dex": 10,
            "con": 16,
            "int": 11,
            "wis": 13,
            "cha": 10,
        },
        "abilities": [
            "Кузнечное дело",
            "Ремонт оружия",
            "Оценка боевого снаряжения",
            "Стойкость",
            "Воинская выучка",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Аэрего Кейлин",
        "type": "складской владелец",
        "specialization": {
            "primary": "логистика и хранение",
            "tags": ["ящики", "инструменты", "провизия", "учёт"],
        },
        "gold": 700,
        "reputation": 1,
        "region": "Долина Дессарин",
<<<<<<< Updated upstream
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 5,
        "restock_days": 30,
        "currency": "золотые",
        "description": "Сдаёт складские помещения. Не задаёт лишних вопросов. Может помочь с перевозкой грузов.",
        "image_url": "/static/images/aerego.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "settlement": "Ред-Ларч",
        "level_min": 2,
        "level_max": 5,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Спокойный складской управляющий, который ценит порядок, сроки и молчание.",
        "image_url": "/static/aerego.jpg",
        "personality": "Собранный, надёжный, предпочитает порядок эмоциям.",
        "possessions": [
            "Амбарная книга",
            "Набор весов",
            "Связка ключей",
        ],
        "rumors": "Видел, как по ночам перевозили странные ящики, но предпочёл не спрашивать.",
        "race": "человек",
        "class_name": "эксперт",
        "trader_level": 4,
        "stats": {
            "str": 10,
            "dex": 10,
            "con": 12,
            "int": 14,
            "wis": 12,
            "cha": 11,
        },
        "abilities": [
            "Логистика",
            "Учёт",
            "Оценка груза",
            "Организация охраны",
            "Самообладание",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Херивин Дардрагон",
        "type": "трактирщик",
<<<<<<< Updated upstream
        "specialization": json.dumps(["эль", "комнаты", "картины", "безделушки"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "постоялый двор",
            "tags": ["эль", "комнаты", "еда", "безделушки"],
        },
        "gold": 450,
>>>>>>> Stashed changes
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Вестбридж",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Полурослик, владелец «Урожая». Коллекционирует картины. Радушный хозяин, знает всё о дорогах.",
        "image_url": "/static/images/herivin.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Полурослик, владелец уютного постоялого двора, любящий истории и хорошие вещицы.",
        "image_url": "/static/herivin.jpg",
        "personality": "Радушный, любознательный, обаятельный.",
        "possessions": [
            "Коллекция маленьких картин",
            "Путевой дневник",
            "Бочонок эля",
        ],
        "rumors": "Может иметь карту старых дорог, о которой говорит не каждому.",
        "race": "полурослик",
        "class_name": "эксперт",
        "trader_level": 2,
        "stats": {
            "str": 8,
            "dex": 13,
            "con": 10,
            "int": 12,
            "wis": 12,
            "cha": 16,
        },
        "abilities": [
            "Гостеприимство",
            "Сбор историй",
            "Убеждение",
            "Знание дорог",
            "Лёгкая рука с пращой",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Нешор Флёрдин",
        "type": "трактирщик",
<<<<<<< Updated upstream
        "specialization": json.dumps(["эль", "горячее", "ночлег"]),
        "gold": 500,
=======
        "specialization": {
            "primary": "еда и комнаты",
            "tags": ["эль", "горячее", "ночлег"],
        },
        "gold": 400,
>>>>>>> Stashed changes
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Белиард",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 4,
        "currency": "золотые",
<<<<<<< Updated upstream
        "description": "Владелец «Бдительного рыцаря». Гостеприимный, любит поговорить о делегации из Мирабара.",
        "image_url": "/static/images/neshor.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "description": "Владелец трактира, кажущийся простаком, но прекрасно помнящий чужие лица и разговоры.",
        "image_url": "/static/neshor.jpg",
        "personality": "Гостеприимный, разговорчивый, внимательный к деталям.",
        "possessions": [
            "Книга постояльцев",
            "Трактирный медальон",
            "Старый короткий меч",
        ],
        "rumors": "Видел, как важные люди ушли в холмы и не вернулись.",
        "race": "человек",
        "class_name": "эксперт",
        "trader_level": 2,
        "stats": {
            "str": 10,
            "dex": 10,
            "con": 11,
            "int": 11,
            "wis": 12,
            "cha": 14,
        },
        "abilities": [
            "Ведение хозяйства",
            "Память на лица",
            "Сбор слухов",
            "Знание местности",
            "Крепкие нервы",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Шоалар Куандерил",
        "type": "контрабандист",
<<<<<<< Updated upstream
        "specialization": json.dumps(["книги", "редкие товары", "информация"]),
        "gold": 500,
        "reputation": -2,
        "region": "Долина Дессарин",
        "settlement": "Вомфорд",
        "level_min": 3,
        "level_max": 6,
        "restock_days": 20,
        "currency": "золотые",
        "description": "Дженази воды, капитан лодки. Торгует крадеными товарами и редкими книгами. Опасный тип.",
        "image_url": "/static/images/shoalar.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
=======
        "specialization": {
            "primary": "редкий и краденый товар",
            "tags": ["редкости", "информация", "тайные поставки", "книги"],
        },
        "gold": 2000,
        "reputation": -2,
        "region": "Долина Дессарин",
        "settlement": "Вомфорд",
        "level_min": 5,
        "level_max": 9,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Капитан лодки и посредник в делах, где золото часто важнее закона.",
        "image_url": "/static/shoalar.jpg",
        "personality": "Холодный, хитрый, опасно обаятельный.",
        "possessions": [
            "Карта речных путей",
            "Список клиентов",
            "Кинжал тонкой работы",
        ],
        "rumors": "Имеет связи с людьми, о которых лучше говорить шёпотом.",
        "race": "человек",
        "class_name": "плут",
        "trader_level": 7,
        "stats": {
            "str": 11,
            "dex": 17,
            "con": 13,
            "int": 14,
            "wis": 10,
            "cha": 16,
        },
        "abilities": [
            "Контрабанда",
            "Навигация",
            "Скрытность",
            "Уличные контакты",
            "Скрытая атака",
        ],
>>>>>>> Stashed changes
    },
    {
        "name": "Гариена",
        "type": "друид-травница",
<<<<<<< Updated upstream
        "specialization": json.dumps(["зелья", "яды", "лекарства", "свитки"]),
        "gold": 500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Чертоги Алой Луны",
        "level_min": 5,
        "level_max": 8,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Эльфийка-друид, ищущая ритуал Плетёного Гиганта. Продаёт целебные травы и зелья. Добра, но осторожна.",
        "image_url": "/static/images/gariena.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    }
]

# Сохраняем торговцев в БД
for data in traders_data:
    trader = Trader(**data)
    db.add(trader)
db.commit()
print(f"Добавлено {len(traders_data)} торговцев.")

# -------------------- 3. ПРЕДМЕТЫ (связка торговец–предмет) --------------------
# Здесь описываются все предметы, которые будут у каждого торговца.
# Структура: ключ – имя торговца (должно совпадать с именем в traders_data),
# значение – список предметов с полями.
items_by_trader = {
    "Элдрас Тантур": [
        {"name": "Длинный меч", "category": "оружие", "subcategory": "меч", "rarity": "обычный", "price_gold": 15, "weight": 3, "description": "Простой, но надёжный длинный меч. Хорош для пехоты.", "properties": json.dumps({"damage": "1d8", "damage_type": "колющий"}), "requirements": json.dumps({"strength": 13}), "is_magical": False, "attunement": False},
        {"name": "Кольчуга", "category": "броня", "subcategory": "средняя", "rarity": "обычный", "price_gold": 75, "weight": 20, "description": "Кольчужная рубаха, защищает от рубящих ударов.", "properties": json.dumps({"ac": 16, "stealth_disadvantage": True}), "requirements": json.dumps({"strength": 13}), "is_magical": False, "attunement": False},
        {"name": "Набор кузнечных инструментов", "category": "инструменты", "rarity": "обычный", "price_gold": 20, "weight": 10, "description": "Молот, клещи, зубило — всё для починки оружия и доспехов.", "properties": json.dumps({"tool": "smith"}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Железная цепь (10 футов)", "category": "снаряжение", "rarity": "обычный", "price_gold": 5, "weight": 10, "description": "Тяжёлая цепь, пригодится и для пут, и для крепления груза.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Боевой топор", "category": "оружие", "subcategory": "топор", "rarity": "обычный", "price_gold": 10, "weight": 4, "description": "Топор, сбалансированный для боя одной рукой.", "properties": json.dumps({"damage": "1d8", "damage_type": "рубящий"}), "requirements": json.dumps({"strength": 13}), "is_magical": False, "attunement": False},
        {"name": "Подковы (4 шт)", "category": "снаряжение", "rarity": "обычный", "price_gold": 4, "weight": 8, "description": "Кованые подковы для лошади или мула.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Фенг Железноголовый": [
        {"name": "Короткий меч", "category": "оружие", "subcategory": "меч", "rarity": "обычный", "price_gold": 10, "weight": 2, "description": "Надёжный клинок, удобный в ближнем бою.", "properties": json.dumps({"damage": "1d6", "damage_type": "колющий"}), "requirements": json.dumps({"strength": 11}), "is_magical": False, "attunement": False},
        {"name": "Длинный лук", "category": "оружие", "subcategory": "лук", "rarity": "обычный", "price_gold": 50, "weight": 2, "description": "Лучный лук из тиса, стреляет далеко и точно.", "properties": json.dumps({"damage": "1d8", "damage_type": "колющий", "range": "150/600"}), "requirements": json.dumps({"dexterity": 13}), "is_magical": False, "attunement": False},
        {"name": "Лёгкий арбалет", "category": "оружие", "subcategory": "арбалет", "rarity": "обычный", "price_gold": 25, "weight": 5, "description": "Компактный арбалет, удобен в караванах.", "properties": json.dumps({"damage": "1d8", "damage_type": "колющий", "range": "80/320"}), "requirements": json.dumps({"dexterity": 13}), "is_magical": False, "attunement": False},
        {"name": "Кожаный доспех", "category": "броня", "subcategory": "лёгкая", "rarity": "обычный", "price_gold": 10, "weight": 10, "description": "Проклёпанная кожа, хорошо защищает от лёгких ударов.", "properties": json.dumps({"ac": 11}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Щит", "category": "броня", "subcategory": "щит", "rarity": "обычный", "price_gold": 10, "weight": 6, "description": "Деревянный щит, окованный железом.", "properties": json.dumps({"ac_bonus": 2}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Хельвур Тарнлар": [
        {"name": "Плащ с капюшоном", "category": "одежда", "rarity": "обычный", "price_gold": 2, "weight": 1, "description": "Шерстяной плащ, защищает от ветра и дождя.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Шляпа с широкими полями", "category": "одежда", "rarity": "обычный", "price_gold": 1, "weight": 0.5, "description": "Шляпа из фетра, придаёт солидный вид.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Сапоги на меху", "category": "одежда", "rarity": "обычный", "price_gold": 5, "weight": 2, "description": "Тёплые сапоги для зимних дорог.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Шёлковая рубашка", "category": "одежда", "rarity": "обычный", "price_gold": 10, "weight": 0.5, "description": "Тонкая рубашка, подходит для приёмов.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Мэйгла Тарнлар": [
        {"name": "Женское дорожное платье", "category": "одежда", "rarity": "обычный", "price_gold": 8, "weight": 2, "description": "Прочное платье из плотной ткани, удобное для путешествий.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Шёлковый шарф", "category": "одежда", "rarity": "обычный", "price_gold": 3, "weight": 0.2, "description": "Лёгкий шарф, защищает от пыли и солнца.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Перчатки с вышивкой", "category": "одежда", "rarity": "обычный", "price_gold": 2, "weight": 0.2, "description": "Изящные кожаные перчатки, тёплые и красивые.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Фаендра Чансирл": [
        {"name": "Кожаный доспех", "category": "броня", "subcategory": "лёгкая", "rarity": "обычный", "price_gold": 10, "weight": 10, "description": "Лёгкая кожа, тиснёная узором.", "properties": json.dumps({"ac": 11}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Седло", "category": "снаряжение", "rarity": "обычный", "price_gold": 10, "weight": 20, "description": "Удобное седло для верховой езды.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Сумка через плечо", "category": "снаряжение", "rarity": "обычный", "price_gold": 2, "weight": 1, "description": "Кожаная сумка с ремнём.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Пояс с пряжкой", "category": "одежда", "rarity": "обычный", "price_gold": 1, "weight": 0.5, "description": "Кожаный пояс, прочный.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Улро Лурут": [
        {"name": "Выделанная воловья шкура", "category": "материалы", "rarity": "обычный", "price_gold": 5, "weight": 30, "description": "Цельная шкура, хороша для пошива.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Мех лисы", "category": "материалы", "rarity": "обычный", "price_gold": 3, "weight": 2, "description": "Пушистый рыжий мех.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Кожаный ремень", "category": "снаряжение", "rarity": "обычный", "price_gold": 1, "weight": 0.5, "description": "Ремень для крепления груза.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Кайлесса Иркелл": [
        {"name": "Тарелка жаркого", "category": "еда", "rarity": "обычный", "price_gold": 1, "weight": 1, "description": "Горячее мясо с овощами.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Кружка эля", "category": "напитки", "rarity": "обычный", "price_gold": 0.1, "weight": 1, "description": "Свежее пенное пиво.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Спальное место (на ночь)", "category": "услуга", "rarity": "обычный", "price_gold": 2, "weight": 0, "description": "Койка в общей комнате.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Дорожный паёк (7 дней)", "category": "еда", "rarity": "обычный", "price_gold": 5, "weight": 7, "description": "Вяленое мясо, сухари, сыр.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Гарлен Харлатурл": [
        {"name": "Кружка местного пива", "category": "напитки", "rarity": "обычный", "price_gold": 0.05, "weight": 1, "description": "Тёмное пиво с хмельным ароматом.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Суп с хлебом", "category": "еда", "rarity": "обычный", "price_gold": 0.2, "weight": 1, "description": "Густой похлёбка с овощами.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Медовуха", "category": "напитки", "rarity": "обычный", "price_gold": 0.3, "weight": 1, "description": "Сладкий напиток на мёде.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Мангобарл Лоррен": [
        {"name": "Крошковый пирог", "category": "еда", "rarity": "обычный", "price_gold": 0.3, "weight": 0.5, "description": "Питательный пирог с дичью и овощами, знаменитость Красной Лиственницы.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Свежая буханка", "category": "еда", "rarity": "обычный", "price_gold": 0.05, "weight": 0.5, "description": "Хрустящий хлеб, только из печи.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Сырная булочка", "category": "еда", "rarity": "обычный", "price_gold": 0.1, "weight": 0.2, "description": "Сдобная булка с расплавленным сыром.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Пирог с ягодами", "category": "еда", "rarity": "обычный", "price_gold": 0.2, "weight": 0.3, "description": "Сладкий пирог с лесной черникой.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Нахазлья Дроут": [
        {"name": "Живая курица", "category": "животные", "rarity": "обычный", "price_gold": 0.2, "weight": 3, "description": "Несушка.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Десяток яиц", "category": "еда", "rarity": "обычный", "price_gold": 0.1, "weight": 0.5, "description": "Свежие куриные яйца.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Гусиное перо", "category": "материалы", "rarity": "обычный", "price_gold": 0.01, "weight": 0.01, "description": "Для письма или стрел.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Ялесса Орнра": [
        {"name": "Копчёная свиная нога", "category": "еда", "rarity": "обычный", "price_gold": 1, "weight": 4, "description": "Провиант на несколько дней.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Свежая говядина", "category": "еда", "rarity": "обычный", "price_gold": 0.5, "weight": 1, "description": "Фунт отличного мяса.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Колбаса", "category": "еда", "rarity": "обычный", "price_gold": 0.2, "weight": 0.5, "description": "Домашняя колбаса с чесноком.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Минтра Мандивьер": [
        {"name": "Маринованные яйца", "category": "еда", "rarity": "обычный", "price_gold": 0.2, "weight": 0.5, "description": "Пикантная закуска.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Живой цыплёнок", "category": "животные", "rarity": "обычный", "price_gold": 0.1, "weight": 1, "description": "Пухлый жёлтый птенец.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Солёные потроха", "category": "еда", "rarity": "обычный", "price_gold": 0.05, "weight": 0.2, "description": "Дешёвая закуска к пиву.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Грунд": [
        {"name": "Солёные огурцы", "category": "еда", "rarity": "обычный", "price_gold": 0.05, "weight": 0.5, "description": "Хрустящие бочковые огурцы.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Квашеная капуста", "category": "еда", "rarity": "обычный", "price_gold": 0.05, "weight": 0.5, "description": "Кислая капуста с клюквой.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Маринованная свекла", "category": "еда", "rarity": "обычный", "price_gold": 0.05, "weight": 0.5, "description": "Сладкая свекла в уксусе.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Эндрит Валливой": [
        {"name": "Путевой дневник купца", "category": "книга", "rarity": "обычный", "price_gold": 5, "weight": 1, "description": "Описания дорог и постоялых дворов.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Старая карта долины Дессарин", "category": "карта", "rarity": "обычный", "price_gold": 10, "weight": 0.5, "description": "Пожелтевший пергамент, но тропы указаны верно.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Набор столярных инструментов", "category": "инструменты", "rarity": "обычный", "price_gold": 8, "weight": 8, "description": "Стамески, рубанки, пила — всё для дерева.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Серебряное зеркальце", "category": "сокровище", "rarity": "обычный", "price_gold": 15, "weight": 0.5, "description": "Маленькое зеркало в оправе.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Марландро Газлькур": [
        {"name": "Стрижка и бритьё", "category": "услуга", "rarity": "обычный", "price_gold": 0.2, "weight": 0, "description": "Приведёт внешность в порядок.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Старый кинжал", "category": "оружие", "subcategory": "кинжал", "rarity": "обычный", "price_gold": 2, "weight": 1, "description": "Подержанный, но острый.", "properties": json.dumps({"damage": "1d4", "damage_type": "колющий"}), "requirements": json.dumps({"dexterity": 11}), "is_magical": False, "attunement": False},
        {"name": "Сломанные часы", "category": "безделушка", "rarity": "обычный", "price_gold": 1, "weight": 0.2, "description": "Не работают, но выглядят красиво.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Хазлия Ханадроум": [
        {"name": "Баня", "category": "услуга", "rarity": "обычный", "price_gold": 0.5, "weight": 0, "description": "Горячая вода, веник, отдых.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Льняное платье", "category": "одежда", "rarity": "обычный", "price_gold": 4, "weight": 2, "description": "Лёгкое летнее платье.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Ароматическое масло", "category": "товар", "rarity": "обычный", "price_gold": 1, "weight": 0.2, "description": "Масло с запахом лаванды.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Мамаша Яланта Дрин": [
        {"name": "Ночёвка в пансионе", "category": "услуга", "rarity": "обычный", "price_gold": 0.5, "weight": 0, "description": "Койка в общей комнате.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Горячий ужин", "category": "еда", "rarity": "обычный", "price_gold": 0.3, "weight": 1, "description": "Каша с мясом.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Тёрск Телорн": [
        {"name": "Фургон (обычный)", "category": "транспорт", "rarity": "обычный", "price_gold": 35, "weight": 400, "description": "Деревянный фургон на колёсах.", "properties": json.dumps({"capacity": "1000 lb"}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Запасное колесо", "category": "запчасти", "rarity": "обычный", "price_gold": 5, "weight": 20, "description": "Кованое колесо.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Ось", "category": "запчасти", "rarity": "обычный", "price_gold": 3, "weight": 15, "description": "Дубовая ось.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Асдан Телорн": [
        {"name": "Повозка (лёгкая)", "category": "транспорт", "rarity": "обычный", "price_gold": 25, "weight": 200, "description": "Двухколёсная повозка.", "properties": json.dumps({"capacity": "500 lb"}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Ремонт фургона", "category": "услуга", "rarity": "обычный", "price_gold": 2, "weight": 0, "description": "Быстрая починка.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Ильмет Вэльвур": [
        {"name": "Б/у фургон", "category": "транспорт", "rarity": "обычный", "price_gold": 20, "weight": 400, "description": "Старый, но ещё ездит.", "properties": json.dumps({"capacity": "800 lb"}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Колёса (б/у)", "category": "запчасти", "rarity": "обычный", "price_gold": 2, "weight": 20, "description": "Поношенные, но сгодятся.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Албери Миллико": [
        {"name": "Мраморная плита (2х2)", "category": "материалы", "rarity": "обычный", "price_gold": 10, "weight": 500, "description": "Полированный белый мрамор.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Бутовый камень (корзина)", "category": "материалы", "rarity": "обычный", "price_gold": 1, "weight": 50, "description": "Для фундамента или дорожки.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Эйриго Бетендур": [
        {"name": "Аренда склада (декада)", "category": "услуга", "rarity": "обычный", "price_gold": 10, "weight": 0, "description": "Сухое помещение для товаров.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Пересылка груза", "category": "услуга", "rarity": "обычный", "price_gold": 5, "weight": 0, "description": "Отправит до Глубоководья.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Херивин Дардрагон": [
        {"name": "Кружка эля", "category": "напитки", "rarity": "обычный", "price_gold": 0.1, "weight": 1, "description": "Светлый эль.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Комната с ужином", "category": "услуга", "rarity": "обычный", "price_gold": 2, "weight": 0, "description": "Уютная комната на ночь.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Картина «Пейзаж долины»", "category": "искусство", "rarity": "обычный", "price_gold": 30, "weight": 5, "description": "Масло, изображает холмы Самбер.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Нешор Флёрдин": [
        {"name": "Горячий обед", "category": "еда", "rarity": "обычный", "price_gold": 0.5, "weight": 1, "description": "Сытное жаркое.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Стойло для лошади", "category": "услуга", "rarity": "обычный", "price_gold": 0.5, "weight": 0, "description": "Корм и ночлег для коня.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
    "Шоалар Куандерил": [
        {"name": "Книга на дварфийском «История Безилмера»", "category": "книга", "rarity": "редкий", "price_gold": 50, "weight": 2, "description": "Старинный манускрипт.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Серебряный кубок", "category": "сокровище", "rarity": "обычный", "price_gold": 30, "weight": 1, "description": "С гравировкой.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Зелье лечения", "category": "зелье", "rarity": "обычный", "price_gold": 50, "weight": 0.5, "description": "Восстанавливает 2к4+2 хита.", "properties": json.dumps({"effect": "heal 2d4+2"}), "requirements": json.dumps({}), "is_magical": True, "attunement": False},
    ],
    "Гариена": [
        {"name": "Зелье лечения", "category": "зелье", "rarity": "обычный", "price_gold": 50, "weight": 0.5, "description": "Целебный эликсир.", "properties": json.dumps({"effect": "heal 2d4+2"}), "requirements": json.dumps({}), "is_magical": True, "attunement": False},
        {"name": "Свиток «Небесные письмена»", "category": "свиток", "rarity": "необычный", "price_gold": 100, "weight": 0.1, "description": "Позволяет написать послание в облаках.", "properties": json.dumps({"spell": "skywrite"}), "requirements": json.dumps({"spellcasting": True}), "is_magical": True, "attunement": False},
        {"name": "Яд слабости", "category": "яд", "rarity": "необычный", "price_gold": 75, "weight": 0.1, "description": "Попадание в кровь ослабляет цель.", "properties": json.dumps({"effect": "poison", "dc": 13}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
        {"name": "Сбор трав (10 доз)", "category": "лекарство", "rarity": "обычный", "price_gold": 10, "weight": 0.5, "description": "От лихорадки и ран.", "properties": json.dumps({}), "requirements": json.dumps({}), "is_magical": False, "attunement": False},
    ],
}

# -------------------- 4. ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ enrich_item --------------------
def enrich_item(item_data):
    """
    Добавляет в словарь предмета недостающие поля:
    - price_silver и price_copper из price_gold (1 золотой = 100 серебряных = 10000 медных)
    - stock – количество в наличии (зависит от категории)
    - quality – качество (по умолчанию "стандартное")
    """
    # Конвертируем цену из золотых в три валюты
    if "price_silver" not in item_data:
        price_gold = item_data.get("price_gold", 0)
        item_data["price_silver"] = int(price_gold * 100)
        item_data["price_copper"] = int(price_gold * 10000)

    # Устанавливаем stock по умолчанию, если не указан
    if "stock" not in item_data:
        cat = item_data.get("category", "")
        if cat in ["еда", "напитки", "услуга", "материалы", "лекарство", "животные", "искусство", "товар"]:
            item_data["stock"] = 20
        elif cat in ["оружие", "броня", "инструменты", "снаряжение", "транспорт", "запчасти", "одежда"]:
            item_data["stock"] = 5
        elif cat in ["зелье", "свиток", "яд", "книга", "карта", "сокровище"] or item_data.get("is_magical") or item_data.get("rarity") in ["редкий", "необычный"]:
            item_data["stock"] = 1
        else:
            item_data["stock"] = 3

    # Устанавливаем качество по умолчанию
    if "quality" not in item_data:
        item_data["quality"] = "стандартное"

    return item_data

# -------------------- 5. СОХРАНЕНИЕ ПРЕДМЕТОВ И СВЯЗЕЙ --------------------
traders_dict = {t.name: t for t in db.query(Trader).all()}
existing_items = {}

for trader_name, items_list in items_by_trader.items():
    trader = traders_dict.get(trader_name)
    if not trader:
        print(f"Торговец '{trader_name}' не найден, пропускаем.")
        continue

    for item_data in items_list:
        # Обогащаем предмет дополнительными полями
        item_data = enrich_item(item_data)

        # Ищем предмет по имени (чтобы не дублировать)
        if item_data["name"] in existing_items:
            item = existing_items[item_data["name"]]
        else:
            item = Item(**item_data)
            db.add(item)
            db.flush()
            existing_items[item_data["name"]] = item

        # Добавляем связь торговец ↔ предмет
        if item not in trader.items:
            trader.items.append(item)

    print(f"Торговцу '{trader_name}' добавлено {len(items_list)} предметов.")

db.commit()
print(f"Всего добавлено предметов: {len(existing_items)}")
print("Скрипт завершён.")
db.close()
=======
        "specialization": {
            "primary": "зелья и травы",
            "tags": ["зелья", "травы", "лекарства", "свитки"],
        },
        "gold": 1000,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Чертоги Алой Луны",
        "level_min": 6,
        "level_max": 10,
        "restock_days": 4,
        "currency": "золотые",
        "description": "Эльфийка-друид, торгующая осторожно и предпочитающая клиентов, умеющих слушать.",
        "image_url": "/static/gariena.jpg",
        "personality": "Мудрая, сдержанная, чувствует ложь и фальшь.",
        "possessions": [
            "Серп тонкой ковки",
            "Связки редких трав",
            "Свиток старого ритуала",
        ],
        "rumors": "Ищет сведения о древних природных ритуалах и редко делится своими целями.",
        "race": "эльф",
        "class_name": "друид",
        "trader_level": 7,
        "stats": {
            "str": 9,
            "dex": 14,
            "con": 12,
            "int": 13,
            "wis": 18,
            "cha": 11,
        },
        "abilities": [
            "Травничество (мастер)",
            "Алхимия",
            "Знание природы",
            "Лечение",
            "Друидические ритуалы",
        ],
    },
]
>>>>>>> Stashed changes
