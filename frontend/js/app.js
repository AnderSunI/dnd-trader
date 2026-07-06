// ============================================================
// frontend/js/app.js
// Центральный файл фронта.
// Совместим с:
// - index.html (текущий)
// - render.js
// - cabinet.js
// - api.js
// ============================================================

import {
  loginUser,
  registerUser,
  fetchMe,
  fetchTraders,
  fetchTraderById,
  restockTrader as apiRestockTrader,
  fetchPlayerInventory,
  buyItem as apiBuyItem,
  sellItem as apiSellItem,
  updatePlayerMoney as apiUpdatePlayerMoney,
  logoutUser,
} from "./api.js";

import {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal as renderOpenTraderModal,
} from "./render.js";

import {
  initCabinet,
  openCabinet,
} from "./cabinet.js";

import * as questsModule from "./quests.js";
import * as playerNotesModule from "./playerNotes.js";
import {
  createInventoryActions,
  consumeCollectionEntry,
  findCartItemByTraderAndItemId,
  findCollectionItemIndex,
  findInventoryIndexByItemId,
  findInventoryItemById,
  findItemInCollectionById,
  getAvailableStock,
  getCartExistingQuantity,
  removeCollectionItem,
} from "./modules/inventoryActions.js";
import { createTradeActions } from "./modules/tradeActions.js";
import {
  bindAuthButtons,
  bindModalButtons,
  bindMoneyControls,
  bindToolbarButtons,
} from "./modules/uiBindings.js";
import {
  handleGuestRestockFlow,
  handleServerRestockFlow,
} from "./modules/traderRestockFlow.js";
import {
  collectFilters,
  populateFilterOptions,
  sortTraders,
  traderMatchesFilters,
} from "./modules/traderFilters.js";
import {
  bindFilterEvents,
  bindTraderDelegation,
  createOpenTraderModalAction,
  createRestockTraderAction,
} from "./modules/traderActions.js";

// ------------------------------------------------------------
// 💰 MONEY SCALE
// 1 золото = 100 серебра
// 1 серебро = 100 меди
// ------------------------------------------------------------
const COPPER_IN_SILVER = 100;
const SILVER_IN_GOLD = 100;
const COPPER_IN_GOLD = COPPER_IN_SILVER * SILVER_IN_GOLD;

const GUEST_START_GOLD = 1000;
const GUEST_START_GOLD_CP = GUEST_START_GOLD * COPPER_IN_GOLD;

const GUEST_MONEY_STORAGE_KEY = "guestMoneyCp";
const GUEST_MONEY_STORAGE_VERSION_KEY = "guestMoneyCpVersion";
const GUEST_MONEY_STORAGE_VERSION = "2";
const GUEST_ROLE_STORAGE_KEY = "guestRoleMode";
const TRADER_MODAL_UI_PREFS_KEY = "traderModalUiPrefsV1";

// ------------------------------------------------------------
// 🌐 LOCAL APP STATE
// ------------------------------------------------------------
const STATE = {
  token: localStorage.getItem("token") || "",
  user: null,
  traders: [],
  cart: [],
  reserved: [],
  inventory: [],
  activeTraderId: null,
  isBusy: false,
  guestMoneyCp: initGuestMoneyCp(),
  guestRole: initGuestRole(),
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEl(id) {
  return document.getElementById(id);
}

function normalizeApiList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload?.[key],
    payload?.items,
    payload?.results,
    payload?.data,
    payload?.data?.[key],
    payload?.data?.items,
    payload?.data?.results,
    key === "traders" ? payload?.trader_list : null,
    key === "traders" ? payload?.data?.trader_list : null,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function showToast(message) {
  const toast = getEl("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.opacity = "1";
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.opacity = "0";
  }, 2400);

  setTimeout(() => {
    toast.classList.add("hidden");
    toast.style.display = "none";
  }, 2800);
}

window.showToast = showToast;


// ------------------------------------------------------------
// 🗣️ TRADER DIALOGUE / STAGE LINE
// ------------------------------------------------------------
// Лёгкий клиентский слой реплик торговцев.
// Сейчас работает без миграций и без новых полей БД:
// - берёт trader.name / trader.type / активное событие;
// - показывает короткую фразу в центре экрана с эффектом печати;
// - не ломает старые toast-уведомления и торговую логику.
// Позже этот словарь можно перенести в seed/API как trader.dialogue.
const TRADER_DIALOGUE_TYPEWRITER_SPEED_MS = 28;
const TRADER_DIALOGUE_HOLD_MS = 2600;
const TRADER_DIALOGUE_BIG_QUANTITY = 5;
const TRADER_DIALOGUE_BIG_TRADE_CP = 5 * COPPER_IN_GOLD;

let traderDialogueTypeTimer = null;
let traderDialogueHideTimer = null;
let lastTraderDialogueKey = "";
let lastTraderDialogueAt = 0;
let traderDialogueCloseWatcherBound = false;
let traderDialogueActionWrappersBound = false;

const TRADER_DIALOGUE_GENERIC = {
  open: [
    "Смотри спокойно. Хороший товар сам себя не нахвалит.",
    "Заходи. Дорога редко прощает пустые руки.",
  ],
  close: [
    "Будет нужда — найдёшь меня здесь.",
    "Береги кошель и спину. Обычно пропадает что-то одно.",
  ],
  buy_success: [
    "Хороший выбор. Эта вещь ещё сослужит службу.",
    "Договорились. Пусть послужит тебе лучше, чем прошлому хозяину.",
  ],
  sell_success: [
    "Заберу. Найдётся тот, кому это нужнее.",
    "Хм. Не лучший вид, но цену оно ещё держит.",
  ],
  reserve_success: [
    "Отложу. Но не заставляй меня ждать слишком долго.",
    "Ладно, придержу за тобой.",
  ],
  cart_add: [
    "Сложу к остальному. Только не передумай у самой стойки.",
    "В корзину так в корзину. Вес уже чувствуешь?",
  ],
  no_money: [
    "Монет не хватает. Уговоры я в оплату не принимаю.",
    "Красивый взгляд, но касса считает металл.",
  ],
  big_purchase: [
    "Вот это уже не покупка, а подготовка к войне.",
    "Такой заказ люди делают либо перед дорогой, либо перед бедой.",
  ],
  big_sale: [
    "Неплохая добыча. Даже спрашивать не стану, где взял.",
    "Много несёшь. Значит, где-то стало сильно пустее.",
  ],
};

const TRADER_DIALOGUE_BY_TYPE = {
  "Оружие и броня": {
    open: ["Если идёшь туда, где спорят сталью, выбирай без спешки."],
    buy_success: ["Сталь любит твёрдую руку. Не разочаруй её."],
    sell_success: ["Проверю кромку. Если не врёшь — заплачу честно."],
    no_money: ["Хорошее железо не дешевеет от твоей бедности."],
    big_purchase: ["Так закупаются не путники. Так закупается отряд."],
  },
  "Одежда и кожа": {
    open: ["Дорога начинается не с меча, а с того, что не натирает плечи."],
    buy_success: ["Сядет как надо. Если нет — вернёшься на подгонку."],
    sell_success: ["Кожа многое помнит. Посмотрим, что из этого ещё можно спасти."],
    reserve_success: ["Отложу отдельно, чтобы чужие руки не мяли."],
  },
  "Еда и ночлег": {
    open: ["Садись ближе к теплу. Пустой желудок плохо думает."],
    buy_success: ["Вот. В дороге это ценнее красивых речей."],
    sell_success: ["Если это съедобно — разберёмся. Если нет — тем более."],
    no_money: ["Кормить в долг могу, но недолго и не всех."],
    big_purchase: ["С такими припасами можно пережить и бурю, и компанию бардов."],
  },
  "Товары и редкости": {
    open: ["Не всё на полках имеет цену. Но за всё можно поторговаться."],
    buy_success: ["Редкая вещица. Главное — не спрашивай слишком громко, откуда она."],
    sell_success: ["Люблю предметы с историей. Даже если история пахнет подвалом."],
    no_money: ["Редкости любят полные кошели."],
    big_sale: ["Ого. С таким мешком ты либо герой, либо бедствие."],
  },
  "Ремесло и транспорт": {
    open: ["Если колесо отвалится в грязи, вспоминать будешь не богов, а мастера."],
    buy_success: ["Проверено руками. Не молитвами."],
    sell_success: ["Починить можно почти всё. Кроме дурной головы."],
    reserve_success: ["Отложу, но место в мастерской не резиновое."],
  },
  "Травы и алхимия": {
    open: ["Не нюхай незнакомые склянки. Второй раз это правило не объясняют."],
    buy_success: ["Доза важнее храбрости. Запомни это."],
    sell_success: ["Покажи. Если не ядовито — узнаем, почему пахнет как ядовитое."],
    no_money: ["Лечение бесплатно бывает только в сказках и после смерти."],
    big_purchase: ["Столько зелий берут те, кто уже видел, как быстро кончается удача."],
  },
  "Река и контрабанда": {
    open: ["Говори тише. Вода далеко несёт не только лодки."],
    close: ["Если кто спросит — ты меня не видел."],
    buy_success: ["Забирай и не свети на пристани."],
    sell_success: ["Хм. Это можно пустить вниз по реке."],
    no_money: ["На реке без платы перевозят только трупы."],
    big_purchase: ["Такой груз лучше не показывать страже."],
    big_sale: ["Не хочу знать, откуда это. И тебе советую забыть."],
  },
};

