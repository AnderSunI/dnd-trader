# D&D Trader — структура кода (RU)

## Зачем этот файл
Короткая карта проекта: **что где лежит и зачем**, чтобы можно было быстро ориентироваться без перегруза.

---

## Backend (FastAPI)

### Точка входа
- `app/main.py` — сборка приложения, подключение роутеров, статики и базовых endpoint-ов.

### Роутеры
- `app/routers/auth.py` — регистрация/логин/пользователь.
- `app/routers/inventory.py` — API инвентаря игрока.
- `app/routers/traders.py` — API торговцев (списки, фильтры, карточка торговца).
- `app/routers/admin.py` — админ-операции.

### Сервисы (бизнес-логика)
- `app/services/inventory.py` — покупка/продажа, синхронизация инвентаря.
- `app/services/pricing.py` — экономика и формулы цен.
- `app/services/money.py` — операции с валютой (cp/silver/gold).
- `app/services/profile.py` — дефолтный персонаж, сериализация профиля.
- `app/services/legacy_schema.py` — мягкий patch старой схемы БД.
- `app/services/trader_progression.py` — скилл торговца, скидка, динамика репутации.

### Модели/БД
- `app/models.py` — SQLAlchemy-модели.
- `app/database.py` — engine/session.

---

## Frontend
- `frontend/index.html` — базовая страница.
- `frontend/js/app.js` — основной клиентский поток.
- `frontend/js/cabinet.js` — логика личного кабинета.
- `frontend/js/master-room.js` — каркас master room.
- `frontend/css/styles.css` — стили.

---

## Что уже закрыто в этой итерации
1. Добавлены поля торговца для UI:
   - `skill_label` (ранг торговца)
   - `discount_percent` (текущая скидка)
2. Репутация торговца теперь мягко растёт после buy/sell (без агрессивных скачков).

---

## Что дальше (без ломки)
1. Endpoint "обновить ассортимент торговца" (ручной restock кнопкой).
2. Нормализовать фронтовый блок торговца:
   - репутация отдельно,
   - скилл отдельно,
   - скидка отдельно.
3. После этого — модульный разбор `frontend/js/app.js` на маленькие модули.

