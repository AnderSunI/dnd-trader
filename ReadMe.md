# D&D Trader — Генератор торговцев

> Помощник ГМа для быстрого создания торговцев с товарами, характеристиками и фильтрацией.

Проект представляет собой веб-приложение, которое генерирует карточки торговцев (кузнецы, алхимики, трактирщики) со списком предметов. У каждого предмета отображаются **характеристики**: урон, класс доспеха, требования по силе/ловкости, магические свойства и т.д.

## 🧰 Технологии

- **Backend**: Python + FastAPI  
- **Database**: PostgreSQL  
- **Frontend**: HTML, CSS, Vanilla JS  
- **Containerization**: Docker, Docker Compose  
- **Tools**: Git, curl, nano, localtunnel (для разработки)

## 📦 Установка и запуск

### 1. Клонировать репозиторий
```bash
git clone https://github.com/AnderSunI/dnd-trader.git
cd dnd-trader
















# Рецепт сборки проекта D&D Trader с нуля

Этот рецепт описывает, как поднять проект «Генератор торговцев для D&D» на чистом Linux-сервере (Ubuntu 22.04). Проект состоит из:
- Backend на FastAPI (Python)
- База данных PostgreSQL
- Frontend на чистом HTML/JS
- Запуск через Docker Compose
- Туннель для доступа из интернета (localtunnel)
- Автообновление страницы при разработке (browser-sync)

---

## 1. Подготовка сервера

Убедись, что у тебя есть свежая Ubuntu (22.04 или новее) с доступом по SSH.

```bash
# Обновляем систему
sudo apt update && sudo apt upgrade -y

# Устанавливаем Docker и Docker Compose
sudo apt install -y docker.io docker-compose

# Добавляем своего пользователя в группу docker (чтобы не использовать sudo)
sudo usermod -aG docker $USER

# Перезагружаем сессию или выходим/заходим, чтобы применить группу
newgrp docker