const TRADER_DIALOGUE_BY_NAME = {
  "Элдрас Тантур": {
    open: ["Кузня горит. Говори, что нужно, пока железо горячее."],
    buy_success: ["Держи. Не бей плашмя, если только не хочешь выглядеть глупо."],
    close: ["Вернёшься с трещиной на клинке — не говори, что я не предупреждал."],
  },
  "Фенг Железноголовый": {
    open: ["Заходи. Здесь вещи для тех, кто возвращается, а не только уходит."],
    buy_success: ["Хорошая хватка. Видно, не просто для красоты берёшь."],
    no_money: ["Не обижайся, друг. Наёмники тоже едят за деньги."],
  },
  "Хельвур Тарнлар": {
    open: ["Прошу, не трогай ткань грязными перчатками."],
    buy_success: ["Наконец-то выбор с намёком на вкус."],
    no_money: ["Высокая мода и пустой кошель редко ходят вместе."],
  },
  "Мэйгла Тарнлар": {
    open: ["Подойди ближе, я посмотрю, что тебе подойдёт в дороге."],
    buy_success: ["Вот так лучше. Вещь должна помогать, а не спорить с хозяином."],
    close: ["Береги швы. Дорога любит рвать самое нужное."],
  },
  "Фаендра Чансирл": {
    open: ["Ремни, сумки, сапоги — всё, что держит путника целым."],
    buy_success: ["Крепкая работа. С ней можно идти дальше, чем кажется."],
    big_purchase: ["Ого. Похоже, кто-то собирается не в соседнюю деревню."],
  },
  "Улро Лурут": {
    open: ["Смотри сам. Я лишнего не расхваливаю."],
    buy_success: ["Прочная кожа. Без красоты, зато надолго."],
    close: ["Закрой дверь. Растворы быстро выветриваются."],
  },
  "Кайлесса Иркелл": {
    open: ["Проходи. У огня места хватит, если не приносишь с собой беду."],
    buy_success: ["Сытный путь — живой путь."],
    big_purchase: ["Такой запас берут перед долгой дорогой. Или перед плохими новостями."],
  },
  "Гарлен Харлатурл": {
    open: ["Плати сразу, жалуйся потом. Так всем проще."],
    buy_success: ["Вот и славно. Деньги любят быстрые руки."],
    no_money: ["За красивые истории у меня даже мыши не питаются."],
  },
  "Мангобарл Лоррен": {
    open: ["Свежий хлеб, свежие слухи. Второе иногда горячее первого."],
    buy_success: ["Бери, пока корка хрустит."],
    big_purchase: ["Столько хлеба? Ты кормишь отряд или прячешься от осады?"],
  },
  "Ялесса Орнра": {
    open: ["Выбирай быстро. Ножи не любят праздных разговоров."],
    buy_success: ["Свежее. Настолько, насколько тебе нужно знать."],
    close: ["Не стой у двери, там сквозняк мясо портит."],
  },
  "Эндрит Валливой": {
    open: ["Осторожнее со свитками. Некоторые старше твоих долгов."],
    buy_success: ["Интересный выбор. У этой вещи, кажется, была жизнь до тебя."],
    sell_success: ["О, занятно. Пыль на ней говорит почти так же много, как ты."],
  },
  "Марландро Газлькур": {
    open: ["Стрижка, зеркальце, сомнительная удача — всё по разумной цене."],
    buy_success: ["Замечательно. И никому не обязательно знать, где ты это взял."],
    sell_success: ["Хм. На витрину не поставлю, но нужный человек найдётся."],
  },
  "Хазлия Ханадроум": {
    open: ["Тише, путник. Иногда горячая вода лечит лучше меча."],
    buy_success: ["Пусть эта мелочь сделает дорогу мягче."],
    close: ["Возвращайся, когда пыль снова победит приличия."],
  },
  "Тёрск Телорн": {
    open: ["Фургон не врёт. Если скрипит — значит, просит мастера."],
    buy_success: ["Добротная вещь. Не бросай в грязь без нужды."],
  },
  "Асдан Телорн": {
    open: ["Если путь дальний, проверь оси сейчас, а не в канаве."],
    buy_success: ["Подойдёт. Я бы сам взял в дорогу."],
  },
  "Ильмет Вэльвур": {
    open: ["Дешево — не значит плохо. Иногда значит просто честно плохо."],
    buy_success: ["Ну вот. Ещё один доволен, пока не доехал."],
    no_money: ["Даже мои цены требуют хотя бы каких-то денег."],
  },
  "Эйриго Бетендур": {
    open: ["Склад открыт. Вопросы оставь у двери."],
    buy_success: ["Запишу как обычную отгрузку. Обычную, понял?"],
    close: ["Если кто спросит, ты забирал ящик с гвоздями."],
  },
  "Шоалар Куандерил": {
    open: ["Говори тихо. Река слушает лучше людей."],
    buy_success: ["Забирай. И не показывай это там, где задают вопросы."],
    sell_success: ["Это уйдёт вниз по течению быстрее, чем ты думаешь."],
    no_money: ["Без монет на моей лодке место только за бортом."],
    big_purchase: ["Хороший груз. Плохая идея светить им на дороге."],
  },
  "Гариена": {
    open: ["Не трогай синие листья. Они кусаются хуже собак."],
    buy_success: ["Запомни дозировку. Природа не любит самоуверенных."],
    sell_success: ["Хм. Это росло не здесь. Интересно."],
    no_money: ["Я могу помочь советом. Зелья стоят дороже."],
  },
  "Тарм Громовой Молот": {
    open: ["Громкое имя, тихая работа. Что нужно починить?"],
    buy_success: ["Крепко сделано. Я бы не стыдился такой вещи."],
  },
  "Аэрего Кейлин": {
    open: ["Карты, сухие пайки, верёвки. Сначала маршрут, потом геройство."],
    buy_success: ["Хорошо. Значит, хотя бы один человек сегодня подумал заранее."],
    big_purchase: ["Так собираются те, кто знает: назад может быть другой дорогой."],
    close: ["Не сворачивай на тропу с тремя сухими соснами. Просто поверь."],
  },
};

function getTraderDisplayName(trader) {
  return String(trader?.name || trader?.trader_name || "Торговец").trim() || "Торговец";
}

function chooseTraderDialogueLine(trader, eventName, context = {}) {
  const eventKey = String(eventName || "open").trim() || "open";
  const name = getTraderDisplayName(trader);
  const type = String(trader?.type || "").trim();

  const nameLines = TRADER_DIALOGUE_BY_NAME[name]?.[eventKey];
  const typeLines = TRADER_DIALOGUE_BY_TYPE[type]?.[eventKey];
  const genericLines = TRADER_DIALOGUE_GENERIC[eventKey];
  const pool = [
    ...(Array.isArray(nameLines) ? nameLines : []),
    ...(Array.isArray(typeLines) ? typeLines : []),
    ...(Array.isArray(genericLines) ? genericLines : []),
  ].filter(Boolean);

  if (!pool.length) return "";

  const quantity = Math.max(1, safeNumber(context.quantity, 1));
  const itemName = String(context.itemName || context.item?.name || "").trim();
  const seed = `${name}:${eventKey}:${itemName}:${quantity}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return pool[hash % pool.length];
}

function ensureTraderStageLine() {
  let style = document.getElementById("trader-stage-line-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "trader-stage-line-style";
    style.textContent = `
      #traderStageLine {
        position: fixed;
        left: 50%;
        top: 52%;
        transform: translate(-50%, -50%);
        z-index: 2600;
        max-width: min(760px, calc(100vw - 36px));
        min-width: min(420px, calc(100vw - 36px));
        padding: 18px 22px;
        border: 1px solid rgba(210, 174, 104, 0.36);
        border-radius: 18px;
        background:
          radial-gradient(circle at 16% 0%, rgba(34, 139, 148, 0.18), transparent 34%),
          linear-gradient(135deg, rgba(7, 17, 22, 0.96), rgba(2, 8, 11, 0.96));
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(140, 217, 224, 0.08);
        color: #f2e3c3;
        font-size: 18px;
        line-height: 1.45;
        letter-spacing: 0.015em;
        text-align: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 220ms ease, transform 220ms ease;
      }

      #traderStageLine.is-visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      #traderStageLine .trader-stage-line-name {
        display: block;
        margin-bottom: 8px;
        color: #d8b16a;
        font-size: 13px;
        letter-spacing: 0.11em;
        text-transform: uppercase;
      }

      #traderStageLine .trader-stage-line-text::after {
        content: "▌";
        display: inline-block;
        margin-left: 3px;
        color: rgba(242, 227, 195, 0.72);
        animation: traderStageCaret 900ms steps(2, start) infinite;
      }

      #traderStageLine.is-done .trader-stage-line-text::after {
        display: none;
      }

      @keyframes traderStageCaret {
        0%, 45% { opacity: 1; }
        46%, 100% { opacity: 0; }
      }

      @media (max-width: 720px) {
        #traderStageLine {
          top: 50%;
          min-width: auto;
          padding: 15px 16px;
          font-size: 15px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  let box = document.getElementById("traderStageLine");
  if (!box) {
    box = document.createElement("div");
    box.id = "traderStageLine";
    box.setAttribute("aria-live", "polite");
    box.innerHTML = `
      <span class="trader-stage-line-name"></span>
      <span class="trader-stage-line-text"></span>
    `;
    document.body.appendChild(box);
  }

  return box;
}

