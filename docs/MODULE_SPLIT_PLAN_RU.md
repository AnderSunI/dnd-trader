# План модульного разбиения (backend + frontend)

## Текущий статус
- **Backend:** рабочий, но есть долг по структуре вокруг room/profile/access-control.
- **Frontend:** функционально живой, но `frontend/js/app.js` перегружен и требует разрезания.

---

## На какие модули бьём backend
1. `app/services/auth_profile/`
   - регистрация/логин
   - профиль (steam-like поля)
2. `app/services/trade/`
   - buy/sell
   - trader progression
   - restock
3. `app/services/party_room/`
   - room/party
   - роли GM/Player/Spectator
   - права видимости модулей
4. `app/services/lss/`
   - загрузка/валидация JSON
   - маппинг в персонажа

## На какие модули бьём frontend
1. `frontend/js/modules/trader/`
   - trader actions
   - restock UI
   - trader modal state
2. `frontend/js/modules/inventory/`
   - inventory actions
   - cart/reserved
3. `frontend/js/modules/auth_profile/`
   - auth modal
   - profile modal (steam-like)
4. `frontend/js/modules/room/`
   - master-room state
   - role-based visibility
5. `frontend/js/modules/lss/`
   - lss import/preview
   - character select for room

---

## Что по качеству сейчас
- **Backend:** ~7/10 (база рабочая, нужны room/access и профильные расширения).
- **Frontend:** ~5.5/10 (функции есть, но большой техдолг по структуре и связанности в app.js).

## Оценка объёма работ
1. Довести `app.js` до точки модульного выноса: **2-3 прогона**.
2. Разрезать frontend на первые 2 модуля (`trader`, `inventory`): **4-6 прогонов**.
3. Steam-like профиль + модалка + API поля: **4-5 прогонов**.
4. Стык profile -> room -> role -> visibility: **6-8 прогонов**.
5. LSS-стыковка с room/character selection: **5-7 прогонов**.

**Итого до первого цельного контура profile+room+role:** примерно **21-29 прогонов**
(если идём безопасно, без лома текущего функционала).
