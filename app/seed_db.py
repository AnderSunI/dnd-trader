# ============================================================
# seed_db.py – Полная версия для кампании 5–10 уровня
# Включает:
# - 26 торговцев с балансными уровнями, золотом и расширенными данными (в т.ч. статы для ГМ)
# - Импорт 934 предметов из cleaned_items.json
# - Сохранение базовых предметов из items_by_trader
# ============================================================
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.models import SessionLocal, Trader, Item, Base, engine, trader_items
import json
from sqlalchemy import text

# -------------------- 1. СОЗДАНИЕ ТАБЛИЦ И ДОБАВЛЕНИЕ НОВЫХ КОЛОНОК --------------------
Base.metadata.create_all(bind=engine)

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0"))
    conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS price_silver INTEGER DEFAULT 0"))
    conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS price_copper INTEGER DEFAULT 0"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS personality TEXT"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS possessions JSON"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS rumors TEXT"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS gold INTEGER DEFAULT 0"))
    # Новые поля
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS race TEXT"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS class_name TEXT"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS trader_level INTEGER DEFAULT 0"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS stats JSON"))
    conn.execute(text("ALTER TABLE traders ADD COLUMN IF NOT EXISTS abilities JSON"))
    conn.commit()
    

db = SessionLocal()

# Очистка старых данных
db.query(trader_items).delete()
db.query(Item).delete()
db.query(Trader).delete()
db.commit()
print("Старые данные удалены.")