function showTraderStageLine(trader, line, options = {}) {
  const text = String(line || "").trim();
  if (!text) return;

  const name = getTraderDisplayName(trader);
  const now = Date.now();
  const duplicateKey = `${name}:${text}`;
  if (duplicateKey === lastTraderDialogueKey && now - lastTraderDialogueAt < 900) return;
  lastTraderDialogueKey = duplicateKey;
  lastTraderDialogueAt = now;

  const box = ensureTraderStageLine();
  const nameEl = box.querySelector(".trader-stage-line-name");
  const textEl = box.querySelector(".trader-stage-line-text");
  if (!nameEl || !textEl) return;

  window.clearTimeout(traderDialogueTypeTimer);
  window.clearTimeout(traderDialogueHideTimer);

  nameEl.textContent = name;
  textEl.textContent = "";
  box.classList.remove("is-done");
  box.classList.add("is-visible");

  let index = 0;
  const speed = Math.max(8, safeNumber(options.speed, TRADER_DIALOGUE_TYPEWRITER_SPEED_MS));

  const tick = () => {
    index += 1;
    textEl.textContent = text.slice(0, index);

    if (index < text.length) {
      traderDialogueTypeTimer = window.setTimeout(tick, speed);
      return;
    }

    box.classList.add("is-done");
    traderDialogueHideTimer = window.setTimeout(() => {
      box.classList.remove("is-visible");
    }, Math.max(900, safeNumber(options.holdMs, TRADER_DIALOGUE_HOLD_MS)));
  };

  traderDialogueTypeTimer = window.setTimeout(tick, 40);
}

function showTraderDialogue(trader, eventName, context = {}) {
  if (!trader) return;
  const line = chooseTraderDialogueLine(trader, eventName, context);
  showTraderStageLine(trader, line, context);
}

function getItemTradeCp(item, quantity = 1) {
  if (!item) return 0;
  const qty = Math.max(1, safeNumber(quantity, 1));
  return (
    moneyPartsToCp(
      item.buy_price_gold ?? item.price_gold,
      item.buy_price_silver ?? item.price_silver,
      item.buy_price_copper ?? item.price_copper
    ) * qty
  );
}

function getActiveTraderForDialogue() {
  return getTraderById(STATE.activeTraderId) || null;
}

function shouldUseBigTradeLine(item, quantity = 1, totalCp = 0) {
  const qty = Math.max(1, safeNumber(quantity, 1));
  const cp = Math.max(0, safeNumber(totalCp, 0));
  return qty >= TRADER_DIALOGUE_BIG_QUANTITY || cp >= TRADER_DIALOGUE_BIG_TRADE_CP;
}

function bindTraderDialogueCloseWatcher() {
  if (traderDialogueCloseWatcherBound) return;
  traderDialogueCloseWatcherBound = true;

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== "function") return;
      const modal = getEl("traderModal");
      if (!modal || modal.style.display === "none") return;

      const isCloseClick = Boolean(
        target.closest("#traderModal [data-trader-modal-close]") ||
          target.closest("#traderModal .close") ||
          target === modal
      );

      if (isCloseClick) {
        showTraderDialogue(getActiveTraderForDialogue(), "close");
      }
    },
    true
  );
}

function installTraderDialogueActionWrappers() {
  if (traderDialogueActionWrappersBound) return;
  traderDialogueActionWrappersBound = true;
  bindTraderDialogueCloseWatcher();

  if (typeof window.openTraderModal === "function") {
    const originalOpenTraderModal = window.openTraderModal;
    window.openTraderModal = async function openTraderModalWithDialogue(traderId, ...rest) {
      const result = await originalOpenTraderModal.call(this, traderId, ...rest);
      const trader = getTraderById(traderId) || getActiveTraderForDialogue();
      showTraderDialogue(trader, "open");
      return result;
    };
    window.openTrader = window.openTraderModal;
  }

  if (typeof window.buyItem === "function") {
    const originalBuyItem = window.buyItem;
    window.buyItem = async function buyItemWithDialogue(traderId, itemId, quantity = 1, options = {}) {
      const qty = Math.max(1, safeNumber(quantity, 1));
      const trader = getTraderById(traderId);
      const item = getTraderItem(traderId, itemId);
      const totalCp = getItemTradeCp(item, qty);

      try {
        const result = await originalBuyItem.call(this, traderId, itemId, quantity, options);
        if (result?.cancelled) return result;
        showTraderDialogue(
          trader || getTraderById(traderId),
          shouldUseBigTradeLine(item, qty, totalCp) ? "big_purchase" : "buy_success",
          { item, itemName: item?.name, quantity: qty, totalCp }
        );
        return result;
      } catch (error) {
        const message = String(error?.message || "").toLowerCase();
        const isNoMoney =
          message.includes("недостаточно") ||
          message.includes("money") ||
          message.includes("средств");

        if (isNoMoney) {
          showTraderDialogue(trader || getTraderById(traderId), "no_money", {
            item,
            itemName: item?.name,
            quantity: qty,
            totalCp,
          });

          // Это ожидаемый игровой отказ, а не ошибка JS.
          // Не пробрасываем дальше, чтобы браузер не писал
          // Uncaught (in promise) после обычного “не хватает денег”.
          return {
            cancelled: true,
            reason: "no_money",
            error,
          };
        }

        throw error;
      }
    };
  }

  if (typeof window.sellItem === "function") {
    const originalSellItem = window.sellItem;
    window.sellItem = async function sellItemWithDialogue(itemId, quantity = 1, options = {}) {
      const qty = Math.max(1, safeNumber(quantity, 1));
      const inventoryItem = findInventoryItemById(STATE.inventory, itemId);
      const traderId = Number(options?.traderId ?? inventoryItem?.trader_id ?? STATE.activeTraderId);
      const trader = Number.isFinite(traderId) ? getTraderById(traderId) : getActiveTraderForDialogue();
      const totalCp = inventoryItem ? getSellTotalCp(inventoryItem, qty) : 0;

      const result = await originalSellItem.call(this, itemId, quantity, options);
      if (result?.cancelled) return result;
      showTraderDialogue(
        trader || getActiveTraderForDialogue(),
        shouldUseBigTradeLine(inventoryItem, qty, totalCp) ? "big_sale" : "sell_success",
        { item: inventoryItem, itemName: inventoryItem?.name, quantity: qty, totalCp }
      );
      return result;
    };
  }

  if (typeof window.reserveItem === "function") {
    const originalReserveItem = window.reserveItem;
    window.reserveItem = function reserveItemWithDialogue(itemId, traderId = null, quantity = 1) {
      const resolvedTraderId = traderId ?? STATE.activeTraderId;
      const trader = getTraderById(resolvedTraderId) || getActiveTraderForDialogue();
      const item = resolvedTraderId != null ? getTraderItem(resolvedTraderId, itemId) : null;
      const result = originalReserveItem.call(this, itemId, traderId, quantity);
      if (item) {
        showTraderDialogue(trader, "reserve_success", {
          item,
          itemName: item?.name,
          quantity,
        });
      }
      return result;
    };
  }

  if (typeof window.addToCart === "function") {
    const originalAddToCart = window.addToCart;
    window.addToCart = function addToCartWithDialogue(traderId, itemId, quantity = 1) {
      const trader = getTraderById(traderId);
      const item = getTraderItem(traderId, itemId);
      const result = originalAddToCart.call(this, traderId, itemId, quantity);
      if (item) {
        showTraderDialogue(trader, "cart_add", {
          item,
          itemName: item?.name,
          quantity,
        });
      }
      return result;
    };
  }
}

window.showTraderStageLine = showTraderStageLine;
window.showTraderDialogue = showTraderDialogue;

function openModal(modalId) {
  const modal = getEl(modalId);
  if (modal) modal.style.display = "block";
}

