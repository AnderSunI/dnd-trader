import asyncio
from playwright.async_api import async_playwright

async def main():
    url = "https://baldursgate.fandom.com/ru/wiki/Снаряжение"
    async with async_playwright() as p:
        # headless=False, чтобы увидеть, что загружается
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded")

        # Подождём 5 секунд, чтобы страница полностью загрузилась
        await page.wait_for_timeout(5000)

        # Найдём все таблицы
        tables = await page.query_selector_all("table")
        print(f"Найдено таблиц: {len(tables)}")
        for i, table in enumerate(tables):
            class_name = await table.get_attribute("class")
            print(f"  Таблица {i+1}: class='{class_name}'")

        # Сохраним HTML для анализа
        content = await page.content()
        with open("debug_page.html", "w", encoding="utf-8") as f:
            f.write(content)
        print("Сохранён файл debug_page.html для ручного просмотра")

        await browser.close()

asyncio.run(main())
