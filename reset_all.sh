#!/bin/bash
echo "Останавливаем и удаляем контейнеры, тома, сеть..."
docker-compose down -v

echo "Сборка и запуск контейнеров..."
docker-compose up --build -d

echo "Ожидание готовности базы данных..."
sleep 5

echo "Выполняем полный сброс через API..."
curl -X POST http://localhost:8000/admin/full-reset

echo "Обновляем качество предметов..."
docker exec -it dnd-trader-db-1 psql -U trader -d dnd_trader -c "
UPDATE items SET quality = 
  CASE 
    WHEN rarity = 'обычный' THEN 
      CASE WHEN random() < 0.7 THEN 'стандартное' ELSE 'хорошее' END
    WHEN rarity = 'необычный' THEN 
      CASE 
        WHEN random() < 0.5 THEN 'стандартное'
        WHEN random() < 0.9 THEN 'хорошее'
        ELSE 'отличное'
      END
    WHEN rarity = 'редкий' THEN 
      CASE 
        WHEN random() < 0.3 THEN 'стандартное'
        WHEN random() < 0.8 THEN 'хорошее'
        ELSE 'отличное'
      END
    WHEN rarity = 'очень редкий' THEN 
      CASE 
        WHEN random() < 0.1 THEN 'стандартное'
        WHEN random() < 0.5 THEN 'хорошее'
        ELSE 'отличное'
      END
    WHEN rarity = 'легендарный' THEN 
      CASE 
        WHEN random() < 0.2 THEN 'хорошее'
        ELSE 'отличное'
      END
    ELSE 'стандартное'
  END;
"

echo "Обновляем ассортимент..."
curl -X POST http://localhost:8000/admin/relink-items

echo "Готово!"