function closeModal(modal) {
  if (!modal) return;

  if (modal.id === "traderModal" && modal.style.display !== "none") {
    showTraderDialogue(getActiveTraderForDialogue(), "close");
  }

  modal.style.display = "none";
}

function cpToMoneyParts(cp = 0) {
  const total = Math.max(0, safeNumber(cp, 0));
  const gold = Math.floor(total / COPPER_IN_GOLD);
  const remainderAfterGold = total % COPPER_IN_GOLD;
  const silver = Math.floor(remainderAfterGold / COPPER_IN_SILVER);
  const copper = remainderAfterGold % COPPER_IN_SILVER;
  return { gold, silver, copper };
}

function moneyPartsToCp(gold = 0, silver = 0, copper = 0) {
  return Math.max(
    0,
    safeNumber(gold, 0) * COPPER_IN_GOLD +
      safeNumber(silver, 0) * COPPER_IN_SILVER +
      safeNumber(copper, 0)
  );
}

function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);
  return parts.length ? parts.join(" ") : "0з";
}

function formatMoneyCp(cp = 0) {
  const { gold, silver, copper } = cpToMoneyParts(cp);
  return formatMoneyParts(gold, silver, copper);
}

function initGuestMoneyCp() {
  const raw = localStorage.getItem(GUEST_MONEY_STORAGE_KEY);

  if (raw === null || raw === undefined || raw === "") {
    localStorage.setItem(GUEST_MONEY_STORAGE_KEY, String(GUEST_START_GOLD_CP));
    localStorage.setItem(GUEST_MONEY_STORAGE_VERSION_KEY, GUEST_MONEY_STORAGE_VERSION);
    return GUEST_START_GOLD_CP;
  }

  const storedVersion = localStorage.getItem(GUEST_MONEY_STORAGE_VERSION_KEY);
  const cp = Math.max(0, safeNumber(raw, GUEST_START_GOLD_CP));

  if (storedVersion !== GUEST_MONEY_STORAGE_VERSION) {
    localStorage.setItem(GUEST_MONEY_STORAGE_KEY, String(cp));
    localStorage.setItem(GUEST_MONEY_STORAGE_VERSION_KEY, GUEST_MONEY_STORAGE_VERSION);
  }

  return cp;
}

function persistGuestMoney() {
  localStorage.setItem(
    GUEST_MONEY_STORAGE_KEY,
    String(Math.max(0, safeNumber(STATE.guestMoneyCp, GUEST_START_GOLD_CP)))
  );
  localStorage.setItem(GUEST_MONEY_STORAGE_VERSION_KEY, GUEST_MONEY_STORAGE_VERSION);
}

function initGuestRole() {
  const raw = String(localStorage.getItem(GUEST_ROLE_STORAGE_KEY) || "player")
    .trim()
    .toLowerCase();

  return raw === "gm" || raw === "admin" ? "gm" : "player";
}

function persistGuestRole() {
  localStorage.setItem(
    GUEST_ROLE_STORAGE_KEY,
    STATE.guestRole === "gm" ? "gm" : "player"
  );
}

function getDefaultTraderModalUiPrefs() {
  return {
    mainTab: "buy",
    buyCategory: "",
    buyViewMode: "table",
    sellViewMode: "table",
  };
}

function readTraderModalUiPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADER_MODAL_UI_PREFS_KEY) || "{}");
    const defaults = getDefaultTraderModalUiPrefs();
    const next = {
      ...defaults,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };

    next.mainTab = ["buy", "sell", "stats", "info"].includes(String(next.mainTab || ""))
      ? String(next.mainTab)
      : defaults.mainTab;

    next.buyCategory = String(next.buyCategory || "").trim();

    next.buyViewMode = ["table", "inventory", "grid"].includes(String(next.buyViewMode || ""))
      ? String(next.buyViewMode)
      : defaults.buyViewMode;

    next.sellViewMode = ["table", "inventory", "grid"].includes(String(next.sellViewMode || ""))
      ? String(next.sellViewMode)
      : defaults.sellViewMode;

    return next;
  } catch {
    return getDefaultTraderModalUiPrefs();
  }
}

function persistTraderModalUiPrefs(nextPrefs = {}) {
  try {
    const merged = {
      ...readTraderModalUiPrefs(),
      ...(nextPrefs && typeof nextPrefs === "object" ? nextPrefs : {}),
    };
    localStorage.setItem(TRADER_MODAL_UI_PREFS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return getDefaultTraderModalUiPrefs();
  }
}

function getTraderModalElement() {
  return getEl("traderModal");
}

function rememberTraderModalMainTab(tabName) {
  persistTraderModalUiPrefs({ mainTab: String(tabName || "buy") });
}

function rememberTraderModalBuyCategory(categoryName) {
  persistTraderModalUiPrefs({ buyCategory: String(categoryName || "").trim() });
}

function rememberTraderModalViewMode(mode, scope = "buy") {
  const nextMode = ["table", "inventory", "grid"].includes(String(mode || ""))
    ? String(mode)
    : "table";

  if (scope === "sell") {
    persistTraderModalUiPrefs({ sellViewMode: nextMode });
    return;
  }

  persistTraderModalUiPrefs({ buyViewMode: nextMode });
}

function triggerControlChange(control) {
  if (!control) return;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyTraderModalViewModes(modal, prefs) {
  if (!modal) return;

  modal
    .querySelectorAll('#tab-buy .category-content .view-mode-inline')
    .forEach((select) => {
      if (select.value !== prefs.buyViewMode) {
        select.value = prefs.buyViewMode;
        triggerControlChange(select);
      }
    });

  modal
    .querySelectorAll('#tab-sell .view-mode-inline')
    .forEach((select) => {
      if (select.value !== prefs.sellViewMode) {
        select.value = prefs.sellViewMode;
        triggerControlChange(select);
      }
    });
}

function restoreTraderModalUiPrefs(modal = null) {
  const targetModal = modal || getTraderModalElement();
  if (!targetModal) return;

  const prefs = readTraderModalUiPrefs();

  applyTraderModalViewModes(targetModal, prefs);

  const tabBtn =
    targetModal.querySelector(`.tab-btn[data-main-tab="${prefs.mainTab}"]`) ||
    targetModal.querySelector('.tab-btn[data-main-tab="buy"]');

  if (tabBtn) {
    tabBtn.click();
  }

  const buyCategoryButtons = [...targetModal.querySelectorAll('#tab-buy .category-tab[data-cat]')];
  if (buyCategoryButtons.length) {
    const categoryBtn =
      buyCategoryButtons.find((btn) => String(btn.dataset.cat || "") === prefs.buyCategory) ||
      buyCategoryButtons[0];

    if (categoryBtn) {
      categoryBtn.click();
    }
  }

  applyTraderModalViewModes(targetModal, prefs);
}

function bindTraderModalUiPersistence() {
  const modal = getTraderModalElement();
  if (!modal || modal.dataset.boundUiPrefs === "1") return;

  modal.dataset.boundUiPrefs = "1";

  modal.addEventListener("click", (event) => {
    const tabBtn = event.target.closest(".tab-btn[data-main-tab]");
    if (tabBtn) {
      rememberTraderModalMainTab(tabBtn.dataset.mainTab);
      return;
    }

    const categoryBtn = event.target.closest(".category-tab[data-cat]");
    if (categoryBtn) {
      rememberTraderModalBuyCategory(categoryBtn.dataset.cat);
    }
  });

  modal.addEventListener("change", (event) => {
    const viewSelect = event.target.closest(".view-mode-inline");
    if (!viewSelect) return;

    const scope = viewSelect.closest("#tab-sell") ? "sell" : "buy";
    rememberTraderModalViewMode(viewSelect.value, scope);
  });
}

function getEffectiveRole() {
  const userRole = String(STATE.user?.role || "").trim().toLowerCase();
  if (userRole === "gm" || userRole === "admin") return "gm";
  if (STATE.user) return "player";
  return STATE.guestRole === "gm" ? "gm" : "player";
}

function isGuestMode() {
  return !(STATE.token && STATE.user);
}

function canEditTestMoney() {
  if (isGuestMode()) return true;
  return getEffectiveRole() === "gm";
}

function persistUser() {
  try {
    localStorage.setItem("user", JSON.stringify(STATE.user || null));
  } catch (_) {}
}

function restoreUserFromLocalStorage() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.user && typeof parsed.user === "object") {
      return parsed.user;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedUser() {
  localStorage.removeItem("user");
}

function normalizeMoneyFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  if (payload.money_cp_total !== undefined) {
    const cp = Math.max(0, safeNumber(payload.money_cp_total, 0));
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  if (
    payload.money_gold !== undefined ||
    payload.money_silver !== undefined ||
    payload.money_copper !== undefined
  ) {
    const cp = moneyPartsToCp(
      payload.money_gold,
      payload.money_silver,
      payload.money_copper
    );
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  if (
    payload.gold !== undefined ||
    payload.silver !== undefined ||
    payload.copper !== undefined
  ) {
    const cp = moneyPartsToCp(payload.gold, payload.silver, payload.copper);
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  return null;
}

function updateUserMoneyFromPayload(payload) {
  const money = normalizeMoneyFromPayload(payload);
  if (!money) return;

  if (STATE.user) {
    STATE.user.money_cp_total = money.cp;
    STATE.user.money_label = money.label;
    persistUser();
  } else {
    STATE.guestMoneyCp = money.cp;
    persistGuestMoney();
  }

  syncMoneyControls();
}

function getCurrentMoneyLabel() {
  if (STATE.user?.money_label) return STATE.user.money_label;
  if (STATE.user?.money_cp_total !== undefined) {
    return formatMoneyCp(STATE.user.money_cp_total);
  }
  return formatMoneyCp(STATE.guestMoneyCp);
}

function getCurrentMoneyCp() {
  if (STATE.user?.money_cp_total !== undefined) {
    return Math.max(0, safeNumber(STATE.user.money_cp_total, 0));
  }
  return Math.max(0, safeNumber(STATE.guestMoneyCp, GUEST_START_GOLD_CP));
}

function getCurrentMoneyGoldValue() {
  const { gold } = cpToMoneyParts(getCurrentMoneyCp());
  return gold;
}

function setGuestMoneyFromGold(goldValue) {
  const normalizedGold = Math.max(0, Math.floor(safeNumber(goldValue, GUEST_START_GOLD)));
  STATE.guestMoneyCp = moneyPartsToCp(normalizedGold, 0, 0);
  persistGuestMoney();
}

function setTestMoneyFromGold(goldValue) {
  const normalizedGold = Math.max(0, Math.floor(safeNumber(goldValue, GUEST_START_GOLD)));
  const cp = moneyPartsToCp(normalizedGold, 0, 0);

  if (isGuestMode()) {
    setGuestMoneyFromGold(normalizedGold);
    return;
  }

  if (!STATE.user) return;
  STATE.user.money_cp_total = cp;
  STATE.user.money_label = formatMoneyCp(cp);
  persistUser();
  syncGlobalStateBridges();
}

async function syncPlayerMoneyToServer({ silent = false } = {}) {
  if (!STATE.token || !STATE.user) return null;

  try {
    const payload = await apiUpdatePlayerMoney(getCurrentMoneyCp());
    updateUserMoneyFromPayload(payload);
    syncGlobalStateBridges();
    return payload;
  } catch (error) {
    console.warn("Не удалось синхронизировать золото с сервером:", error);
    if (!silent) {
      showToast("Золото изменено локально, но сервер не принял синхронизацию");
    }
    return null;
  }
}

function getTraderMoneyCp(trader) {
  if (!trader) return 0;

  if (trader.money_cp_total !== undefined && trader.money_cp_total !== null) {
    return Math.max(0, safeNumber(trader.money_cp_total, 0));
  }

  if (trader.gold_numeric !== undefined && trader.gold_numeric !== null) {
    return moneyPartsToCp(trader.gold_numeric, 0, 0);
  }

  if (
    trader.gold !== undefined ||
    trader.silver !== undefined ||
    trader.copper !== undefined
  ) {
    return moneyPartsToCp(
      safeNumber(trader.gold, 0),
      safeNumber(trader.silver, 0),
      safeNumber(trader.copper, 0)
    );
  }

  return 0;
}

function setTraderMoneyCp(trader, cp) {
  if (!trader) return;

  const normalizedCp = Math.max(0, safeNumber(cp, 0));
  const parts = cpToMoneyParts(normalizedCp);
  const label = formatMoneyParts(parts.gold, parts.silver, parts.copper);

  trader.money_cp_total = normalizedCp;
  trader.gold_numeric = parts.gold;
  trader.gold = parts.gold;
  trader.silver = parts.silver;
  trader.copper = parts.copper;
  trader.money_gold = parts.gold;
  trader.money_silver = parts.silver;
  trader.money_copper = parts.copper;
  trader.gold_label = label;
  trader.money_label = label;
}

function logTradeSnapshot(action, payload) {
  console.log(`[TRADE:${action}]`, payload);
}

function emitAppHistoryEvent(detail = {}) {
  if (!detail || typeof detail !== "object") return;

  const now = new Date().toISOString();
  const currentUser = STATE.user || window.__appUser || {};
  const actor =
    currentUser?.nickname ||
    currentUser?.display_name ||
    currentUser?.username ||
    currentUser?.email ||
    (STATE.token ? "Игрок" : "Гость");

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:history:add", {
        detail: {
          actor,
          created_at: now,
          timestamp: now,
          ...detail,
        },
      })
    );
  } catch (_) {}
}