# -------------------- 2. ТОРГОВЦЫ (26 штук) --------------------
# Все данные переработаны: уровни, золото, статы для ГМ
traders_data = [
    {
        "name": "Элдрас Тантур",
        "type": "кузнец",
        "specialization": json.dumps(["оружие", "доспехи", "инструменты", "цепи"]),
        "gold": 1500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 10,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Суровый, немногословный кузнец. Его семья куёт оружие и доспехи уже три поколения. Работает от зари до зари, ценит надёжность, а не красоту.",
        "image_url": "/static/images/eldras.jpg",
        "personality": "Молчалив и суров. Не терпит брака. Уважает тех, кто умеет работать руками. Может дать скидку, если попросить его о помощи в кузнечном деле.",
        "possessions": json.dumps(["Старый семейный молот", "Амулет с руной Морадина", "Кусок метеоритного железа"]),
        "rumors": "Говорят, у него в подвале хранится незаконченный клинок из звёздного металла. Если помочь ему найти редкий ингредиент, он, возможно, закончит его для героев.",
        "race": "человек",
        "class_name": "воин",
        "trader_level": 8,
        "stats": json.dumps({"str": 18, "dex": 12, "con": 16, "int": 10, "wis": 12, "cha": 10}),
        "abilities": json.dumps(["кузнечное дело", "владение всеми видами оружия и доспехов", "ремонт", "металлургия"])
    },
    {
        "name": "Фенг Железноголовый",
        "type": "оружейник",
        "specialization": json.dumps(["мечи", "луки", "арбалеты", "щиты"]),
        "gold": 1200,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 10,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Полуорк, отставной наёмник. Знает толк в оружии, сам чинит и продаёт. Добродушен, но сразу определит, какой меч прослужит дольше.",
        "image_url": "/static/images/feng.jpg",
        "personality": "Добродушный, но не терпит халтуры. Любит рассказывать байки о своих приключениях. Всегда предложит что-то крепкое выпить.",
        "possessions": json.dumps(["Старый боевой топор", "Пара самодельных наручей", "Фляга с крепким элем"]),
        "rumors": "В молодости служил в наёмниках у одного лорда. Говорят, знает тайный проход в старые рудники.",
        "race": "полуорк",
        "class_name": "воин",
        "trader_level": 7,
        "stats": json.dumps({"str": 17, "dex": 14, "con": 15, "int": 9, "wis": 10, "cha": 12}),
        "abilities": json.dumps(["владение всеми видами оружия", "оценка качества", "тактика", "ночное зрение"])
    },
    {
        "name": "Хельвур Тарнлар",
        "type": "портной",
        "specialization": json.dumps(["мужская одежда", "плащи", "шляпы", "обувь"]),
        "gold": 400,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 4,
        "restock_days": 10,
        "currency": "золотые",
        "description": "Надменный портной, строит из себя знатока высшего света. Продаёт добротные плащи и сапоги, но любит приврать о своих клиентах из Невервинтера.",
        "image_url": "/static/images/helvur.jpg",
        "personality": "Надменный, любит приврать о знатных клиентах. Ценит тонкие ткани и хорошие манеры.",
        "possessions": json.dumps(["Золотая игла", "Ткань из эльфийской паутины", "Список 'важных' клиентов"]),
        "rumors": "Поговаривают, что он шьёт для членов Культа Дракона, но сам он отрицает.",
        "race": "человек",
        "class_name": "ремесленник",
        "trader_level": 3,
        "stats": json.dumps({"str": 8, "dex": 14, "con": 10, "int": 12, "wis": 10, "cha": 15}),
        "abilities": json.dumps(["портняжное дело", "распознавание тканей", "дипломатия", "лёгкая атлетика (?)"])
    },
    {
        "name": "Мэйгла Тарнлар",
        "type": "портниха",
        "specialization": json.dumps(["женская одежда", "платья", "шарфы", "перчатки"]),
        "gold": 400,
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
        "rumors": "Она тайно помогает Арфистам, передавая информацию через одежду.",
        "race": "человек",
        "class_name": "ремесленник",
        "trader_level": 3,
        "stats": json.dumps({"str": 8, "dex": 16, "con": 10, "int": 14, "wis": 12, "cha": 14}),
        "abilities": json.dumps(["портняжное дело", "вышивка", "знание тканей", "легенды и истории"])
    },
    {
        "name": "Фаендра Чансирл",
        "type": "кожевник",
        "specialization": json.dumps(["кожаные доспехи", "сбруя", "сумки", "сапоги"]),
        "gold": 600,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 5,
        "restock_days": 8,
        "currency": "золотые",
        "description": "Молодая женщина, мечтающая о приключениях. Шьёт отличные кожаные доспехи и упряжь. Сама носит кожаный доспех с тиснением.",
        "image_url": "/static/images/phaendra.jpg",
        "personality": "Мечтательная, но ответственная. Любит рассказывать истории о приключениях. Всегда готова помочь советом.",
        "possessions": json.dumps(["Самодельный тиснёный доспех", "Книга о героях", "Письмо от отца"]),
        "rumors": "Говорят, она знает, где находится заброшенный лагерь искателей приключений.",
        "race": "человек",
        "class_name": "следопыт",
        "trader_level": 4,
        "stats": json.dumps({"str": 12, "dex": 16, "con": 12, "int": 10, "wis": 14, "cha": 13}),
        "abilities": json.dumps(["кожевничество", "выживание", "верховая езда", "следопытство"])
    },
    {
        "name": "Улро Лурут",
        "type": "дубильщик",
        "specialization": json.dumps(["кожа", "меха", "шкуры", "ремни"]),
        "gold": 350,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Пропах дубильными растворами, но шкуры выделывает на совесть. Продаёт готовую кожу, меха, ремни. Молчалив, но может рассказать о зверях в округе.",
        "image_url": "/static/images/ulro.jpg",
        "personality": "Молчаливый, угрюмый. Не любит болтовни. Ценит качество и практичность.",
        "possessions": json.dumps(["Старый дубильный нож", "Коллекция редких шкур", "Фляга с настойкой"]),
        "rumors": "Знает места обитания редких зверей в холмах Самбер.",
        "race": "человек",
        "class_name": "ремесленник",
        "trader_level": 2,
        "stats": json.dumps({"str": 14, "dex": 10, "con": 14, "int": 8, "wis": 12, "cha": 8}),
        "abilities": json.dumps(["дубление кожи", "охота", "знание зверей", "трудолюбие"])
    },
    {
        "name": "Кайлесса Иркелл",
        "type": "трактирщица",
        "specialization": json.dumps(["горячие блюда", "эль", "вино", "ночлег"]),
        "gold": 400,
        "reputation": 3,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 3,
        "currency": "золотые",
        "description": "Хозяйка «Раскачивающегося меча». Заботливая, знает все новости. Готовит сытные обеды, наливает отличный эль.",
        "image_url": "/static/images/kaylessa.jpg",
        "personality": "Заботливая, проницательная. Умеет слушать и давать советы. Знает всё о всех.",
        "possessions": json.dumps(["Семейная поваренная книга", "Ключи от всех комнат", "Старый меч мужа"]),
        "rumors": "Слышала разговоры культистов в своей таверне, но боится говорить об этом открыто.",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 2,
        "stats": json.dumps({"str": 10, "dex": 12, "con": 12, "int": 12, "wis": 16, "cha": 14}),
        "abilities": json.dumps(["кулинария", "ведение хозяйства", "дипломатия", "слухи"])
    },
    {
        "name": "Гарлен Харлатурл",
        "type": "тавернщик",
        "specialization": json.dumps(["эль", "пиво", "жаркое", "суп"]),
        "gold": 350,
        "reputation": -1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 3,
        "currency": "золотые",
        "description": "Владелец «Полуденного шлема». Циничный, но внимательный хозяин. У него всегда есть местное пиво и недорогие закуски.",
        "image_url": "/static/images/garlen.jpg",
        "personality": "Циничный, недоверчивый. Умеет считать деньги. Иногда бывает щедрым, если выпьет.",
        "possessions": json.dumps(["Старая бухгалтерская книга", "Нож для разделки мяса", "Тайная полка с дорогим вином"]),
        "rumors": "Имеет долги перед неизвестными лицами.",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 2,
        "stats": json.dumps({"str": 12, "dex": 10, "con": 12, "int": 10, "wis": 12, "cha": 10}),
        "abilities": json.dumps(["торговля", "ведение учёта", "приготовление простой еды"])
    },
    {
        "name": "Мангобарл Лоррен",
        "type": "пекарь",
        "specialization": json.dumps(["хлеб", "пироги", "булочки", "кексы"]),
        "gold": 300,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 1,
        "currency": "золотые",
        "description": "Энергичный пекарь, знает все сплетни. Его «крошковый пирог» знаменит на всю округу. Втайне сотрудничает с Жентаримом.",
        "image_url": "/static/images/mangobarl.jpg",
        "personality": "Энергичный, любопытный. Любит поговорить, но осторожен. Имеет связи с тёмными личностями.",
        "possessions": json.dumps(["Секретный рецепт", "Записная книжка с именами", "Деньги в тайнике"]),
        "rumors": "Передаёт информацию Жентариму за золото.",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 2,
        "stats": json.dumps({"str": 10, "dex": 12, "con": 12, "int": 12, "wis": 10, "cha": 14}),
        "abilities": json.dumps(["выпечка", "сбор слухов", "конспирация"])
    },
    {
        "name": "Нахазлья Дроут",
        "type": "птицевод",
        "specialization": json.dumps(["куры", "гуси", "яйца", "перья"]),
        "gold": 300,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 2,
        "currency": "золотые",
        "description": "Владелица «Домашней птицы Дроут». Продаёт живую птицу, яйца, потроха. Практичная женщина, не любит пустых разговоров.",
        "image_url": "/static/images/nahaeliya.jpg",
        "personality": "Практичная, немногословная. Любит порядок. Не доверяет незнакомцам.",
        "possessions": json.dumps(["Корзина с яйцами", "Нож для ощипывания", "Амулет от болезней птиц"]),
        "rumors": "Знает, где водятся дикие гуси, и может показать дорогу.",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 1,
        "stats": json.dumps({"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 12, "cha": 8}),
        "abilities": json.dumps(["птицеводство", "ведение хозяйства", "знание животных"])
    },
    {
        "name": "Ялесса Орнра",
        "type": "мясник",
        "specialization": json.dumps(["говядина", "свинина", "колбасы", "копчёности"]),
        "gold": 300,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 2,
        "currency": "золотые",
        "description": "Крепкая женщина, забивает скот и продаёт мясо. Живёт вместе с констеблем. Умеет разделать тушу и посоветовать лучший кусок.",
        "image_url": "/static/images/yalesa.jpg",
        "personality": "Суровая, но справедливая. Ценит физическую силу. Защищает слабых.",
        "possessions": json.dumps(["Большой мясницкий нож", "Кольцо констебля", "Копчёности в подарок"]),
        "rumors": "Знает о недавних убийствах в округе, но молчит по просьбе мужа.",
        "race": "человек",
        "class_name": "воин",
        "trader_level": 2,
        "stats": json.dumps({"str": 16, "dex": 10, "con": 14, "int": 8, "wis": 10, "cha": 12}),
        "abilities": json.dumps(["разделка туш", "владение топором", "знание анатомии"])
    },
    {
        "name": "Минтра Мандивьер",
        "type": "птицевод",
        "specialization": json.dumps(["цыплята", "яйца", "маринованные яйца"]),
        "gold": 300,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 2,
        "currency": "золотые",
        "description": "Милая старушка, торгует живностью и соленьями. Знает многие городские тайны, но не болтлива.",
        "image_url": "/static/images/minthra.jpg",
        "personality": "Добрая, мудрая. Любит детей. Ведёт дневник городских событий.",
        "possessions": json.dumps(["Дневник", "Семейный рецепт маринада", "Вязание"]),
        "rumors": "Знает о тайном обществе Верующих, но молчит.",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 2,
        "stats": json.dumps({"str": 6, "dex": 8, "con": 12, "int": 14, "wis": 16, "cha": 12}),
        "abilities": json.dumps(["консервирование", "знание трав", "наблюдательность"])
    },
    {
        "name": "Грунд",
        "type": "торговец",
        "specialization": json.dumps(["соленья", "овощи", "грибы"]),
        "gold": 250,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 3,
        "currency": "золотые",
        "description": "Полуорк, местный дурачок. Торгует соленьями на рынке. Наивный и добрый, часто раздаёт товар даром.",
        "image_url": "/static/images/grund.jpg",
        "personality": "Наивный, добрый, немного глуповат. Всегда рад гостям. Легко обманывается.",
        "possessions": json.dumps(["Большая кадка с огурцами", "Тряпичная кукла", "Грязный фартук"]),
        "rumors": "Не помнит своего прошлого, но иногда говорит о «тёмных людях».",
        "race": "полуорк",
        "class_name": "простолюдин",
        "trader_level": 1,
        "stats": json.dumps({"str": 14, "dex": 8, "con": 12, "int": 6, "wis": 8, "cha": 12}),
        "abilities": json.dumps(["засолка", "доверие", "физическая сила"])
    },
    {
        "name": "Эндрит Валливой",
        "type": "старьёвщик",
        "specialization": json.dumps(["книги", "карты", "инструменты", "раритеты"]),
        "gold": 800,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 9,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Застенчивый коллекционер. В его лавке можно найти всё: от старых книг до загадочных артефактов. Сотрудничает с Арфистами.",
        "image_url": "/static/images/endrith.jpg",
        "personality": "Застенчивый, внимательный к деталям. Обожает книги. Немного параноик.",
        "possessions": json.dumps(["Увеличительное стекло", "Блокнот с заметками", "Амулет Арфистов"]),
        "rumors": "Знает легенду о четырёх камнях стихий.",
        "race": "человек",
        "class_name": "учёный",
        "trader_level": 6,
        "stats": json.dumps({"str": 8, "dex": 10, "con": 10, "int": 18, "wis": 14, "cha": 10}),
        "abilities": json.dumps(["история", "археология", "идентификация магии", "знание древних языков"])
    },
    {
        "name": "Марландро Газлькур",
        "type": "цирюльник / старьёвщик",
        "specialization": json.dumps(["стрижка", "подержанные вещи", "слухи", "фальшивомонетничество"]),
        "gold": 500,
        "reputation": -2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 2,
        "level_max": 5,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Цирюльник и торговец подержанными вещами. Сомнительная личность, но у него можно узнать последние новости и купить недорогой инструмент.",
        "image_url": "/static/images/marlandro.jpg",
        "personality": "Хитрый, скользкий. Всегда ищет выгоду. Умеет делать фальшивые монеты.",
        "possessions": json.dumps(["Набор инструментов фальшивомонетчика", "Колода краплёных карт", "Записная книжка с компроматом"]),
        "rumors": "Знает, как пройти в подземелье под Красной Лиственницей.",
        "race": "человек",
        "class_name": "плут",
        "trader_level": 4,
        "stats": json.dumps({"str": 8, "dex": 16, "con": 10, "int": 14, "wis": 12, "cha": 14}),
        "abilities": json.dumps(["цирюльник", "фальшивомонетничество", "сбор слухов", "ловкость рук"])
    },
    {
        "name": "Хазлия Ханадроум",
        "type": "банщица / портниха",
        "specialization": json.dumps(["баня", "женские платья", "аромамасла"]),
        "gold": 400,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Управляет купальней и шьёт женские платья. Помогает Изумрудному Анклаву. В её заведении приятно отдохнуть после дороги.",
        "image_url": "/static/images/hazlia.jpg",
        "personality": "Дружелюбная, заботливая. Сочувствует природе. Знает много трав.",
        "possessions": json.dumps(["Сборник рецептов бальзамов", "Швейная машинка", "Сухие травы"]),
        "rumors": "Знает, где найти редкие растения для зелий.",
        "race": "человек",
        "class_name": "друид",
        "trader_level": 3,
        "stats": json.dumps({"str": 8, "dex": 12, "con": 12, "int": 12, "wis": 16, "cha": 14}),
        "abilities": json.dumps(["травничество", "банное дело", "шитьё", "знание природы"])
    },
    {
        "name": "Мамаша Яланта Дрин",
        "type": "пансион",
        "specialization": json.dumps(["ночлег", "слухи", "временные работники"]),
        "gold": 300,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 1,
        "currency": "золотые",
        "description": "Сдаёт дешёвые комнаты. Любит послушать и рассказать сплетни. Иногда может найти подёнщика для работы.",
        "image_url": "/static/images/yalanta.jpg",
        "personality": "Болтливая, любопытная. Любит чай и сплетни. Помнит всех постояльцев.",
        "possessions": json.dumps(["Большой чайник", "Связка ключей", "Список должников"]),
        "rumors": "Слышала странные разговоры о «движущихся камнях».",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 1,
        "stats": json.dumps({"str": 8, "dex": 8, "con": 10, "int": 10, "wis": 12, "cha": 14}),
        "abilities": json.dumps(["ведение хозяйства", "сбор слухов", "поиск работников"])
    },
    {
        "name": "Тёрск Телорн",
        "type": "мастер фургонов",
        "specialization": json.dumps(["фургоны", "колёса", "ремонт"]),
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 3,
        "level_max": 7,
        "restock_days": 10,
        "currency": "золотые",
        "description": "Вместе с братом Асданом делает лучшие фургоны на Север. Всегда занят, но найдёт время помочь путнику.",
        "image_url": "/static/images/thorsk.jpg",
        "personality": "Ответственный, трудолюбивый. Не терпит лени. Ценит качество.",
        "possessions": json.dumps(["Набор плотницких инструментов", "Чертёж нового фургона", "Медальон клана"]),
        "rumors": "Знает, где найти редкие породы дерева.",
        "race": "человек",
        "class_name": "ремесленник",
        "trader_level": 4,
        "stats": json.dumps({"str": 14, "dex": 12, "con": 14, "int": 12, "wis": 10, "cha": 10}),
        "abilities": json.dumps(["столярное дело", "кузнечное дело (частично)", "черчение", "ремонт"])
    },
    {
        "name": "Асдан Телорн",
        "type": "мастер фургонов",
        "specialization": json.dumps(["фургоны", "колёса", "ремонт"]),
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 3,
        "level_max": 7,
        "restock_days": 10,
        "currency": "золотые",
        "description": "Младший брат Тёрска, такой же умелец. С ним можно договориться о срочном ремонте.",
        "image_url": "/static/images/asdan.jpg",
        "personality": "Более общительный, чем брат. Любит торговаться. Всегда готов помочь.",
        "possessions": json.dumps(["Складной метр", "Сумка с инструментами", "Записная книжка заказов"]),
        "rumors": "Видел странные фигуры в лесу, но думает, что это показалось.",
        "race": "человек",
        "class_name": "ремесленник",
        "trader_level": 4,
        "stats": json.dumps({"str": 14, "dex": 12, "con": 14, "int": 10, "wis": 10, "cha": 12}),
        "abilities": json.dumps(["столярное дело", "торговля", "быстрый ремонт"])
    },
    {
        "name": "Ильмет Вэльвур",
        "type": "мастер фургонов",
        "specialization": json.dumps(["дешёвые фургоны", "запчасти", "б/у"]),
        "gold": 450,
        "reputation": -1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 5,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Конкурент Телорнов, делает более дешёвые фургоны. Пьющий, но с ним можно поторговаться.",
        "image_url": "/static/images/ilmet.jpg",
        "personality": "Ненадёжный, но дешёвый. Пьёт, но в работе точен. Недолюбливает Телорнов.",
        "possessions": json.dumps(["Фляга с дешёвым элем", "Запчасти сомнительного качества", "Долговая расписка"]),
        "rumors": "Связан с Верующими, но отрицает.",
        "race": "человек",
        "class_name": "ремесленник",
        "trader_level": 3,
        "stats": json.dumps({"str": 14, "dex": 10, "con": 12, "int": 10, "wis": 8, "cha": 12}),
        "abilities": json.dumps(["столярное дело", "торговля", "алкогольная стойкость"])
    },
    {
        "name": "Албери Миллико",
        "type": "каменотёс",
        "specialization": json.dumps(["каменные блоки", "мрамор", "строительный камень"]),
        "gold": 600,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 5,
        "level_max": 8,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Владелица каменоломни. Поставщик камня для Глубоководья. Весёлая женщина, но скрывает тайну подземного хода.",
        "image_url": "/static/images/albaeri.jpg",
        "personality": "Весёлая, энергичная. Любит выпить и поговорить. Скрытна в вопросах бизнеса.",
        "possessions": json.dumps(["Коллекция минералов", "Ключ от подземного хода", "Письма от клиентов"]),
        "rumors": "Знает о Гробнице Движущихся Камней, но никому не говорит.",
        "race": "дварф",
        "class_name": "ремесленник",
        "trader_level": 5,
        "stats": json.dumps({"str": 16, "dex": 8, "con": 16, "int": 12, "wis": 10, "cha": 14}),
        "abilities": json.dumps(["камнерезное дело", "ведение бизнеса", "знание геологии", "дварфийская стойкость"])
    },
    {
        "name": "Эйриго Бетендур",
        "type": "складской владелец",
        "specialization": json.dumps(["хранение", "аренда", "пересылка"]),
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 3,
        "level_max": 7,
        "restock_days": 30,
        "currency": "золотые",
        "description": "Сдаёт складские помещения. Не задаёт лишних вопросов. Может помочь с перевозкой грузов.",
        "image_url": "/static/images/aerego.jpg",
        "personality": "Спокойный, надёжный. Не лезет в чужие дела. Хороший организатор.",
        "possessions": json.dumps(["Амбарная книга", "Набор весов", "Связка ключей"]),
        "rumors": "Видел, как культисты перевозили странные ящики.",
        "race": "человек",
        "class_name": "торговец",
        "trader_level": 4,
        "stats": json.dumps({"str": 10, "dex": 10, "con": 12, "int": 14, "wis": 12, "cha": 12}),
        "abilities": json.dumps(["логистика", "учёт", "безопасность"])
    },
    {
        "name": "Херивин Дардрагон",
        "type": "трактирщик",
        "specialization": json.dumps(["эль", "комнаты", "картины", "безделушки"]),
        "gold": 400,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Вестбридж",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 5,
        "currency": "золотые",
        "description": "Полурослик, владелец «Урожая». Коллекционирует картины. Радушный хозяин, знает всё о дорогах.",
        "image_url": "/static/images/herivin.jpg",
        "personality": "Радушный, любознательный. Любит искусство. Знает много историй о регионе.",
        "possessions": json.dumps(["Коллекция миниатюрных картин", "Путевой дневник", "Бочонок эля"]),
        "rumors": "У него есть карта старых дварфийских троп.",
        "race": "полурослик",
        "class_name": "простолюдин",
        "trader_level": 2,
        "stats": json.dumps({"str": 8, "dex": 12, "con": 10, "int": 12, "wis": 12, "cha": 16}),
        "abilities": json.dumps(["гостеприимство", "коллекционирование", "знание дорог"])
    },
    {
        "name": "Нешор Флёрдин",
        "type": "трактирщик",
        "specialization": json.dumps(["эль", "горячее", "ночлег"]),
        "gold": 400,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Белиард",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 5,
        "currency": "золотые",
        "description": "Владелец «Бдительного рыцаря». Гостеприимный, любит поговорить о делегации из Мирабара.",
        "image_url": "/static/images/neshor.jpg",
        "personality": "Гостеприимный, болтливый. Помнит всех постояльцев. Любит рассказывать новости.",
        "possessions": json.dumps(["Книга учёта постояльцев", "Медальон «Бдительный рыцарь»", "Старый меч"]),
        "rumors": "Видел, как делегация из Мирабара уходила в холмы.",
        "race": "человек",
        "class_name": "простолюдин",
        "trader_level": 2,
        "stats": json.dumps({"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 12, "cha": 14}),
        "abilities": json.dumps(["ведение хозяйства", "сбор слухов", "знание местности"])
    },
    {
        "name": "Шоалар Куандерил",
        "type": "контрабандист",
        "specialization": json.dumps(["книги", "редкие товары", "информация"]),
        "gold": 2000,
        "reputation": -2,
        "region": "Долина Дессарин",
        "settlement": "Вомфорд",
        "level_min": 5,
        "level_max": 9,
        "restock_days": 20,
        "currency": "золотые",
        "description": "Дженази воды, капитан лодки. Торгует крадеными товарами и редкими книгами. Опасный тип.",
        "image_url": "/static/images/shoalar.jpg",
        "personality": "Хитрый, опасный. Ценит золото и информацию. Не терпит предательства.",
        "possessions": json.dumps(["Карта речных путей", "Список клиентов", "Кинжал с водяной магией"]),
        "rumors": "Имеет связи с культом Сокрушительной Волны.",
        "race": "дженази (вода)",
        "class_name": "плут",
        "trader_level": 7,
        "stats": json.dumps({"str": 12, "dex": 18, "con": 14, "int": 14, "wis": 10, "cha": 16}),
        "abilities": json.dumps(["контрабанда", "водная магия", "навигация", "скрытность"])
    },
    {
        "name": "Гариена",
        "type": "друид-травница",
        "specialization": json.dumps(["зелья", "яды", "лекарства", "свитки"]),
        "gold": 1000,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Чертоги Алой Луны",
        "level_min": 6,
        "level_max": 10,
        "restock_days": 14,
        "currency": "золотые",
        "description": "Эльфийка-друид, ищущая ритуал Плетёного Гиганта. Продаёт целебные травы и зелья. Добра, но осторожна.",
        "image_url": "/static/images/gariena.jpg",
        "personality": "Мудрая, осторожная. Помогает тем, кто борется с культистами. Недоверчива к незнакомцам.",
        "possessions": json.dumps(["Сумка с редкими травами", "Дневник друида", "Амулет из корня"]),
        "rumors": "Знает, где находится тайная роща для ритуала.",
        "race": "эльф",
        "class_name": "друид",
        "trader_level": 8,
        "stats": json.dumps({"str": 8, "dex": 14, "con": 12, "int": 12, "wis": 18, "cha": 14}),
        "abilities": json.dumps(["травничество", "алхимия", "магия природы", "следопытство"])
    }
]

# Сохраняем торговцев в БД
for data in traders_data:
    trader = Trader(**data)
    db.add(trader)
db.commit()
print(f"Добавлено {len(traders_data)} торговцев.")

# -------------------- 3. ИМПОРТ ПРЕДМЕТОВ ИЗ cleaned_items.json (934 штуки) --------------------
json_path = os.path.join(os.path.dirname(__file__), "..", "cleaned_items.json")
if not os.path.exists(json_path):
    print(f"Файл {json_path} не найден, пропускаю импорт предметов.")
else:
    with open(json_path, "r", encoding="utf-8") as f:
        items_data = json.load(f)

    # Маппинг редкости в tier
    rarity_tier_map = {
        "обычный": 0,
        "необычный": 1,
        "редкий": 2,
        "очень редкий": 3,
        "легендарный": 4,
    }

    added = 0
    skipped = 0
    for data in items_data:
        name = data.get("name")
        if not name:
            skipped += 1
            continue

        # Проверяем, есть ли уже такой предмет
        existing = db.query(Item).filter(Item.name == name).first()
        if existing:
            skipped += 1
            continue

        # Парсим цену
        price_str = data.get("price", "")
        price_gold_float = 0.0
        if price_str:
            price_str = price_str.replace(' ', '').replace('зм', '').strip()
            if '-' in price_str:
                parts = price_str.split('-')
                try:
                    low = float(parts[0])
                    high = float(parts[1])
                    price_gold_float = (low + high) / 2
                except:
                    price_gold_float = 0.0
            else:
                try:
                    price_gold_float = float(price_str)
                except:
                    price_gold_float = 0.0

        price_gold = int(price_gold_float)
        price_silver = int((price_gold_float - price_gold) * 100)

        category = data.get("category_clean", "adventuring_gear")
        rarity = data.get("rarity", "обычный")
        description = data.get("description", "")

        rarity_tier = rarity_tier_map.get(rarity, 0)

        new_item = Item(
            name=name,
            category=category,
            rarity=rarity,
            rarity_tier=rarity_tier,
            price_gold=price_gold,
            price_silver=price_silver,
            price_copper=0,
            weight=0.0,
            description=description,
            properties="{}",
            requirements="{}",
            is_magical=False,
            attunement=False,
            stock=5
        )
        db.add(new_item)
        added += 1
        if added % 100 == 0:
            db.flush()

    db.commit()
    print(f"Импортировано предметов: {added}, пропущено: {skipped}")

# -------------------- 4. ПРЕДМЕТЫ ИЗ СТАРОЙ СВЯЗКИ (80 штук) --------------------
# Сохраняем только те, которых ещё нет (чтобы не дублировать)
# Функция enrich_item для дополнения полей
def enrich_item(item_data):
    if "price_silver" not in item_data:
        price_gold = item_data.get("price_gold", 0)
        item_data["price_silver"] = int(price_gold * 100)
        item_data["price_copper"] = int(price_gold * 10000)
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
    if "quality" not in item_data:
        item_data["quality"] = "стандартное"
    return item_data

# Словарь старых предметов (здесь я сократил до минимального примера, но в твоём оригинале их много)
# Поскольку они уже есть в импортированных (большинство), то пропустятся.
# Если нужно добавить уникальные, они добавятся.
items_by_trader = {
    # Здесь оставляем как есть, но для краткости я не копирую весь огромный список.
    # В твоём оригинальном seed_db.py этот блок остаётся без изменений.
    "Элдрас Тантур": [],  # я не копирую, но ты оставь свой
    # ... все остальные
}
# ВНИМАНИЕ: выше я не вставил твой items_by_trader из-за длины. Ты должен вставить свой существующий блок items_by_trader (от "Элдрас Тантур": [...] и до конца) сюда.

traders_dict = {t.name: t for t in db.query(Trader).all()}
existing_items = set(item.name for item in db.query(Item).all())

for trader_name, items_list in items_by_trader.items():
    trader = traders_dict.get(trader_name)
    if not trader:
        continue
    for item_data in items_list:
        if item_data["name"] in existing_items:
            continue
        item_data = enrich_item(item_data)
        item_data["rarity_tier"] = rarity_tier_map.get(item_data.get("rarity", "обычный"), 0)
        item = Item(**item_data)
        db.add(item)
        db.flush()
        existing_items.add(item.name)
        trader.items.append(item)
    print(f"Торговцу '{trader_name}' добавлено {len(items_list)} предметов.")

db.commit()
print("Скрипт завершён.")
db.close()