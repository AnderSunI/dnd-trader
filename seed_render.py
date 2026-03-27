#!/usr/bin/env python3
"""
Скрипт для наполнения базы на Render:
- Добавляет недостающие колонки (если их нет)
- Добавляет торговцев (26 штук) из списка, если их ещё нет
- Привязывает к каждому торговцу 5–10 случайных предметов из таблицы items
"""

import os
import random
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

sys.path.append(os.path.dirname(__file__))
from app.models import Trader, Item

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Ошибка: переменная DATABASE_URL не задана.")
    sys.exit(1)

# Для отладки можно распечатать URL, но без пароля
print(f"Подключение к БД: {DATABASE_URL[:30]}...")  # временно, чтобы видеть начало URL

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

# -------------------- ДОБАВЛЕНИЕ НЕДОСТАЮЩИХ КОЛОНОК --------------------
with engine.connect() as conn:
    # Колонки для таблицы traders (добавляем, если их ещё нет)
    for col in ("personality", "possessions", "rumors"):
        conn.execute(text(f"ALTER TABLE traders ADD COLUMN IF NOT EXISTS {col} JSON"))
    conn.commit()
    print("Проверка/добавление колонок выполнена.")

# -------------------- ДАННЫЕ ТОРГОВЦЕВ (26 штук) --------------------
traders_data = [
    {
        "name": "Элдрас Тантур",
        "type": "кузнец",
        "specialization": ["оружие", "доспехи", "инструменты", "цепи"],
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
        "possessions": ["Старый семейный молот", "Амулет с руной Морадина", "Кусок метеоритного железа"],
        "rumors": "Говорят, у него в подвале хранится незаконченный клинок из звёздного металла. Если помочь ему найти редкий ингредиент, он, возможно, закончит его для героев."
    },
    {
        "name": "Фенг Железноголовый",
        "type": "оружейник",
        "specialization": ["мечи", "луки", "арбалеты", "щиты"],
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
        "possessions": ["Старый боевой топор", "Пара самодельных наручей", "Фляга с крепким элем"],
        "rumors": "В молодости служил в наёмниках у одного лорда. Говорят, знает тайный проход в старые рудники."
    },
    {
        "name": "Хельвур Тарнлар",
        "type": "портной",
        "specialization": ["мужская одежда", "плащи", "шляпы", "обувь"],
        "gold": 500,
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
        "possessions": ["Золотая игла", "Ткань из эльфийской паутины", "Список 'важных' клиентов"],
        "rumors": "Поговаривают, что он шьёт для членов Культа Дракона, но сам он отрицает."
    },
    {
        "name": "Мэйгла Тарнлар",
        "type": "портниха",
        "specialization": ["женская одежда", "платья", "шарфы", "перчатки"],
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
        "possessions": ["Семейный напёрсток", "Коллекция образцов тканей", "Портрет мужа"],
        "rumors": "Она тайно помогает Арфистам, передавая информацию через одежду."
    },
    {
        "name": "Фаендра Чансирл",
        "type": "кожевник",
        "specialization": ["кожаные доспехи", "сбруя", "сумки", "сапоги"],
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
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
        "specialization": ["кожа", "меха", "шкуры", "ремни"],
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
        "specialization": ["горячие блюда", "эль", "вино", "ночлег"],
        "gold": 500,
        "reputation": 3,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 3,
        "currency": "золотые",
        "description": "Хозяйка «Раскачивающегося меча». Заботливая, знает все новости. Готовит сытные обеды, наливает отличный эль.",
        "image_url": "/static/images/kaylessa.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Гарлен Харлатурл",
        "type": "тавернщик",
        "specialization": ["эль", "пиво", "жаркое", "суп"],
        "gold": 500,
        "reputation": -1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 3,
        "currency": "золотые",
        "description": "Владелец «Полуденного шлема». Циничный, но внимательный хозяин. У него всегда есть местное пиво и недорогие закуски.",
        "image_url": "/static/images/garlen.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Мангобарл Лоррен",
        "type": "пекарь",
        "specialization": ["хлеб", "пироги", "булочки", "кексы"],
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 1,
        "currency": "золотые",
        "description": "Энергичный пекарь, знает все сплетни. Его «крошковый пирог» знаменит на всю округу. Втайне сотрудничает с Жентаримом.",
        "image_url": "/static/images/mangobarl.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Нахазлья Дроут",
        "type": "птицевод",
        "specialization": ["куры", "гуси", "яйца", "перья"],
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
    },
    {
        "name": "Ялесса Орнра",
        "type": "мясник",
        "specialization": ["говядина", "свинина", "колбасы", "копчёности"],
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 2,
        "currency": "золотые",
        "description": "Крепкая женщина, забивает скот и продаёт мясо. Живёт вместе с констеблем. Умеет разделать тушу и посоветовать лучший кусок.",
        "image_url": "/static/images/yalesa.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Минтра Мандивьер",
        "type": "птицевод",
        "specialization": ["цыплята", "яйца", "маринованные яйца"],
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
    },
    {
        "name": "Грунд",
        "type": "торговец",
        "specialization": ["соленья", "овощи", "грибы"],
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 3,
        "currency": "золотые",
        "description": "Полуорк, местный дурачок. Торгует соленьями на рынке. Наивный и добрый, часто раздаёт товар даром.",
        "image_url": "/static/images/grund.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Эндрит Валливой",
        "type": "старьёвщик",
        "specialization": ["книги", "карты", "инструменты", "раритеты"],
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
        "specialization": ["стрижка", "подержанные вещи", "слухи", "фальшивомонетничество"],
        "gold": 500,
        "reputation": -2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
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
        "specialization": ["баня", "женские платья", "аромамасла"],
        "gold": 500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 7,
        "currency": "золотые",
        "description": "Управляет купальней и шьёт женские платья. Помогает Изумрудному Анклаву. В её заведении приятно отдохнуть после дороги.",
        "image_url": "/static/images/hazlia.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Мамаша Яланта Дрин",
        "type": "пансион",
        "specialization": ["ночлег", "слухи", "временные работники"],
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
        "settlement": "Красная Лиственница",
        "level_min": 1,
        "level_max": 2,
        "restock_days": 1,
        "currency": "золотые",
        "description": "Сдаёт дешёвые комнаты. Любит послушать и рассказать сплетни. Иногда может найти подёнщика для работы.",
        "image_url": "/static/images/yalanta.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Тёрск Телорн",
        "type": "мастер фургонов",
        "specialization": ["фургоны", "колёса", "ремонт"],
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
        "specialization": ["фургоны", "колёса", "ремонт"],
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
        "specialization": ["дешёвые фургоны", "запчасти", "б/у"],
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
        "specialization": ["каменные блоки", "мрамор", "строительный камень"],
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
    },
    {
        "name": "Эйриго Бетендур",
        "type": "складской владелец",
        "specialization": ["хранение", "аренда", "пересылка"],
        "gold": 500,
        "reputation": 0,
        "region": "Долина Дессарин",
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
    },
    {
        "name": "Херивин Дардрагон",
        "type": "трактирщик",
        "specialization": ["эль", "комнаты", "картины", "безделушки"],
        "gold": 500,
        "reputation": 2,
        "region": "Долина Дессарин",
        "settlement": "Вестбридж",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 5,
        "currency": "золотые",
        "description": "Полурослик, владелец «Урожая». Коллекционирует картины. Радушный хозяин, знает всё о дорогах.",
        "image_url": "/static/images/herivin.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Нешор Флёрдин",
        "type": "трактирщик",
        "specialization": ["эль", "горячее", "ночлег"],
        "gold": 500,
        "reputation": 1,
        "region": "Долина Дессарин",
        "settlement": "Белиард",
        "level_min": 1,
        "level_max": 3,
        "restock_days": 5,
        "currency": "золотые",
        "description": "Владелец «Бдительного рыцаря». Гостеприимный, любит поговорить о делегации из Мирабара.",
        "image_url": "/static/images/neshor.jpg",
        "personality": None,
        "possessions": None,
        "rumors": None
    },
    {
        "name": "Шоалар Куандерил",
        "type": "контрабандист",
        "specialization": ["книги", "редкие товары", "информация"],
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
    },
    {
        "name": "Гариена",
        "type": "друид-травница",
        "specialization": ["зелья", "яды", "лекарства", "свитки"],
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

def main():
    session = Session()
    try:
        # 1. Добавляем торговцев, если их ещё нет
        print("Добавление торговцев...")
        added_count = 0
        for data in traders_data:
            existing = session.query(Trader).filter_by(name=data["name"]).first()
            if existing:
                print(f"  {data['name']} уже существует, пропускаем")
                continue
            trader = Trader(**data)
            session.add(trader)
            added_count += 1
        session.flush()
        print(f"Добавлено {added_count} новых торговцев.")

        # 2. Получаем все ID предметов из таблицы items
        item_ids = [row[0] for row in session.query(Item.id).all()]
        if not item_ids:
            print("Ошибка: в таблице items нет предметов. Сначала импортируйте dnd.su.")
            return

        # 3. Привязываем случайные предметы к каждому торговцу
        print("Привязка предметов к торговцам...")
        for trader in session.query(Trader).all():
            existing_item_ids = {item.id for item in trader.items}
            available_ids = [iid for iid in item_ids if iid not in existing_item_ids]
            if not available_ids:
                print(f"  {trader.name}: уже есть все возможные предметы, пропускаем")
                continue

            num_items = random.randint(5, 10)
            chosen_ids = random.sample(available_ids, min(num_items, len(available_ids)))
            added = 0
            for item_id in chosen_ids:
                item = session.get(Item, item_id)
                if item and item not in trader.items:
                    trader.items.append(item)
                    added += 1
            print(f"  {trader.name}: добавлено {added} новых предметов")

        session.commit()
        print("Готово! База наполнена.")

    except Exception as e:
        session.rollback()
        print(f"Ошибка: {e}")
        raise
    finally:
        session.close()

if __name__ == "__main__":
    main()