function setAppLoadingStatus(message) {
  try {
    if (typeof window.__setAppLoadingStatus === "function") {
      window.__setAppLoadingStatus(String(message || "Загрузка..."));
    }
  } catch (_) {}
}

function hideAppLoadingOverlay() {
  try {
    if (typeof window.__hideAppLoadingOverlay === "function") {
      window.__hideAppLoadingOverlay();
    }
  } catch (_) {}
}

async function syncOpenTraderModalIfVisible(preferredTraderId = null) {
  const modal = getEl("traderModal");
  if (!modal || modal.style.display !== "block") return;

  const targetId = preferredTraderId != null
    ? Number(preferredTraderId)
    : Number(STATE.activeTraderId);

  if (!Number.isFinite(targetId)) return;
  await renderOpenTraderModal(targetId);
  restoreTraderModalUiPrefs();
}

// ------------------------------------------------------------
// 🔗 GLOBAL BRIDGES
// ------------------------------------------------------------
function syncGlobalStateBridges() {
  const effectiveRole = getEffectiveRole();

  window.__appState = STATE;
  window.__appCartState = STATE.cart;
  window.__appStateInventory = STATE.inventory;
  window.__appStateReserved = STATE.reserved;
  window.__appStateTraders = STATE.traders;
  window.__appUser = STATE.user;
  window.__appUserRole = effectiveRole;
  window.__appMoneyCpTotal = getCurrentMoneyCp();
  window.__appMoneyLabel = getCurrentMoneyLabel();
  window.__userRole = effectiveRole;

  document.body.dataset.role = effectiveRole;

  window.getReservedItems = () => STATE.reserved;
}

function syncMoneyControls() {
  const playerGoldInput = getEl("playerGoldInput");
  const updateGoldBtn = getEl("updateGoldBtn");
  const resetGoldBtn = getEl("resetGoldBtn");
  const userMoney = getEl("user-money");

  const goldValue = getCurrentMoneyGoldValue();
  const moneyLabel = getCurrentMoneyLabel();
  const testMoneyMode = canEditTestMoney();

  if (playerGoldInput) {
    playerGoldInput.value = String(goldValue);
    playerGoldInput.disabled = !testMoneyMode || STATE.isBusy;
    playerGoldInput.title = testMoneyMode ? "Тестовое золото для текущего режима" : moneyLabel;
  }

  if (updateGoldBtn) {
    updateGoldBtn.disabled = !testMoneyMode || STATE.isBusy;
  }

  if (resetGoldBtn) {
    resetGoldBtn.disabled = !testMoneyMode || STATE.isBusy;
  }

  if (userMoney) {
    userMoney.classList.remove("hidden");
    userMoney.textContent = moneyLabel;
  }
}

async function applyGuestMoneyUpdateFromInput() {
  if (!canEditTestMoney()) {
    showToast("Тестовое золото доступно только гостю или авторизованному GM");
    syncMoneyControls();
    return;
  }

  const playerGoldInput = getEl("playerGoldInput");
  if (!playerGoldInput) return;

  const inputGold = Math.max(0, Math.floor(safeNumber(playerGoldInput.value, GUEST_START_GOLD)));
  setTestMoneyFromGold(inputGold);
  await syncPlayerMoneyToServer({ silent: true });
  renderAllLocalState();
  syncMoneyControls();

  const moneyLabel = getCurrentMoneyLabel();

  logTradeSnapshot("UPDATE_GOLD", {
    goldInput: inputGold,
    moneyCp: getCurrentMoneyCp(),
    moneyLabel,
  });

  emitAppHistoryEvent({
    scope: "system",
    type: "money_update",
    action: "money_update",
    title: "Обновление золота",
    message: `Тестовое золото обновлено: ${moneyLabel}`,
    status: canEditTestMoney() ? getEffectiveRole() : "",
    money_cp_total: getCurrentMoneyCp(),
    money_label: moneyLabel,
  });

  showToast(`Ваше золото обновлено: ${moneyLabel}`);
}

