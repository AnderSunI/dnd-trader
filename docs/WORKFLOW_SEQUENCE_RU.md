# Как идём по проекту (последовательность, не рандом)

## Принцип
Работаем **итерациями**, каждая итерация = 1 маленький безопасный шаг.

## Текущий маршрут
1. **Backend-основа**
   - модульность (`main.py` -> services)
   - безопасные изменения без потери старой логики
2. **Trader flow**
   - репутация/скилл/скидка
   - restock endpoint
3. **Frontend интеграция**
   - API метод
   - action в `app.js`
   - отображение в `render.js`
4. **Чистка/комментарии**
   - добавляем комментарии в горячие зоны
   - уменьшаем связанность и дубли

## Почему так
- сначала делаем несущие вещи (данные/контракты API),
- потом UI,
- потом полировка и комментарии.

## Что дальше
- продолжить проход по `frontend/js/app.js` (самый жирный файл):
  1) выделить блоки trader actions,
  2) выделить блоки inventory actions,
  3) вынести в модули без изменения поведения.

## Текущий статус и сколько ещё прогонов
- Сейчас: этап **декомпозиции `frontend/js/app.js`**.
- Уже сделано: restock-flow, cart/reserve/remove, lookup-helpers, checkout-helpers.
- Осталось до перехода к отдельным модулям: **примерно 2-3 прогона**.

### Критерий перехода к модулям
Переходим к выносу в отдельные файлы, когда:
1. В `app.js` убраны дубли основных helper-веток,
2. buy/sell/checkout читаются как короткие сценарии,
3. нет частых правок \"по всему файлу\" ради одной кнопки/флоу.

## Обновление статуса (после последних прогонов)
- Этап helper-декомпозиции **практически закрыт**:
  - вынесены trade/cart/inventory/restock/trader-ui helper-ы,
  - вынесены guest/server restock flow-обработчики,
  - `app.js` стал ближе к роли оркестратора.

### Следующий этап (domain split)
1. `frontend/js/modules/trader/`
   - trader actions (open/modal/update/filter/restock bind),
   - trader state sync.
2. `frontend/js/modules/inventory/`
   - cart/reserved/inventory actions,
   - checkout/buy/sell orchestration.
3. `frontend/js/modules/auth_profile/` (следом)
   - auth modal,
   - profile modal и подготовка стыка с room.

## Антиперебор по модулям
- Чтобы не плодить файлы «на каждый чих», используем отдельные правила:
  `docs/MODULARITY_RULES_RU.md`.

## Быстрый статус по этапу
- Актуальный «что сейчас / что следующим файлом»:
  `docs/NEXT_STEP_STATUS_RU.md`.
