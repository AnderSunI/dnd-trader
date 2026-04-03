import requests
from bs4 import BeautifulSoup

url = "https://bg3.wiki/wiki/Weapons"
response = requests.get(url)
soup = BeautifulSoup(response.text, 'html.parser')
tables = soup.find_all("table", class_="wikitable")
print(f"Всего таблиц: {len(tables)}")
for i, table in enumerate(tables):
    print(f"\n--- Таблица {i+1} ---")
    rows = table.find_all("tr")
    print(f"Строк: {len(rows)}")
    if rows:
        # Покажем первую строку (заголовок) и первую строку данных
        header_row = rows[0]
        headers = [th.get_text(strip=True) for th in header_row.find_all(["th", "td"])]
        print("Заголовки:", headers)
        if len(rows) > 1:
            data_row = rows[1]
            data_cells = [cell.get_text(strip=True) for cell in data_row.find_all(["th", "td"])]
            print("Пример данных:", data_cells)
    # Сохраним первую таблицу в файл для ручного анализа
    with open(f"table_{i}.html", "w", encoding="utf-8") as f:
        f.write(str(table))
    print(f"Сохранена table_{i}.html")