async function resetGuestMoney() {
  if (!canEditTestMoney()) {
    showToast("Сброс тестового золота доступен только гостю или авторизованному GM");
    syncMoneyControls();
    return;
  }

  setTestMoneyFromGold(GUEST_START_GOLD);
  await syncPlayerMoneyToServer({ silent: true });
  renderAllLocalState();
  syncMoneyControls();

  const moneyLabel = getCurrentMoneyLabel();

  logTradeSnapshot("RESET_GOLD", {
    moneyCp: getCurrentMoneyCp(),
    moneyLabel,
  });

  emitAppHistoryEvent({
    scope: "system",
    type: "money_reset",
    action: "money_reset",
    title: "Сброс золота",
    message: `Тестовое золото сброшено: ${moneyLabel}`,
    status: canEditTestMoney() ? getEffectiveRole() : "",
    money_cp_total: getCurrentMoneyCp(),
    money_label: moneyLabel,
  });

  showToast(`Золото сброшено: ${moneyLabel}`);
}

function setBusy(flag) {
  STATE.isBusy = Boolean(flag);

  [
    "checkoutCartBtn",
    "clearCartBtn",
    "clearCartBtnModal",
    "refreshDataBtn",
    "doLogin",
    "doRegister",
    "updateGoldBtn",
    "resetGoldBtn",
  ].forEach((id) => {
    const el = getEl(id);
    if (!el) return;

    if (id === "updateGoldBtn" || id === "resetGoldBtn") {
      el.disabled = STATE.isBusy || !canEditTestMoney();
      return;
    }

    el.disabled = STATE.isBusy;
  });

  const playerGoldInput = getEl("playerGoldInput");
  if (playerGoldInput) {
    playerGoldInput.disabled = STATE.isBusy || !canEditTestMoney();
  }
}

function syncBusyUiState() {
  setBusy(STATE.isBusy);
  syncMoneyControls();
}

// ------------------------------------------------------------
// 📦 NORMALIZERS
// ------------------------------------------------------------
function normalizeTraderItem(item) {
  const stock = Math.max(0, safeNumber(item?.stock ?? item?.quantity ?? 0, 0));

  const priceGold = safeNumber(item?.price_gold ?? item?.buy_price_gold, 0);
  const priceSilver = safeNumber(item?.price_silver ?? item?.buy_price_silver, 0);
  const priceCopper = safeNumber(item?.price_copper ?? item?.buy_price_copper, 0);

  return {
    ...item,
    id: Number(item?.id || item?.item_id),
    item_id: Number(item?.item_id || item?.id),
    stock,
    quantity: stock,
    price_gold: priceGold,
    price_silver: priceSilver,
    price_copper: priceCopper,
    buy_price_gold: safeNumber(item?.buy_price_gold ?? priceGold, 0),
    buy_price_silver: safeNumber(item?.buy_price_silver ?? priceSilver, 0),
    buy_price_copper: safeNumber(item?.buy_price_copper ?? priceCopper, 0),
    sell_price_gold: safeNumber(item?.sell_price_gold, 0),
    sell_price_silver: safeNumber(item?.sell_price_silver, 0),
    sell_price_copper: safeNumber(item?.sell_price_copper, 0),
    category: item?.category || item?.category_clean || "",
  };
}

function normalizeTrader(trader) {
  const normalized = {
    ...trader,
    id: Number(trader?.id),
    reputation: safeNumber(trader?.reputation, 0),
    level_min: safeNumber(trader?.level_min, 0),
    level_max: safeNumber(trader?.level_max, 999),
    items: Array.isArray(trader?.items)
      ? trader.items.map((item) => normalizeTraderItem(item))
      : [],
  };

  const traderMoneyCp =
    trader?.money_cp_total !== undefined
      ? Math.max(0, safeNumber(trader.money_cp_total, 0))
      : moneyPartsToCp(
          safeNumber(trader?.gold, 0),
          safeNumber(trader?.silver, 0),
          safeNumber(trader?.copper, 0)
        );

  setTraderMoneyCp(normalized, traderMoneyCp);
  return normalized;
}

function normalizeInventoryItem(item) {
  return {
    ...item,
    id: Number(item.id || item.item_id),
    item_id: Number(item.item_id || item.id),
    trader_id: item.trader_id != null ? Number(item.trader_id) : null,
    quantity: Math.max(1, safeNumber(item.quantity, 1)),
    price_gold: safeNumber(item.price_gold, 0),
    price_silver: safeNumber(item.price_silver, 0),
    price_copper: safeNumber(item.price_copper, 0),
    buy_price_gold: safeNumber(item.buy_price_gold ?? item.price_gold, 0),
    buy_price_silver: safeNumber(item.buy_price_silver ?? item.price_silver, 0),
    buy_price_copper: safeNumber(item.buy_price_copper ?? item.price_copper, 0),
    sell_price_gold: safeNumber(item.sell_price_gold, 0),
    sell_price_silver: safeNumber(item.sell_price_silver, 0),
    sell_price_copper: safeNumber(item.sell_price_copper, 0),
  };
}

function getTraderById(traderId) {
  return STATE.traders.find((t) => Number(t.id) === Number(traderId)) || null;
}

function upsertTrader(trader) {
  if (!trader) return null;

  const normalized = normalizeTrader(trader);
  const index = STATE.traders.findIndex(
    (entry) => Number(entry.id) === Number(normalized.id)
  );

  if (index >= 0) {
    STATE.traders[index] = normalized;
  } else {
    STATE.traders.push(normalized);
  }

  syncGlobalStateBridges();
  return normalized;
}

async function refreshTraderById(traderId) {
  const id = Number(traderId);
  if (!Number.isFinite(id)) return null;

  try {
    const payload = await fetchTraderById(id);
    const trader = payload?.trader || payload;
    if (!trader || typeof trader !== "object") return null;
    return upsertTrader(trader);
  } catch (error) {
    console.warn("Не удалось обновить торговца по API:", error);
    return null;
  }
}

function getTraderItem(traderId, itemId) {
  const trader = getTraderById(traderId);
  if (!trader || !Array.isArray(trader.items)) return null;
  return trader.items.find((item) => Number(item.id) === Number(itemId)) || null;
}

function getCollectionItemPriceFields(item) {
  const priceGold = safeNumber(item.price_gold ?? item.buy_price_gold, 0);
  const priceSilver = safeNumber(item.price_silver ?? item.buy_price_silver, 0);
  const priceCopper = safeNumber(item.price_copper ?? item.buy_price_copper, 0);

  return {
    price_gold: priceGold,
    price_silver: priceSilver,
    price_copper: priceCopper,
  };
}

function normalizeCollectionItem(traderId, item, quantity = 1) {
  const { price_gold, price_silver, price_copper } = getCollectionItemPriceFields(item);

  return {
    ...item,
    id: Number(item.id || item.item_id),
    item_id: Number(item.item_id || item.id),
    trader_id: traderId != null ? Number(traderId) : null,
    quantity: Math.max(1, safeNumber(quantity, 1)),
    price_gold,
    price_silver,
    price_copper,
    buy_price_gold: safeNumber(item.buy_price_gold ?? price_gold, 0),
    buy_price_silver: safeNumber(item.buy_price_silver ?? price_silver, 0),
    buy_price_copper: safeNumber(item.buy_price_copper ?? price_copper, 0),
    stock: Math.max(0, safeNumber(item.stock ?? item.quantity, 0)),
  };
}

function getTraderMoneyFromTradePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return normalizeMoneyFromPayload({
    money_cp_total: payload.trader_money_cp ?? payload.trader_cp_total ?? undefined,
    money_gold: payload.trader_money_gold ?? payload.trader_gold ?? undefined,
    money_silver: payload.trader_money_silver ?? payload.trader_silver ?? undefined,
    money_copper: payload.trader_money_copper ?? payload.trader_copper ?? undefined,
    money_label: payload.trader_money_label ?? payload.trader_gold_label ?? undefined,
  });
}

function getCartEntryTotalCp(item) {
  return (
    moneyPartsToCp(item.price_gold, item.price_silver, item.price_copper) *
    Math.max(1, safeNumber(item.quantity, 1))
  );
}

function getCartTotalCp() {
  return STATE.cart.reduce((sum, item) => sum + getCartEntryTotalCp(item), 0);
}

function getCartTotalUnits() {
  return STATE.cart.reduce(
    (sum, entry) => sum + Math.max(1, safeNumber(entry.quantity, 1)),
    0
  );
}

function getSellTotalCp(item, quantity = 1) {
  const priceCp = moneyPartsToCp(
    item.sell_price_gold ?? 0,
    item.sell_price_silver ?? 0,
    item.sell_price_copper ?? 0
  );
  return priceCp * Math.max(1, safeNumber(quantity, 1));
}

