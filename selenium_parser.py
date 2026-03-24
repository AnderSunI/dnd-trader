#!/usr/bin/env python3
import time
import json
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

BASE_URL = "https://dnd.su"
ITEMS_URL = BASE_URL + "/items/"

def setup_driver():
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')  # без GUI, чтобы не мелькало окно
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    return driver

def get_item_links(driver, url):
    """Загружает страницу списка, ждёт появления карточек, собирает ссылки."""
    driver.get(url)
    # Ждём, пока появятся хотя бы элементы с классом item-card
    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "a.item-card, div.item-card a"))
        )
    except:
        print("Не дождались загрузки карточек. Возможно, структура изменилась.")
        return []

    # Находим все ссылки на предметы
    links = []
    for a in driver.find_elements(By.CSS_SELECTOR, "a[href*='/items/']"):
        href = a.get_attribute('href')
        if href and href.startswith(BASE_URL) and 'items' in href and href != ITEMS_URL:
            if href not in links:
                links.append(href)
    return links

def parse_item_page(driver, url):
    """Открывает страницу предмета, собирает данные."""
    driver.get(url)
    time.sleep(1)  # небольшая пауза
    try:
        # Название
        name_elem = driver.find_element(By.TAG_NAME, "h1")
        name = name_elem.text.strip()
    except:
        name = ""

    # Тип
    try:
        type_elem = driver.find_element(By.CSS_SELECTOR, ".item-type, .type")
        item_type = type_elem.text.strip()
    except:
        item_type = ""

    # Редкость
    try:
        rarity_elem = driver.find_element(By.CSS_SELECTOR, ".item-rarity, .rarity")
        rarity = rarity_elem.text.strip()
    except:
        rarity = ""

    # Источник
    try:
        source_elem = driver.find_element(By.CSS_SELECTOR, ".item-source, .source")
        source = source_elem.text.strip()
    except:
        source = ""

    return {
        "name": name,
        "type": item_type,
        "rarity": rarity,
        "source": source,
        "url": url
    }

def main():
    driver = setup_driver()
    try:
        print("Загружаем страницу списка...")
        links = get_item_links(driver, ITEMS_URL)
        print(f"Найдено ссылок: {len(links)}")

        # Ограничим для теста (например, 10)
        test_links = links[:10]

        items = []
        for i, link in enumerate(test_links, 1):
            print(f"Обработка {i}/{len(test_links)}: {link}")
            item = parse_item_page(driver, link)
            if item and item['name']:
                items.append(item)
            time.sleep(2)  # пауза, чтобы не банили
    finally:
        driver.quit()

    with open("items.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"Готово. Сохранено {len(items)} предметов в items.json")

if __name__ == "__main__":
    main()