function ensureGuestSellPrices(item, traderId = null) {
  if (
    safeNumber(item.sell_price_gold, 0) ||
    safeNumber(item.sell_price_silver, 0) ||
    safeNumber(item.sell_price_copper, 0)
  ) {
    return item;
  }

  const trader = traderId != null ? getTraderById(traderId) : null;
  const reputation = Math.max(0, Math.min(100, safeNumber(trader?.reputation, 0)));
  const baseCp = moneyPartsToCp(item.price_gold, item.price_silver, item.price_copper);

  const multiplier = 0.5 + (0.3 * (reputation / 100));
  const sellCp = Math.max(1, Math.round(baseCp * multiplier));
  const parts = cpToMoneyParts(sellCp);

  item.sell_price_gold = parts.gold;
  item.sell_price_silver = parts.silver;
  item.sell_price_copper = parts.copper;
  item.sell_price_label = formatMoneyParts(parts.gold, parts.silver, parts.copper);

  return item;
}

function patchTraderFromTradePayload(traderId, itemId, payload, quantity, action) {
  const trader = getTraderById(traderId);
  if (!trader || !payload || typeof payload !== "object") return;

  const traderItem = getTraderItem(traderId, itemId);
  const delta = Math.max(1, safeNumber(quantity, 1));

  const traderMoney = normalizeMoneyFromPayload({
    money_cp_total: payload.trader_money_cp ?? payload.trader_cp_total ?? undefined,
    money_gold: payload.trader_money_gold ?? payload.trader_gold ?? undefined,
    money_silver: payload.trader_money_silver ?? payload.trader_silver ?? undefined,
    money_copper: payload.trader_money_copper ?? payload.trader_copper ?? undefined,
    money_label: payload.trader_money_label ?? payload.trader_gold_label ?? undefined,
  });

  if (traderMoney) {
    setTraderMoneyCp(trader, traderMoney.cp);
  } else {
    const itemMoneyCp = traderItem
      ? (action === "sell"
          ? getSellTotalCp(traderItem, delta)
          : moneyPartsToCp(
              traderItem.buy_price_gold ?? traderItem.price_gold,
              traderItem.buy_price_silver ?? traderItem.price_silver,
              traderItem.buy_price_copper ?? traderItem.price_copper
            ) * delta)
      : 0;

    if (itemMoneyCp > 0) {
      const currentTraderMoneyCp = getTraderMoneyCp(trader);
      const nextTraderMoneyCp = action === "sell"
        ? Math.max(0, currentTraderMoneyCp - itemMoneyCp)
        : currentTraderMoneyCp + itemMoneyCp;

      setTraderMoneyCp(trader, nextTraderMoneyCp);
    }
  }

  if (traderItem) {
    if (payload.trader_stock !== undefined) {
      const stock = Math.max(0, safeNumber(payload.trader_stock, 0));
      traderItem.stock = stock;
      traderItem.quantity = stock;
    } else {
      if (action === "buy") {
        const nextStock = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0) - delta);
        traderItem.stock = nextStock;
        traderItem.quantity = nextStock;
      } else if (action === "sell") {
        const nextStock = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0) + delta);
        traderItem.stock = nextStock;
        traderItem.quantity = nextStock;
      }
    }
  }

  syncGlobalStateBridges();
}

// ------------------------------------------------------------
// 👤 UI STATE
// ------------------------------------------------------------
function updateUserUI() {
  const guestWarning = getEl("guestWarning");
  const logoutBtn = getEl("logoutBtn");
  const showAuthBtn = getEl("showAuthBtn");
  const authContainer = getEl("authContainer");
  const userMoney = getEl("user-money");
  const gmBadge = getEl("gmBadge");

  const effectiveRole = getEffectiveRole();
  const roleText = effectiveRole === "gm" ? "🎭 ГМ" : "👤 Игрок";

  if (STATE.user) {
    guestWarning?.classList.add("hidden");
    logoutBtn?.classList.remove("hidden");
    showAuthBtn?.classList.add("hidden");
    authContainer?.classList.add("hidden");

    if (userMoney) {
      userMoney.classList.remove("hidden");
      userMoney.innerText = getCurrentMoneyLabel();
    }

    if (gmBadge) {
      gmBadge.textContent = roleText;
      gmBadge.title = "Роль берётся из аккаунта";
      gmBadge.style.cursor = "default";
      gmBadge.dataset.mode = "account";
    }
  } else {
    guestWarning?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    showAuthBtn?.classList.remove("hidden");
    authContainer?.classList.add("hidden");

    if (userMoney) {
      userMoney.classList.remove("hidden");
      userMoney.innerText = getCurrentMoneyLabel();
    }

    if (gmBadge) {
      gmBadge.textContent = roleText;
      gmBadge.title = "Клик для переключения Игрок / ГМ";
      gmBadge.style.cursor = "pointer";
      gmBadge.dataset.mode = "guest-switch";
    }
  }

  syncMoneyControls();
  syncGlobalStateBridges();
}

function updateCartCounter() {
  const count = Array.isArray(STATE.cart)
    ? STATE.cart.reduce((sum, item) => sum + safeNumber(item.quantity, 1), 0)
    : 0;

  if (getEl("cartCount")) getEl("cartCount").innerText = String(count);
  if (getEl("cartCountModal")) getEl("cartCountModal").innerText = String(count);
}

function updateInventoryCounter() {
  const count = Array.isArray(STATE.inventory)
    ? STATE.inventory.reduce((sum, item) => sum + safeNumber(item.quantity, 0), 0)
    : 0;

  if (getEl("inventoryCount")) getEl("inventoryCount").innerText = String(count);
  if (getEl("inventoryCountModal")) getEl("inventoryCountModal").innerText = String(count);
}

function updateCartTotalLabels() {
  const label = formatMoneyCp(getCartTotalCp());

  if (getEl("cart-total")) getEl("cart-total").innerText = label;
  if (getEl("cartTotalModal")) getEl("cartTotalModal").innerText = label;
}

function renderAllLocalState() {
  syncGlobalStateBridges();
  renderCart(STATE.cart);
  renderInventory(STATE.inventory);
  updateCartCounter();
  updateCartTotalLabels();
  updateInventoryCounter();
  updateUserUI();
}

function applyExternalUserUpdate(user) {
  if (!user || typeof user !== "object") return;
  STATE.user = {
    ...(STATE.user && typeof STATE.user === "object" ? STATE.user : {}),
    ...user,
  };
  persistUser();
  syncGlobalStateBridges();
  updateUserUI();
}

// ------------------------------------------------------------
// 🔎 FILTERS
// ------------------------------------------------------------
function rerenderTraders() {
  const filters = collectFilters(getEl, safeNumber);
  const filtered = sortTraders(
    STATE.traders.filter((trader) => traderMatchesFilters(trader, filters, safeNumber)),
    filters.sortValue,
    safeNumber
  );
  syncGlobalStateBridges();
  renderTraders(filtered);
}

// ------------------------------------------------------------
// 📥 LOADERS
// ------------------------------------------------------------
async function loadTraders() {
  const data = await fetchTraders();
  STATE.traders = normalizeApiList(data, "traders").map((trader) => normalizeTrader(trader));
  populateFilterOptions(STATE.traders, getEl);
  syncGlobalStateBridges();
  rerenderTraders();
}

async function loadInventoryFromServer() {
  if (!STATE.token) return;

  try {
    const data = await fetchPlayerInventory();
    STATE.inventory = normalizeApiList(data, "items").map((item) => normalizeInventoryItem(item));
    updateUserMoneyFromPayload(data);
    syncGlobalStateBridges();
  } catch (error) {
    console.warn("Не удалось загрузить inventory из API:", error);
  }
}

// ------------------------------------------------------------
// 🔐 AUTH
// ------------------------------------------------------------
async function fetchMeSafe() {
  try {
    return await fetchMe();
  } catch {
    return null;
  }
}

async function handleLogin() {
  const email = String(getEl("loginEmail")?.value || "").trim();
  const password = String(getEl("loginPassword")?.value || "");

  if (!email || !password) {
    showToast("Введите email и пароль");
    return;
  }

  try {
    setBusy(true);

    const payload = await loginUser(email, password);
    STATE.token = localStorage.getItem("token") || "";

    const me = (await fetchMeSafe()) || payload?.user || payload?.me || null;
    STATE.user = me && typeof me === "object" ? me : { email };

    if (STATE.user.money_cp_total === undefined && STATE.user.money_label === undefined) {
      const fallbackMoney = normalizeMoneyFromPayload(payload);
      if (fallbackMoney) {
        STATE.user.money_cp_total = fallbackMoney.cp;
        STATE.user.money_label = fallbackMoney.label;
      }
    }

    persistUser();
    syncGlobalStateBridges();
    updateUserUI();

    await loadTraders();
    await loadInventoryFromServer();
    renderAllLocalState();

    emitAppHistoryEvent({
      scope: "auth",
      type: "login",
      action: "login",
      title: "Вход в аккаунт",
      message: `Пользователь вошёл: ${STATE.user?.email || email}`,
      status: getEffectiveRole(),
    });

    showToast("Вход выполнен");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Ошибка входа");
  } finally {
    setBusy(false);
  }
}

async function handleRegister() {
  const email = String(getEl("loginEmail")?.value || "").trim();
  const password = String(getEl("loginPassword")?.value || "");

  if (!email || !password) {
    showToast("Введите email и пароль");
    return;
  }

  try {
    setBusy(true);
    await registerUser(email, password);

    emitAppHistoryEvent({
      scope: "auth",
      type: "register",
      action: "register",
      title: "Регистрация аккаунта",
      message: `Зарегистрирован аккаунт: ${email}`,
      actor: email,
    });

    showToast("Регистрация успешна. Теперь войдите.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Ошибка регистрации");
  } finally {
    setBusy(false);
  }
}

function handleLogout() {
  const previousUser = STATE.user || window.__appUser || {};
  const previousActor =
    previousUser?.nickname ||
    previousUser?.display_name ||
    previousUser?.username ||
    previousUser?.email ||
    "Игрок";

  emitAppHistoryEvent({
    scope: "auth",
    type: "logout",
    action: "logout",
    title: "Выход из аккаунта",
    message: `Пользователь вышел: ${previousActor}`,
    actor: previousActor,
  });

  STATE.token = "";
  STATE.user = null;
  STATE.inventory = [];
  STATE.cart = [];
  STATE.reserved = [];

  logoutUser();
  clearPersistedUser();

  syncGlobalStateBridges();
  updateUserUI();
  renderAllLocalState();
  showToast("Вы вышли");
}

let authInvalidNoticeShown = false;

function handleInvalidAuthSession(event) {
  STATE.token = "";
  STATE.user = null;
  STATE.inventory = [];
  STATE.cart = [];
  STATE.reserved = [];

  clearPersistedUser();
  syncGlobalStateBridges();
  updateUserUI();
  renderAllLocalState();

  const message = event?.detail?.message || "Сессия истекла. Войдите заново.";

  emitAppHistoryEvent({
    scope: "auth",
    type: "session_invalid",
    action: "session_invalid",
    title: "Сессия завершена",
    message,
    actor: "Система",
  });

  if (!authInvalidNoticeShown) {
    authInvalidNoticeShown = true;
    showToast(message);
    window.setTimeout(() => {
      authInvalidNoticeShown = false;
    }, 3500);
  }
}

window.addEventListener("dnd:auth:invalid", handleInvalidAuthSession);

// ------------------------------------------------------------
// 🧾 CABINET
// ------------------------------------------------------------
let cabinetModulesInitialized = false;

async function initCabinetModulesIfNeeded() {
  syncGlobalStateBridges();

  if (!cabinetModulesInitialized) {
    initCabinet();
    cabinetModulesInitialized = true;
  }

  try {
    await Promise.allSettled([
      typeof questsModule?.loadQuests === "function"
        ? questsModule.loadQuests()
        : Promise.resolve(),
      typeof playerNotesModule?.loadPlayerNotes === "function"
        ? playerNotesModule.loadPlayerNotes()
        : Promise.resolve(),
    ]);
  } catch (_) {}
}

// ------------------------------------------------------------
// 🎭 TEMP ROLE SWITCH
// ------------------------------------------------------------
async function toggleGuestRole() {
  if (!isGuestMode()) {
    showToast("После авторизации роль берётся из аккаунта");
    return;
  }

  STATE.guestRole = STATE.guestRole === "gm" ? "player" : "gm";
  persistGuestRole();

  syncGlobalStateBridges();
  updateUserUI();
  rerenderTraders();

  const cabinetModal = getEl("cabinetModal");
  if (cabinetModal && cabinetModal.style.display === "block") {
    await initCabinetModulesIfNeeded();
    openCabinet();
  }

  showToast(STATE.guestRole === "gm" ? "Режим ГМа включён" : "Режим игрока включён");
}

function bindRoleSwitchButton() {
  const gmBadge = getEl("gmBadge");
  if (!gmBadge || gmBadge.dataset.boundRoleSwitch === "1") return;

  gmBadge.dataset.boundRoleSwitch = "1";
  gmBadge.addEventListener("click", async () => {
    await toggleGuestRole();
  });
}

// ------------------------------------------------------------
// 🔘 BINDINGS
// ------------------------------------------------------------

// ------------------------------------------------------------
// 🛒 GLOBAL ACTIONS
// ------------------------------------------------------------
// Маршрут открытия модалки торговца:
// 1) фиксируем activeTraderId
// 2) если есть токен — подтягиваем свежие данные с сервера
// 3) рендерим модалку
// 4) восстанавливаем UI-предпочтения (вкладки/вид)
window.openTraderModal = createOpenTraderModalAction({
  state: STATE,
  refreshTraderById,
  syncGlobalStateBridges,
  renderOpenTraderModal,
  restoreTraderModalUiPrefs,
});

window.openTrader = window.openTraderModal;

window.restockTrader = createRestockTraderAction({
  state: STATE,
  showToast,
  getEffectiveRole,
  getTraderById,
  safeNumber,
  handleGuestRestockFlow,
  handleServerRestockFlow,
  apiRestockTrader,
  upsertTrader,
  refreshTraderById,
  syncBusyUiState,
  renderAllLocalState,
  openTraderModal: window.openTraderModal,
});

Object.assign(
  window,
  createInventoryActions({
    state: STATE,
    safeNumber,
    showToast,
    syncGlobalStateBridges,
    renderAllLocalState,
    renderCart,
    getTraderItem,
    normalizeCollectionItem,
  })
);

// ------------------------------------------------------------
// 💸 BUY / SELL
// ------------------------------------------------------------
Object.assign(
  window,
  createTradeActions({
    state: STATE,
    safeNumber,
    moneyPartsToCp,
    formatMoneyCp,
    getCurrentMoneyCp,
    getCurrentMoneyLabel,
    getTraderById,
    getTraderItem,
    getTraderMoneyCp,
    setTraderMoneyCp,
    findInventoryIndexByItemId,
    findInventoryItemById,
    getSellTotalCp,
    normalizeInventoryItem,
    ensureGuestSellPrices,
    persistGuestMoney,
    apiBuyItem,
    apiSellItem,
    updateUserMoneyFromPayload,
    patchTraderFromTradePayload,
    loadInventoryFromServer,
    refreshTraderById,
    getTraderMoneyFromTradePayload,
    setBusy,
    renderAllLocalState,
    rerenderTraders,
    syncOpenTraderModalIfVisible,
    showToast,
    logTradeSnapshot,
    syncGlobalStateBridges,
    findCartItemByTraderAndItemId,
    consumeCollectionEntry,
    getCartTotalUnits,
  })
);

installTraderDialogueActionWrappers();

// ------------------------------------------------------------
// 🚀 INIT
// ------------------------------------------------------------
async function initApp() {
  setAppLoadingStatus("Поднимаем интерфейс...");

  try {
    STATE.token = localStorage.getItem("token") || "";
    STATE.user = STATE.token ? restoreUserFromLocalStorage() : null;

    if (!STATE.token && STATE.user) {
      STATE.user = null;
      clearPersistedUser();
    }

    syncGlobalStateBridges();
    updateUserUI();

    bindToolbarButtons({
      getEl,
      state: STATE,
      renderCart,
      updateCartCounter,
      updateCartTotalLabels,
      openModal,
      syncGlobalStateBridges,
      renderAllLocalState,
      showToast,
      renderInventory,
      updateInventoryCounter,
      initCabinetModulesIfNeeded,
      openCabinet,
      loadTraders,
      loadInventoryFromServer,
    });
    bindAuthButtons({ getEl, handleLogout, handleLogin, handleRegister });
    bindModalButtons(closeModal);
    bindFilterEvents(getEl, rerenderTraders);
    bindTraderDelegation({
      openTraderModal: window.openTraderModal,
      restockTrader: window.restockTrader,
    });
    bindMoneyControls({
      getEl,
      applyGuestMoneyUpdateFromInput,
      resetGuestMoney,
      syncMoneyControls,
    });
    bindRoleSwitchButton();
    bindTraderModalUiPersistence();

    window.addEventListener("dnd:user:updated", (event) => {
      applyExternalUserUpdate(event?.detail?.user);
    });

    if (STATE.token) {
      setAppLoadingStatus("Проверяем профиль...");
      const me = await fetchMeSafe();
      if (me && typeof me === "object") {
        STATE.user = me;
        persistUser();
        syncGlobalStateBridges();
        updateUserUI();
      } else {
        STATE.token = "";
        STATE.user = null;
        logoutUser();
        clearPersistedUser();
        syncGlobalStateBridges();
        updateUserUI();
      }
    }

    try {
      setAppLoadingStatus("Загружаем торговцев...");
      await loadTraders();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Не удалось загрузить торговцев");
    }

    if (STATE.token) {
      setAppLoadingStatus("Синхронизируем инвентарь...");
      await loadInventoryFromServer();
    }

    setAppLoadingStatus("Готовим интерфейс...");
    renderAllLocalState();
  } finally {
    renderAllLocalState();
    hideAppLoadingOverlay();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
