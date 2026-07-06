// ============================================================
// frontend/js/render.js
// Рендер фронта под RPG-визуал:
// - большие квадратные карточки торговцев
// - без кнопки "Открыть"
// - названия предметов окрашиваются по редкости
// - компактнее модалки и фильтры
// - без лишнего крестика в модалке торговца
// - скидка / репутация / эмодзи в нужных местах
// - совместим со старым index.html и текущим app.js
// ============================================================

function safe(value, fallback = "") {
  return value === null || value === undefined ? fallback : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getEl(id) {
  return document.getElementById(id);
}

function getFirstEl(...ids) {
  for (const id of ids) {
    const el = getEl(id);
    if (el) return el;
  }
  return null;
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}

function normalizeTraderIdForMarkup(traderId) {
  const id = Number(traderId);
  return Number.isFinite(id) ? id : 0;
}

function buildRestockButtonsMarkup(traderId) {
  const normalizedId = normalizeTraderIdForMarkup(traderId);
  return `
    <div class="trader-restock-actions">
      <button
        class="btn btn-primary js-restock-trader"
        data-trader-id="${normalizedId}"
        data-reroll="0"
      >🔄 Обновить ассортимент</button>
      <button
        class="btn btn-warning js-restock-trader"
        data-trader-id="${normalizedId}"
        data-reroll="1"
      >🎲 Реролл ассортимента</button>
    </div>
  `;
}

// ------------------------------------------------------------
// 🌐 STATE BRIDGES
// ------------------------------------------------------------
function getTradersState() {
  return Array.isArray(window.__appStateTraders) ? window.__appStateTraders : [];
}

function getInventoryState() {
  return Array.isArray(window.__appStateInventory) ? window.__appStateInventory : [];
}

function getReservedState() {
  if (typeof window.getReservedItems === "function") {
    const items = window.getReservedItems();
    return Array.isArray(items) ? items : [];
  }
  return Array.isArray(window.__appStateReserved) ? window.__appStateReserved : [];
}

function getTraderById(traderId) {
  return (
    getTradersState().find((trader) => Number(trader?.id) === Number(traderId)) ||
    null
  );
}


function getTraderNavigationList() {
  const filtered = Array.isArray(window.__appFilteredTraders) ? window.__appFilteredTraders : [];
  const source = filtered.length ? filtered : getTradersState();
  const seen = new Set();
  return (Array.isArray(source) ? source : [])
    .filter((trader) => trader && Number.isFinite(Number(trader.id)))
    .filter((trader) => {
      const key = Number(trader.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTraderNavigationState(traderId) {
  const list = getTraderNavigationList();
  const currentId = Number(traderId);
  const index = list.findIndex((trader) => Number(trader.id) === currentId);

  if (!list.length || index < 0) {
    return { list, index: -1, prev: null, next: null, label: "—" };
  }

  const prev = list[(index - 1 + list.length) % list.length] || null;
  const next = list[(index + 1) % list.length] || null;

  return {
    list,
    index,
    prev,
    next,
    label: `${index + 1} / ${list.length}`,
  };
}

function closeTraderModal(modal = getEl("traderModal")) {
  if (!modal) return;
  modal.style.display = "none";
  document.body.classList.remove("trader-modal-open");
  modal.querySelectorAll(":scope > .trader-modal-scroll-controls").forEach((node) => node.remove());
  modal.classList.remove("trader-modal-refined", "trader-modal-round31", "trader-modal-round32", "trader-modal-round45", "trader-modal-round63", "trader-modal-round64", "trader-modal-round65", "trader-modal-round66", "trader-modal-round67", "trader-modal-round68", "trader-modal-round71", "trader-modal-round72", "trader-modal-round73", "trader-modal-round82", "trader-modal-round83");
}

function buildTraderModalChrome(trader) {
  const nav = getTraderNavigationState(trader?.id);
  const hasNav = nav.list.length > 1;
  const prevId = nav.prev?.id ?? "";
  const nextId = nav.next?.id ?? "";

  return `
    <div class="trader-modal-chrome trader-modal-chrome-unified" role="navigation" aria-label="Навигация торговца">
      <div class="trader-modal-nav-left">
        <button
          class="trader-modal-nav-btn trader-modal-nav-prev"
          type="button"
          data-trader-nav="prev"
          data-trader-id="${escapeHtml(prevId)}"
          ${hasNav ? "" : "disabled"}
          aria-label="Предыдущий торговец"
        >‹</button>
      </div>

      <div class="trader-modal-nav-right">
        <button
          class="trader-modal-nav-btn trader-modal-nav-next"
          type="button"
          data-trader-nav="next"
          data-trader-id="${escapeHtml(nextId)}"
          ${hasNav ? "" : "disabled"}
          aria-label="Следующий торговец"
        >›</button>

        <button class="trader-modal-close-btn" type="button" data-trader-modal-close="1" aria-label="Закрыть торговца">×</button>
      </div>
    </div>
  `;
}


function buildTraderModalScrollControls() {
  return `
    <div class="trader-modal-scroll-controls trader-modal-scroll-controls-bottom" aria-label="Прокрутка модалки торговца">
      <button type="button" data-trader-scroll="top" title="Наверх" aria-label="Наверх">↑</button>
      <button type="button" data-trader-scroll="bottom" title="Вниз" aria-label="Вниз">↓</button>
    </div>
  `;
}

function getTraderModalScrollContainer(modal = getEl("traderModal")) {
  const content = getTraderModalContent();
  const shell = modal?.querySelector?.(".modal-content") || null;

  // Round 82: в текущей разметке #modalContent — реальная область с содержимым
  // торговца. Раньше стрелки пытались скроллить .modal-content, а сам контент
  // мог быть зажат overflow-правилами CSS. Поэтому сначала используем
  // #modalContent, а shell оставляем fallback для старой схемы.
  return content || shell;
}

function scrollTraderModalViewport(direction = "top", modal = getEl("traderModal")) {
  const scrollHost = getTraderModalScrollContainer(modal);
  if (!scrollHost) return;

  if (direction === "bottom") {
    scrollHost.scrollTo({ top: scrollHost.scrollHeight, behavior: "smooth" });
    return;
  }

  scrollHost.scrollTo({ top: 0, behavior: "smooth" });
}

function buildTraderPageScrollControls() {
  return `
    <div class="traders-page-scroll-controls" aria-label="Прокрутка страницы торговцев">
      <button type="button" data-trader-page-scroll="top" title="Наверх" aria-label="Наверх">↑</button>
      <button type="button" data-trader-page-scroll="bottom" title="Вниз" aria-label="Вниз">↓</button>
    </div>
  `;
}

function setTraderFloatingControlsVisible(controls, visible = true) {
  if (!controls) return;
  controls.classList.toggle("is-visible", Boolean(visible));
  controls.classList.toggle("is-idle-visible", Boolean(visible));
}

function getTraderPageScrollMax() {
  return Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
    document.body.scrollHeight - window.innerHeight
  );
}

function updateTraderPageScrollControlsVisibility() {
  const controls = document.querySelector(".traders-page-scroll-controls");
  if (!controls) return;
  const canScroll = getTraderPageScrollMax() > 80;
  controls.hidden = !canScroll;
  if (!canScroll) setTraderFloatingControlsVisible(controls, false);
}

function ensureTraderPageScrollControls() {
  const controls = document.querySelector(".traders-page-scroll-controls");
  if (!controls) return;

  updateTraderPageScrollControlsVisibility();

  if (!window.__traderPageScrollControlsBound) {
    window.__traderPageScrollControlsBound = true;

    document.addEventListener("click", (event) => {
      const scrollBtn = event.target.closest?.("[data-trader-page-scroll]");
      if (!scrollBtn) return;

      const direction = String(scrollBtn.dataset.traderPageScroll || "top");
      const targetTop = direction === "bottom" ? getTraderPageScrollMax() : 0;

      setTraderFloatingControlsVisible(document.querySelector(".traders-page-scroll-controls"), true);
      window.scrollTo({ top: targetTop, behavior: "smooth" });
    });

    window.addEventListener(
      "scroll",
      () => {
        const nav = document.querySelector(".traders-page-scroll-controls");
        if (!nav) return;
        updateTraderPageScrollControlsVisibility();
        window.clearTimeout(window.__traderPageFloatingTimer);
        window.clearTimeout(window.__traderPageFloatingHideTimer);
        nav.classList.add("is-scrolling");
        setTraderFloatingControlsVisible(nav, false);
        window.__traderPageFloatingTimer = window.setTimeout(() => {
          nav.classList.remove("is-scrolling");
          setTraderFloatingControlsVisible(nav, true);
          window.__traderPageFloatingHideTimer = window.setTimeout(() => {
            setTraderFloatingControlsVisible(nav, false);
          }, 2600);
        }, 420);
      },
      { passive: true }
    );

    window.addEventListener("resize", updateTraderPageScrollControlsVisibility, { passive: true });
  }
}

function ensureTraderModalScrollControls(modal = getEl("traderModal")) {
  if (!modal) return;
  const scroller = getTraderModalScrollContainer(modal);
  if (!scroller) return;

  const getControls = () =>
    modal.querySelector(":scope > .trader-modal-scroll-controls") ||
    modal.querySelector(".trader-modal-scroll-controls");

  const update = () => {
    const controls = getControls();
    if (!controls) return false;

    const canScroll = (scroller.scrollHeight - scroller.clientHeight) > 80;
    controls.hidden = !canScroll;
    if (!canScroll) {
      setTraderFloatingControlsVisible(controls, false);
      return false;
    }
    return true;
  };

  const canScrollOnOpen = update();
  const initialControls = getControls();
  if (canScrollOnOpen && initialControls && initialControls.dataset.initialHintShown !== "1") {
    initialControls.dataset.initialHintShown = "1";
    setTraderFloatingControlsVisible(initialControls, true);
    window.clearTimeout(window.__traderModalFloatingHideTimer);
    window.__traderModalFloatingHideTimer = window.setTimeout(() => {
      setTraderFloatingControlsVisible(getControls(), false);
    }, 2400);
  }

  if (scroller.dataset.boundTraderModalFloatingScroll === "1") {
    window.setTimeout(update, 80);
    return;
  }
  scroller.dataset.boundTraderModalFloatingScroll = "1";

  scroller.addEventListener(
    "scroll",
    () => {
      update();
      const controls = getControls();
      if (!controls) return;

      window.clearTimeout(window.__traderModalFloatingTimer);
      window.clearTimeout(window.__traderModalFloatingHideTimer);
      controls.classList.add("is-scrolling");
      setTraderFloatingControlsVisible(controls, false);
      window.__traderModalFloatingTimer = window.setTimeout(() => {
        const currentControls = getControls();
        if (!currentControls) return;
        currentControls.classList.remove("is-scrolling");
        setTraderFloatingControlsVisible(currentControls, true);
        window.__traderModalFloatingHideTimer = window.setTimeout(() => {
          setTraderFloatingControlsVisible(getControls(), false);
        }, 2600);
      }, 420);
    },
    { passive: true }
  );

  window.setTimeout(update, 80);
}

function ensureTraderModalDocumentNavigation() {
  if (window.__traderModalDocumentNavigationBound) return;
  window.__traderModalDocumentNavigationBound = true;

  document.addEventListener("click", async (event) => {
    const closeBtn = event.target.closest?.("[data-trader-modal-close]");
    if (closeBtn) {
      const modal = closeBtn.closest?.("#traderModal") || getEl("traderModal");
      event.preventDefault();
      event.stopPropagation();
      closeTraderModal(modal);
      return;
    }

    const navBtn = event.target.closest?.("[data-trader-nav]");
    if (!navBtn) return;

    const modal = navBtn.closest?.("#traderModal") || getEl("traderModal");
    if (!modal || navBtn.disabled) return;

    event.preventDefault();
    event.stopPropagation();

    const targetTraderId = Number(navBtn.dataset.traderId || 0);
    if (!Number.isFinite(targetTraderId) || targetTraderId <= 0) {
      showToast("Следующий торговец не найден");
      return;
    }

    if (typeof window.openTraderModal === "function") {
      await window.openTraderModal(targetTraderId);
      return;
    }

    showToast("Навигация торговцев ещё не подключена");
  }, true);
}

function getTraderModalContent() {
  return getFirstEl("traderModalContent", "modalContent");
}

function getTradersContainer() {
  return getFirstEl(
    "traders-container",
    "tradersGrid",
    "tradersContainer",
    "traderGrid"
  );
}

function getCartContainer() {
  return getFirstEl(
    "cart-container",
    "cartItemsContainer",
    "cartItems",
    "cartContent",
    "cartList"
  );
}

function getInventoryContainer() {
  return getFirstEl(
    "inventory-container",
    "inventoryItemsContainer",
    "inventoryItems",
    "inventoryContent",
    "inventoryList"
  );
}

function getActiveTraderFromModal(modal) {
  const traderId = Number(modal?.dataset?.traderId);
  return Number.isFinite(traderId) ? getTraderById(traderId) : null;
}

// ------------------------------------------------------------
// 💰 MONEY
// ------------------------------------------------------------
function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (Number(gold || 0)) parts.push(`${Number(gold)}з`);
  if (Number(silver || 0)) parts.push(`${Number(silver)}с`);
  if (Number(copper || 0)) parts.push(`${Number(copper)}м`);
  return parts.length ? parts.join(" ") : "0з";
}

function formatBuyPrice(item) {
  if (item?.buy_price_label) return item.buy_price_label;
  if (item?.price_label) return item.price_label;

  return formatMoneyParts(
    Number(item?.buy_price_gold ?? item?.price_gold ?? 0),
    Number(item?.buy_price_silver ?? item?.price_silver ?? 0),
    Number(item?.buy_price_copper ?? item?.price_copper ?? 0)
  );
}

function formatSellPrice(item) {
  if (item?.sell_price_label) return item.sell_price_label;

  const result = formatMoneyParts(
    Number(item?.sell_price_gold ?? 0),
    Number(item?.sell_price_silver ?? 0),
    Number(item?.sell_price_copper ?? 0)
  );

  return result === "0з" ? "—" : result;
}

// ------------------------------------------------------------
// 🧿 LOOKUPS / NORMALIZERS
// ------------------------------------------------------------
function normalizeRarity(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Обычный";

  const map = {
    common: "Обычный",
    uncommon: "Необычный",
    rare: "Редкий",
    "very rare": "Очень редкий",
    very_rare: "Очень редкий",
    veryrare: "Очень редкий",
    epic: "Эпический",
    legendary: "Легендарный",
    artifact: "Артефакт",
    unique: "Уникальный",
    уникальный: "Уникальный",
    trash: "Мусор",
    junk: "Мусор",
    мусор: "Мусор",
    обычный: "Обычный",
    необычный: "Необычный",
    редкий: "Редкий",
    "очень редкий": "Очень редкий",
    эпический: "Эпический",
    легендарный: "Легендарный",
    артефакт: "Артефакт",
  };

  return map[raw] || value || "Обычный";
}

function rarityClass(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (raw === "trash" || raw === "junk" || raw === "мусор") return "rarity-trash";
  if (raw === "common" || raw === "обычный") return "rarity-common";
  if (raw === "uncommon" || raw === "необычный") return "rarity-uncommon";
  if (raw === "rare" || raw === "редкий") return "rarity-rare";
  if (raw === "veryrare" || raw === "оченьредкий") return "rarity-veryrare";
  if (raw === "epic" || raw === "эпический") return "rarity-epic";
  if (raw === "legendary" || raw === "легендарный") return "rarity-legendary";
  if (raw === "artifact" || raw === "артефакт" || raw === "unique" || raw === "уникальный") return "rarity-artifact";
  return "rarity-common";
}

function rarityColor(value) {
  const cls = rarityClass(value);
  if (cls === "rarity-trash") return "#98a2ad";
  if (cls === "rarity-common") return "#e6dfd0";
  if (cls === "rarity-uncommon") return "#7fdc8a";
  if (cls === "rarity-rare") return "#6fb4ff";
  if (cls === "rarity-veryrare" || cls === "rarity-epic") return "#bb8cff";
  if (cls === "rarity-legendary") return "#e0a545";
  if (cls === "rarity-artifact") return "#ff6b6b";
  return "#e6dfd0";
}

function rarityTextStyle(value, extra = "") {
  const color = rarityColor(value);
  return `style="color:${color};${extra}"`;
}

function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Стандартное";
  if (raw === "standard") return "Стандартное";
  if (raw === "poor") return "Плохое";
  if (raw === "fine") return "Хорошее";
  if (raw === "excellent") return "Отличное";
  if (raw === "masterwork") return "Мастерское";
  return value || "Стандартное";
}

function normalizeImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/static/images/")) return raw;
  if (raw.startsWith("/static/")) {
    const file = raw.split("/").pop();
    return `/static/images/${file}`;
  }
  if (raw.startsWith("static/images/")) return `/${raw}`;
  if (raw.startsWith("static/")) {
    const file = raw.split("/").pop();
    return `/static/images/${file}`;
  }
  return `/static/images/${raw.replace(/^\/+/, "")}`;
}

function getTraderImageUrl(trader) {
  const raw = String(
    trader?.image_url ||
      trader?.image ||
      trader?.portrait ||
      trader?.avatar ||
      ""
  ).trim();

  return normalizeImageUrl(raw);
}

function getReputationStars(reputation) {
  const rep = Math.max(0, Math.min(5, Number(reputation || 0)));
  return "★".repeat(rep) + "☆".repeat(5 - rep);
}

function getTraderQuality(reputation) {
  const rep = Number(reputation || 0);
  if (rep < 10) return "Незнакомец";
  if (rep < 25) return "Заметил тебя";
  if (rep < 45) return "Знакомый";
  if (rep < 65) return "Уважаемый клиент";
  if (rep < 85) return "Надёжный партнёр";
  return "Любимец торговца";
}

function getTraderDiscountPercent(reputation) {
  const rep = Math.max(0, Math.min(100, Number(reputation || 0)));
  const ratio = rep / 100;
  const buyMultiplier = 1 - ((1 - 0.6667) * ratio);
  return Math.max(0, Math.round((1 - buyMultiplier) * 100));
}

function getTraderLevelLabel(level) {
  const numericLevel = Math.max(1, Math.min(6, Number(level || 1)));
  if (numericLevel === 1) return "Новичок";
  if (numericLevel === 2) return "Подмастерье";
  if (numericLevel === 3) return "Опытный";
  if (numericLevel === 4) return "Профессионал";
  if (numericLevel === 5) return "Мастер";
  return "Легендарный поставщик";
}

function getTraderSellBonusPercent(reputation) {
  const rep = Math.max(0, Math.min(100, Number(reputation || 0)));
  const ratio = rep / 100;
  const sellMultiplier = 0.5 + (0.3 * ratio);
  return Math.max(0, Math.round((sellMultiplier - 0.5) * 100));
}

function getTraderReputationTone(reputation) {
  const rep = Math.max(0, Math.min(100, Number(reputation || 0)));
  if (rep < 25) return "low";
  if (rep < 65) return "mid";
  return "high";
}

function getTraderRelationshipLabel(trader) {
  return (
    trader?.relationship_label ||
    trader?.relation_label ||
    getTraderQuality(trader?.reputation)
  );
}

function getTraderRelationshipProgress(trader) {
  const current = Number.isFinite(Number(trader?.relationship_progress))
    ? Number(trader.relationship_progress)
    : Math.max(0, Math.min(100, Number(trader?.reputation ?? 0) || 0));
  const max = Number.isFinite(Number(trader?.relationship_progress_max))
    ? Math.max(1, Number(trader.relationship_progress_max))
    : 100;
  const percent = Number.isFinite(Number(trader?.relationship_progress_percent))
    ? Math.max(0, Math.min(100, Number(trader.relationship_progress_percent)))
    : Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  const toNext = Number.isFinite(Number(trader?.relationship_to_next))
    ? Math.max(0, Number(trader.relationship_to_next))
    : Math.max(0, max - current);

  return { current, max, percent, toNext };
}

function getTraderRelationshipTone(trader) {
  const tone = String(trader?.relationship_tone || "").trim();
  if (tone) return tone;
  return getTraderReputationTone(trader?.reputation);
}

function getTraderDiscountDisplay(trader) {
  if (Number.isFinite(Number(trader?.discount_percent))) {
    return Math.max(0, Number(trader.discount_percent));
  }
  return getTraderDiscountPercent(trader?.reputation);
}

function getTraderEmoji(type) {
  const raw = String(type || "").trim().toLowerCase();

  if (raw.includes("алх")) return "⚗️";
  if (raw.includes("книг")) return "📚";
  if (raw.includes("оруж")) return "🗡️";
  if (raw.includes("куз")) return "⚒️";
  if (raw.includes("кож")) return "🧥";
  if (raw.includes("пек")) return "🥖";
  if (raw.includes("мяс")) return "🥩";
  if (raw.includes("друид")) return "🌿";
  if (raw.includes("цирю")) return "✂️";
  if (raw.includes("тракт")) return "🍺";
  if (raw.includes("худож")) return "🎨";
  if (raw.includes("торгов")) return "🧳";
  return "🏪";
}

function getItemEmoji(item) {
  const category = String(item?.category_clean || item?.category || "").toLowerCase();
  const props = parseJsonObject(item?.properties);

  if (category.includes("weapon")) return "🗡️";
  if (category.includes("armor")) return "🛡️";
  if (category.includes("alchemy")) return "⚗️";
  if (category.includes("potion")) return "🧪";
  if (category.includes("food")) return "🍖";
  if (category.includes("drink")) return "🍷";
  if (category.includes("tool")) return "🧰";
  if (category.includes("scroll")) return "📜";
  if (category.includes("book")) return "📘";
  if (category.includes("accessory")) return "💍";
  if (props.damage) return "⚔️";
  if (props.healing) return "✨";
  if (item?.is_magical) return "🔮";
  return "📦";
}

function getRegionEmoji() {
  return "🌍";
}

function getSettlementEmoji() {
  return "🏘️";
}

function getItemId(item) {
  return Number(item?.item_id ?? item?.id ?? 0);
}

function getItemTraderId(item, fallback = null) {
  if (fallback !== null && fallback !== undefined && fallback !== "") {
    const explicit = Number(fallback);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }

  const candidates = [
    item?.trader_id,
    item?.owner_trader_id,
    item?.merchant_id,
    item?.traderId,
  ];

  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isFinite(id) && id > 0) return id;
  }

  return null;
}

function getTraderStock(item) {
  return Math.max(0, Number(item?.stock ?? item?.quantity ?? 0));
}

function getOwnedQuantity(item) {
  return Math.max(0, Number(item?.quantity ?? 0));
}

function getItemPriceNumeric(item, context = "trader") {
  if (context === "inventory") {
    return (
      Number(item?.sell_price_gold || 0) +
      Number(item?.sell_price_silver || 0) / 100 +
      Number(item?.sell_price_copper || 0) / 10000
    );
  }

  return (
    Number(item?.buy_price_gold ?? item?.price_gold ?? 0) +
    Number(item?.buy_price_silver ?? item?.price_silver ?? 0) / 100 +
    Number(item?.buy_price_copper ?? item?.price_copper ?? 0) / 10000
  );
}

function getItemCharacteristics(item) {
  const props = parseJsonObject(item?.properties);
  const parts = [];

  if (props.damage) parts.push(`Урон: ${props.damage}`);
  if (props.damage_type) parts.push(`Тип: ${props.damage_type}`);
  if (props.ac) parts.push(`КД: ${props.ac}`);
  if (props.range) parts.push(`Дистанция: ${props.range}`);
  if (props.healing) parts.push(`Лечение: ${props.healing}`);
  if (props.special_properties) parts.push(`Свойства: ${props.special_properties}`);
  if (item?.weight) parts.push(`Вес: ${item.weight}`);
  if (item?.slot) parts.push(`Слот: ${item.slot}`);
  if (item?.is_magical) parts.push("Магический");
  if (item?.attunement) parts.push("Требует настройки");

  return parts.length ? parts.join(" • ") : "—";
}

function getItemShortDescription(item, maxLength = 110) {
  const text = String(
    item?.description || item?.rules_text || item?.effect || ""
  ).trim();

  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function getItemFullDescription(item) {
  const props = parseJsonObject(item?.properties);
  const requirements = parseJsonObject(item?.requirements);
  const lines = [];

  if (item?.description) lines.push(String(item.description));
  if (item?.description_ru && item.description_ru !== item?.description) {
    lines.push(String(item.description_ru));
  }
  if (item?.lore) lines.push(`Лор: ${item.lore}`);
  if (item?.effect) lines.push(`Эффект: ${item.effect}`);
  if (item?.rules_text) lines.push(`Правила: ${item.rules_text}`);
  if (props.damage) lines.push(`Урон: ${props.damage}`);
  if (props.damage_type) lines.push(`Тип урона: ${props.damage_type}`);
  if (props.ac) lines.push(`КД: ${props.ac}`);
  if (props.range) lines.push(`Дистанция: ${props.range}`);
  if (props.healing) lines.push(`Лечение: ${props.healing}`);
  if (props.special_properties) lines.push(`Свойства: ${props.special_properties}`);

  const reqKeys = Object.keys(requirements || {});
  if (reqKeys.length) {
    lines.push(
      `Требования: ${reqKeys.map((k) => `${k}: ${requirements[k]}`).join(", ")}`
    );
  }

  if (!lines.length) {
    lines.push("Подробное описание пока отсутствует.");
  }

  return lines.join("\n\n");
}

// ------------------------------------------------------------
// 📖 DESCRIPTION MODAL
// ------------------------------------------------------------
function ensureDescriptionModal() {
  let modal = getEl("itemDescriptionModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "itemDescriptionModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content">
        <span class="close">&times;</span>
        <div id="itemDescriptionContent"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const close = modal.querySelector(".close");
  if (close && !close.dataset.boundClose) {
    close.dataset.boundClose = "1";
    close.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (!modal.dataset.boundOverlay) {
    modal.dataset.boundOverlay = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  return modal;
}

function openItemDescriptionModal(item, context = "trader") {
  const modal = ensureDescriptionModal();
  if (!modal) return;

  let content = getEl("itemDescriptionContent");
  if (!content) {
    content = document.createElement("div");
    content.id = "itemDescriptionContent";
    modal.querySelector(".modal-content")?.appendChild(content);
  }

  const priceText = context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
  const rareClass = rarityClass(item?.rarity);
  const itemEmoji = getItemEmoji(item);
  const titleStyle = rarityTextStyle(item?.rarity, "font-weight:800;");

  content.innerHTML = `
    <h2 class="${escapeHtml(rareClass)}" ${titleStyle}>${escapeHtml(itemEmoji)} ${escapeHtml(item?.name || "Без названия")}</h2>
    <div class="item-meta-block">
      <p><strong>💰 Цена:</strong> ${escapeHtml(priceText)}</p>
      <p><strong>🎖 Редкость:</strong> <span class="${escapeHtml(
        rareClass
      )}" ${rarityTextStyle(item?.rarity)}>${escapeHtml(normalizeRarity(item?.rarity))}</span></p>
      <p><strong>🛠 Качество:</strong> ${escapeHtml(normalizeQuality(item?.quality))}</p>
      <p><strong>📌 Характеристики:</strong> ${escapeHtml(getItemCharacteristics(item))}</p>
    </div>
    <pre class="item-description-pre">${escapeHtml(getItemFullDescription(item))}</pre>
  `;

  modal.style.display = "block";
}

// ------------------------------------------------------------
// 🔢 QTY
// ------------------------------------------------------------
function renderQtyInput(maxQty, itemId, initial = 1, disabled = false) {
  const safeMax = Math.max(1, Number(maxQty || 1));
  const value = Math.min(Math.max(1, Number(initial || 1)), safeMax);

  return `
    <input
      type="number"
      class="qty-input"
      data-item-id="${itemId}"
      min="1"
      max="${safeMax}"
      step="1"
      value="${value}"
      ${disabled ? "disabled" : ""}
    />
  `;
}

function getQtyFromButton(button, fallback = 1) {
  const row = button.closest("[data-item-id-row]");
  if (!row) return Math.max(1, Number(fallback || 1));

  const input = row.querySelector(".qty-input");
  if (!input) return Math.max(1, Number(fallback || 1));

  const max = Number(input.max || fallback || 1);
  const value = Number(input.value || fallback || 1);

  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(1, value), Math.max(1, max));
}

// ------------------------------------------------------------
// 🗂 LABELS
// ------------------------------------------------------------
function categoryLabel(value) {
  const map = {
    accessory: "💍 Аксессуары",
    alchemy: "⚗️ Алхимия",
    armor: "🛡️ Броня",
    consumables: "🧰 Расходники",
    food_drink: "🍖 Еда и напитки",
    misc: "📦 Разное",
    potions_elixirs: "🧪 Зелья и эликсиры",
    scrolls_books: "📜 Свитки и книги",
    tools: "🛠️ Инструменты",
    weapon: "🗡️ Оружие",
  };
  return map[String(value || "").trim()] || `📦 ${String(value || "Разное")}`;
}

function specializationPreview(trader) {
  const specs = parseJsonArray(trader?.specialization).filter(Boolean);
  if (!specs.length) return "ассортимент";
  return specs.slice(0, 4).join(", ");
}

// ------------------------------------------------------------
// 🔎 INLINE FILTERS
// ------------------------------------------------------------
function getCompactCollectionFiltersMarkup(context = "trader") {
  return `
    <div class="collection-toolbar compact-collection-toolbar">
      <div class="filter-group">
        <label>🔍 Поиск</label>
        <input type="text" class="item-search-inline" placeholder="Название предмета" />
      </div>

      <div class="filter-group">
        <label>💰 Цена</label>
        <div class="price-range">
          <input type="number" class="price-min-inline" placeholder="от" min="0" />
          <input type="number" class="price-max-inline" placeholder="до" min="0" />
        </div>
      </div>

      <div class="filter-group">
        <label>🎖 Редкость</label>
        <select class="rarity-inline">
          <option value="">Любая</option>
          <option value="common">Обычный</option>
          <option value="uncommon">Необычный</option>
          <option value="rare">Редкий</option>
          <option value="very rare">Очень редкий</option>
          <option value="legendary">Легендарный</option>
          <option value="artifact">Артефакт</option>
        </select>
      </div>

      ${
        context !== "inventory"
          ? `
      <label class="inline-checkbox compact-inline-checkbox">
        <input type="checkbox" class="magic-inline" />
        🔮 Магия
      </label>
      `
          : ""
      }

      <div class="filter-group">
        <label>↕ Сортировка</label>
        <select class="sort-inline">
          <option value="name">Название</option>
          <option value="price_asc">Дешёвые</option>
          <option value="price_desc">Дорогие</option>
        </select>
      </div>

      <div class="filter-group">
        <label>🧩 Вид</label>
        <select class="view-mode-inline">
          <option value="table">Таблица</option>
          <option value="inventory">Список</option>
          <option value="grid">Карточки</option>
        </select>
      </div>
    </div>
  `;
}

function filterCollectionItems(items, wrapper, context = "trader") {
  const search =
    wrapper.querySelector(".item-search-inline")?.value?.trim().toLowerCase() || "";
  const min = wrapper.querySelector(".price-min-inline")?.value ?? "";
  const max = wrapper.querySelector(".price-max-inline")?.value ?? "";
  const rarity = wrapper.querySelector(".rarity-inline")?.value || "";
  const magic = wrapper.querySelector(".magic-inline")?.checked || false;
  const sort = wrapper.querySelector(".sort-inline")?.value || "name";

  let filtered = [...(items || [])].filter((item) => {
    const name = String(item?.name || "").toLowerCase();
    const price = getItemPriceNumeric(item, context);
    const itemRarity = String(item?.rarity || "");
    const isMagical = Boolean(item?.is_magical);

    if (search && !name.includes(search)) return false;
    if (min !== "" && price < Number(min)) return false;
    if (max !== "" && price > Number(max)) return false;
    if (rarity && itemRarity !== rarity) return false;
    if (magic && !isMagical) return false;

    return true;
  });

  if (sort === "name") {
    filtered.sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "ru")
    );
  } else if (sort === "price_asc") {
    filtered.sort((a, b) => getItemPriceNumeric(a, context) - getItemPriceNumeric(b, context));
  } else if (sort === "price_desc") {
    filtered.sort((a, b) => getItemPriceNumeric(b, context) - getItemPriceNumeric(a, context));
  }

  return filtered;
}

// ------------------------------------------------------------
// 🎮 ITEM ACTIONS
// ------------------------------------------------------------
function renderItemActions(item, context, contextId) {
  const itemId = getItemId(item);
  const traderId = getItemTraderId(item, contextId);
  const stock = getTraderStock(item);
  const owned = getOwnedQuantity(item);

  if (context === "trader") {
    const disabled = stock <= 0;
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn btn-success js-buy-item" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" ${
          disabled ? "disabled" : ""
        }>
          🛒 ${disabled ? "Нет в наличии" : "Купить"}
        </button>
        <button class="btn btn-primary js-add-cart" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" ${
          disabled ? "disabled" : ""
        }>🎒 В корзину</button>
        <button class="btn btn-warning js-reserve-item" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" ${
          disabled ? "disabled" : ""
        }>📌 Резерв</button>
        <button class="btn js-open-desc" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" data-context="trader">📖 Описание</button>
      </div>
    `;
  }

  if (context === "cart") {
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" data-context="cart">📖 Описание</button>
        <button class="btn btn-warning js-reserve-from-cart" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}">📌 В резерв</button>
        <button class="btn btn-danger js-remove-cart" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}">🗑 Удалить</button>
      </div>
    `;
  }

  if (context === "reserved") {
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" data-context="reserved">📖 Описание</button>
        <button class="btn btn-success js-buy-reserved" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}">🛒 Купить</button>
        <button class="btn btn-danger js-unreserve" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}">❌ Снять резерв</button>
      </div>
    `;
  }

  if (context === "inventory") {
    const disabled = owned <= 0;
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" data-context="inventory">📖 Описание</button>
        <button class="btn btn-success js-sell-item" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}" ${
          disabled ? "disabled" : ""
        }>💰 Продать</button>
        <button class="btn btn-danger js-remove-inventory" data-item-id="${itemId}" data-trader-id="${traderId ?? ""}">🗑 Удалить</button>
      </div>
    `;
  }

  return "";
}

function handleCollectionActionClick(event, traderFallback = null) {
  const actionRoot = event.target.closest(
    ".js-buy-item, .js-buy-reserved, .js-add-cart, .js-reserve-item, .js-reserve-from-cart, .js-remove-cart, .js-unreserve, .js-sell-item, .js-remove-inventory, .js-open-desc"
  );

  if (!actionRoot) return false;

  const itemId = Number(actionRoot.dataset.itemId);
  const traderId = getItemTraderId({
    trader_id: actionRoot.dataset.traderId,
    traderId: actionRoot.dataset.traderId,
  }, traderFallback);

  if (actionRoot.classList.contains("js-buy-item")) {
    const qty = getQtyFromButton(actionRoot, 1);
    window.buyItem?.(Number(traderId), itemId, qty);
    return true;
  }

  if (actionRoot.classList.contains("js-buy-reserved")) {
    const qty = getQtyFromButton(actionRoot, 1);
    window.buyItem?.(Number(traderId), itemId, qty, { source: "reserved" });
    return true;
  }

  if (actionRoot.classList.contains("js-add-cart")) {
    const qty = getQtyFromButton(actionRoot, 1);
    window.addToCart?.(Number(traderId), itemId, qty);
    return true;
  }

  if (actionRoot.classList.contains("js-reserve-item")) {
    const qty = getQtyFromButton(actionRoot, 1);
    window.reserveItem?.(itemId, traderId, qty);
    return true;
  }

  if (actionRoot.classList.contains("js-reserve-from-cart")) {
    const qty = getQtyFromButton(actionRoot, 1);
    window.reserveItem?.(itemId, traderId, qty);
    window.removeFromCart?.(itemId, traderId);
    return true;
  }

  if (actionRoot.classList.contains("js-remove-cart")) {
    window.removeFromCart?.(itemId, traderId);
    return true;
  }

  if (actionRoot.classList.contains("js-unreserve")) {
    window.unreserveItem?.(itemId, traderId);
    return true;
  }

  if (actionRoot.classList.contains("js-sell-item")) {
    const qty = getQtyFromButton(actionRoot, 1);
    window.sellItem?.(itemId, qty, { traderId });
    return true;
  }

  if (actionRoot.classList.contains("js-remove-inventory")) {
    window.removeInventoryItem?.(itemId);
    return true;
  }

  if (actionRoot.classList.contains("js-open-desc")) {
    const context = String(actionRoot.dataset.context || "trader");
    const item = window.getItemForDescription?.(itemId, context, traderId);
    if (item) {
      openItemDescriptionModal(item, context);
    } else {
      showToast("Описание предмета не найдено");
    }
    return true;
  }

  return false;
}

function bindStandaloneCollectionActions(root, traderFallback = null) {
  if (!root || root.dataset.boundCollectionActions === "1") return;
  root.dataset.boundCollectionActions = "1";

  root.addEventListener("click", (event) => {
    handleCollectionActionClick(event, traderFallback);
  });
}

// ------------------------------------------------------------
// 🧱 ITEM RENDERS
// ------------------------------------------------------------
function renderItemsTable(items, context, contextId) {
  if (!items?.length) {
    return `<div class="trader-detail-section"><p>Ничего не найдено.</p></div>`;
  }

  const amountLabel = context === "inventory" ? "Кол-во" : "Остаток";

  return `
    <div class="items-table-container compact-items-table trader-items-table-round65">
      <table class="items-table items-table-compact-v48 items-table-round65">
        <thead>
          <tr>
            <th>Предмет</th>
            <th>Цена</th>
            <th>Редкость</th>
            <th>Качество</th>
            <th>${escapeHtml(amountLabel)}</th>
            <th>Кратко</th>
            <th>Шт</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${(items || [])
            .map((item) => {
              const itemId = getItemId(item);
              const amount =
                context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
              const maxQty = Math.max(1, amount || 1);
              const priceText =
                context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
              const rareClass = rarityClass(item?.rarity);
              const qtyDisabled = amount <= 0;
              const itemEmoji = getItemEmoji(item);
              const rarityLabel = normalizeRarity(item?.rarity);
              const qualityLabel = normalizeQuality(item?.quality);
              const category = categoryLabel(item?.category_clean || item?.category || "misc");
              const shortDescription = getItemShortDescription(item, 120) || getItemCharacteristics(item) || "—";
              const titleText = `${itemEmoji} ${item?.name || "Без названия"}`;

              return `
                <tr data-item-id-row="${itemId}" class="${escapeHtml(rareClass)} trader-item-row-v48 trader-item-row-round65">
                  <td class="item-main-cell-v48 item-main-cell-round65">
                    <div class="item-title-v48 item-title-round65 ${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:800;")} title="${escapeHtml(titleText)}">
                      ${escapeHtml(itemEmoji)} <span>${escapeHtml(item?.name || "Без названия")}</span>
                    </div>
                    <div class="item-category-v48 item-category-round65" title="${escapeHtml(category)}">${escapeHtml(category)}</div>
                  </td>
                  <td class="item-price-cell-round65 ${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:800;")} title="Цена">${escapeHtml(priceText)}</td>
                  <td class="item-rarity-cell-round65 ${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity)} title="Редкость">${escapeHtml(rarityLabel)}</td>
                  <td class="item-quality-cell-round65 ${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:700;")} title="Качество: ${escapeHtml(qualityLabel)} • Редкость: ${escapeHtml(rarityLabel)}">${escapeHtml(qualityLabel)}</td>
                  <td class="item-stock-cell-round65" title="${escapeHtml(amountLabel)}">${escapeHtml(String(amount))}</td>
                  <td class="item-desc-cell-v48 item-desc-cell-round65">
                    <span title="${escapeHtml(getItemFullDescription(item) || shortDescription)}">${escapeHtml(shortDescription)}</span>
                  </td>
                  <td class="item-qty-cell-v48 item-qty-cell-round65">${renderQtyInput(maxQty, itemId, 1, qtyDisabled)}</td>
                  <td class="add-cell item-actions-cell-v48 item-actions-cell-round65">${renderItemActions(item, context, contextId)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderItemsGrid(items, context, contextId) {
  if (!items?.length) {
    return `<div class="trader-detail-section"><p>Ничего не найдено.</p></div>`;
  }

  return `
    <div class="traders-grid compact-modal-grid">
      ${(items || [])
        .map((item) => {
          const itemId = getItemId(item);
          const amount =
            context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
          const maxQty = Math.max(1, amount || 1);
          const priceText =
            context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
          const rareClass = rarityClass(item?.rarity);
          const qtyDisabled = amount <= 0;
          const itemEmoji = getItemEmoji(item);

          return `
            <div class="trader-card item-card-common ${escapeHtml(
              rareClass
            )}" data-item-id-row="${itemId}">
              <div class="trader-info">
                <div class="trader-name ${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:800;")}>${escapeHtml(itemEmoji)} ${escapeHtml(item?.name || "Без названия")}</div>
                <div class="trader-type"><span class="${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:800;")}>💰 ${escapeHtml(priceText)}</span></div>
                <div class="trader-meta">
                  <span class="meta-item ${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity)}>${escapeHtml(
                    normalizeRarity(item?.rarity)
                  )}</span>
                  <span class="meta-item">🛠 ${escapeHtml(
                    normalizeQuality(item?.quality)
                  )}</span>
                  <span class="meta-item">${
                    context === "inventory" ? "🎒 Количество" : "📦 Осталось"
                  }: ${escapeHtml(String(amount))}</span>
                </div>
                <div class="trader-desc">${escapeHtml(
                  getItemShortDescription(item) || getItemCharacteristics(item)
                )}</div>
                <div style="margin-top:10px;">${renderQtyInput(
                  maxQty,
                  itemId,
                  1,
                  qtyDisabled
                )}</div>
                <div style="margin-top:10px;">${renderItemActions(
                  item,
                  context,
                  contextId
                )}</div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderItemsInventoryList(items, context, contextId) {
  if (!items?.length) {
    return `<div class="trader-detail-section"><p>Ничего не найдено.</p></div>`;
  }

  return `
    <div class="inventory-items-list">
      ${(items || [])
        .map((item) => {
          const itemId = getItemId(item);
          const amount =
            context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
          const maxQty = Math.max(1, amount || 1);
          const priceText =
            context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
          const rareClass = rarityClass(item?.rarity);
          const qtyDisabled = amount <= 0;
          const itemEmoji = getItemEmoji(item);

          return `
            <div class="inventory-item" data-item-id-row="${itemId}">
              <div class="inventory-item-info">
                <strong class="${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:800;")}>${escapeHtml(
                  itemEmoji
                )} ${escapeHtml(item?.name || "Без названия")}</strong>
                <div><span class="${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity, "font-weight:800;")}>💰 ${escapeHtml(priceText)}</span></div>
                <div class="inv-item-details">
                  <span class="${escapeHtml(rareClass)}" ${rarityTextStyle(item?.rarity)}>${escapeHtml(
                    normalizeRarity(item?.rarity)
                  )}</span>
                  <span>🛠 ${escapeHtml(normalizeQuality(item?.quality))}</span>
                  <span>${
                    context === "inventory" ? "🎒 Количество" : "📦 Осталось"
                  }: ${escapeHtml(String(amount))}</span>
                </div>
                <div class="trader-desc" style="margin-top:6px;">
                  ${escapeHtml(getItemShortDescription(item) || getItemCharacteristics(item))}
                </div>
              </div>

              <div class="inventory-item-controls">
                <div class="inventory-item-qty">
                  ${renderQtyInput(maxQty, itemId, 1, qtyDisabled)}
                </div>
                ${renderItemActions(item, context, contextId)}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCollectionInto(container, items, context, contextId) {
  const wrapper = container.closest(".collection-wrapper");
  if (!wrapper) return;

  const filtered = filterCollectionItems(items, wrapper, context);
  const viewMode = wrapper.querySelector(".view-mode-inline")?.value || "table";

  if (viewMode === "grid") {
    container.innerHTML = renderItemsGrid(filtered, context, contextId);
  } else if (viewMode === "inventory") {
    container.innerHTML = renderItemsInventoryList(filtered, context, contextId);
  } else {
    container.innerHTML = renderItemsTable(filtered, context, contextId);
  }
}

function bindCollectionFilters(root, items, context, contextId) {
  const wrapper = root.closest(".collection-wrapper") || root.querySelector(".collection-wrapper");
  const container =
    root.querySelector(".collection-items-container") ||
    root.querySelector(".items-table-container");

  if (!wrapper || !container) return;

  const rerender = () => renderCollectionInto(container, items, context, contextId);

  wrapper
    .querySelectorAll(
      ".item-search-inline, .price-min-inline, .price-max-inline, .rarity-inline, .magic-inline, .sort-inline, .view-mode-inline"
    )
    .forEach((control) => {
      if (control.dataset.bound === "1") return;
      control.dataset.bound = "1";
      control.addEventListener("input", rerender);
      control.addEventListener("change", rerender);
    });

  rerender();
}

function groupItemsByCategory(items) {
  const grouped = {};
  for (const item of items || []) {
    const category = String(item?.category_clean || item?.category || "misc");
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  }
  return grouped;
}


// ------------------------------------------------------------
// 🧭 TRADER ATMOSPHERE / COUNTER NOTES
// ------------------------------------------------------------
function normalizeTraderText(value) {
  return String(value ?? "").toLowerCase().trim();
}

function traderTextIncludes(haystack, needles) {
  const source = normalizeTraderText(haystack);
  return (needles || []).some((needle) => source.includes(normalizeTraderText(needle)));
}

function getTraderSearchText(trader) {
  return [
    trader?.name,
    trader?.type,
    trader?.region,
    trader?.settlement,
    trader?.race,
    trader?.class_name,
    trader?.description,
    trader?.personality,
    parseJsonArray(trader?.specialization).join(" "),
    parseJsonArray(trader?.abilities).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function getTraderCounterProfile(trader) {
  const name = normalizeTraderText(trader?.name);
  const text = getTraderSearchText(trader);

  const byName = [
    {
      match: ["тарм громовой молот"],
      focus: "щит, крепёж, ремонт походного железа",
      rumor: "По южной дороге снова идут слухи о пропавших повозках. Хороший щит там ценнее красивой речи.",
      advice: "Перед выходом проверь ремни и заклёпки: дорога ломает снаряжение быстрее, чем враг."
    },
    {
      match: ["албери миллико"],
      focus: "каменотёсный инструмент, крепкие припасы, редкие куски породы",
      rumor: "В каменоломне камень стал звенеть глуше обычного. Местные говорят: под землёй что-то снова шевелится.",
      advice: "Если путь ведёт в шахты, бери клинья, верёвку и свет. Камень любит тех, кто не спешит."
    },
    {
      match: ["шоалар куандерил"],
      focus: "речной товар, припасы, сомнительные находки с пристани",
      rumor: "На реке сейчас лучше меньше спрашивать и больше слушать. Вода приносит не только брёвна и рыбу.",
      advice: "В лодке лишний металл тянет вниз. Бери только то, что сумеешь удержать одной рукой."
    },
    {
      match: ["гариена"],
      focus: "травы, зелья, природные реагенты",
      rumor: "В роще звери молчат перед бурей. Когда лес замолкает — он не пуст, он слушает.",
      advice: "Не пей незнакомый отвар залпом. Даже добрая трава сначала проверяет сердце."
    },
    {
      match: ["элдрас тантур"],
      focus: "надёжное железо, ремонт, простая броня",
      rumor: "Металл из северных поставок задерживается. Кто-то скупает железо раньше, чем оно доходит до кузниц.",
      advice: "Лучший клинок — тот, который не подведёт на третьем ударе, а не тот, что красиво блестит."
    },
    {
      match: ["фенг железноголовый"],
      focus: "оружие, щиты, бывшее военное снаряжение",
      rumor: "Старые наёмники стали чаще спрашивать про копья и арбалеты. Такие вещи не покупают просто для охоты.",
      advice: "Если не знаешь, что выбрать, бери то, что сможешь починить в поле."
    },
    {
      match: ["мэйгла тарнлар", "хельвур тарнлар"],
      focus: "одежда, плащи, дорожные перчатки",
      rumor: "Хорошая ткань приходит с караванами, а караваны нынче всё чаще приходят поздно.",
      advice: "Плащ должен греть, скрывать и не цепляться за клинок. Всё остальное — vanity."
    },
    {
      match: ["фаендра чансирл"],
      focus: "кожа, сбруя, сумки, дорожные ремни",
      rumor: "Путники стали брать больше запасных ремней. Значит, дорога впереди длиннее, чем они говорят.",
      advice: "Порванный ремень в пути стоит дороже, чем новый в лавке."
    },
    {
      match: ["кайлесса иркелл", "гарлен харлатурл", "херивин дардрагон", "нешор флёрдин"],
      focus: "ночлег, еда, слухи и дорожные припасы",
      rumor: "За соседними столами часто знают больше, чем на доске объявлений. Главное — слушать до третьей кружки.",
      advice: "Сытый отряд спорит тише и идёт дальше. Иногда это важнее стали."
    },
    {
      match: ["мангобарл лоррен", "яланта дрин", "нахазлья дроут", "минтра мандивьер", "ялесса орнра"],
      focus: "еда, припасы, свежие продукты, бытовые мелочи",
      rumor: "Когда деревни начинают считать яйца и муку, значит, беда уже рядом, просто ещё не вошла в дверь.",
      advice: "Голодный герой сначала делает глупость, а потом ищет виноватых."
    },
    {
      match: ["эндрит валливой", "марландро"],
      focus: "подержанные вещи, редкости, старые бумаги, странные находки",
      rumor: "Иногда самая важная вещь выглядит как мусор, пока кто-нибудь не узнает знак на обороте.",
      advice: "Смотри не только на цену. Смотри на следы рук, печати и царапины."
    },
    {
      match: ["аэрего кейлин", "эйриго бетендур"],
      focus: "складской товар, карты, снаряжение для дороги",
      rumor: "Опасные тропы редко пустуют. Если дорога кажется забытой, значит, её кто-то старательно забывает.",
      advice: "Карта не ведёт за руку. Она только честно показывает, где можно пропасть."
    },
    {
      match: ["тёрск телорн", "асдан телорн", "ильмет вэльвур"],
      focus: "фургоны, колёса, оси, ремонт транспорта",
      rumor: "На трактах всё чаще ломаются не колёса, а расписания. Кто-то мешает караванам идти вовремя.",
      advice: "Если ось скрипит здесь, на перевале она будет кричать."
    },
    {
      match: ["хазлия ханадроум", "хаэлия ханадроум"],
      focus: "банные мелочи, ткань, масла, чистая одежда",
      rumor: "Чистая одежда не спасает от беды, но помогает войти туда, куда грязного не пустят.",
      advice: "Не всякая подготовка звенит железом. Иногда запах мыла открывает больше дверей."
    },
    {
      match: ["улро лурут"],
      focus: "кожа, шкуры, дубильные материалы",
      rumor: "Шкуры в последнее время приходят странные: будто звери бежали не от охотников, а от земли под лапами.",
      advice: "Кожа помнит страх животного. Хороший мастер это видит."
    },
  ];

  for (const entry of byName) {
    if (entry.match.some((part) => name.includes(part))) return entry;
  }

  if (traderTextIncludes(text, ["оружие и броня", "кузнец", "оружей", "брон", "воинские"])) {
    return {
      focus: "оружие, броня, ремонт и крепкое походное железо",
      rumor: "Железо дорожает всякий раз, когда дороги становятся опаснее. Сегодня оно снова смотрит вверх.",
      advice: "Не покупай самый красивый клинок. Покупай тот, который переживёт грязь, дождь и плохой бросок."
    };
  }

  if (traderTextIncludes(text, ["одежда и кожа", "портн", "кожа", "сбру", "плащ", "ткан"])) {
    return {
      focus: "одежда, кожа, плащи, ремни и дорожные мелочи",
      rumor: "Караваны с тканью задерживаются. Значит, впереди либо плохая дорога, либо хорошие лжецы.",
      advice: "Снаряжение должно сидеть тихо. Всё, что натирает в городе, в походе станет врагом."
    };
  }

  if (traderTextIncludes(text, ["еда и ночлег", "трактир", "пекар", "мясник", "припас", "еда", "птицевод"])) {
    return {
      focus: "еда, напитки, лагерь и припасы на дорогу",
      rumor: "Люди с дороги чаще просят не эль, а тёплую воду и место у стены. Это плохой знак.",
      advice: "Перед боем спорят о стали. После боя все ищут хлеб, воду и сухое место."
    };
  }

  if (traderTextIncludes(text, ["травы и алхимия", "алхим", "трав", "зель", "яд", "друид"])) {
    return {
      focus: "травы, зелья, яды, противоядия и редкие реагенты",
      rumor: "В болотной воде цветы раскрылись не по сезону. Природа редко ошибается без причины.",
      advice: "У зелья две цены: золотом до беды и кровью после неё."
    };
  }

  if (traderTextIncludes(text, ["ремесло и транспорт", "фургон", "колес", "камень", "камен", "ремесл", "склад", "картограф"])) {
    return {
      focus: "инструменты, транспорт, карты и крепкое дорожное снаряжение",
      rumor: "Старые дороги не исчезают. Их просто перестают отмечать на новых картах.",
      advice: "Верёвка, фонарь и запасной крюк выглядят скучно ровно до первой пропасти."
    };
  }

  if (traderTextIncludes(text, ["река", "контрабанд", "лод", "пристан", "вода"])) {
    return {
      focus: "речной товар, припасы, инструменты и вещи без лишних вопросов",
      rumor: "По воде слухи идут быстрее караванов. Только часть из них всплывает целой.",
      advice: "Всё, что может утонуть, однажды попытается."
    };
  }

  return {
    focus: "ходовые товары, дорожные мелочи и то, что оказалось под рукой",
    rumor: "Чем тише день на рынке, тем внимательнее стоит слушать тех, кто пришёл с дороги.",
    advice: "Плохой товар кричит о себе громче хорошего."
  };
}

function buildTraderCounterPanel(trader) {
  const profile = getTraderCounterProfile(trader);
  const title = traderTextIncludes(trader?.type, ["еда", "ночлег"])
    ? "У стойки"
    : traderTextIncludes(trader?.type, ["река", "контрабанда"])
      ? "С пристани"
      : "У прилавка";

  return `
    <div class="trader-detail-section trader-modal-counter-note" aria-label="Заметка торговца">
      <div class="trader-modal-counter-note-head">
        <span>${escapeHtml(title)}</span>
        <small>заметка для путников</small>
      </div>
      <div class="trader-modal-counter-note-grid">
        <div class="trader-modal-counter-note-card">
          <strong>На виду</strong>
          <span>${escapeHtml(profile.focus)}</span>
        </div>
        <div class="trader-modal-counter-note-card">
          <strong>Слух</strong>
          <span>${escapeHtml(profile.rumor)}</span>
        </div>
        <div class="trader-modal-counter-note-card trader-modal-counter-note-card-wide">
          <strong>Совет</strong>
          <span>${escapeHtml(profile.advice)}</span>
        </div>
      </div>
    </div>
  `;
}

function ensureTraderAtmosphereStyles() {
  if (document.getElementById("trader-atmosphere-style-round1")) return;
  const style = document.createElement("style");
  style.id = "trader-atmosphere-style-round1";
  style.textContent = `
    #traderModal .trader-modal-counter-note {
      margin-top: 12px;
      padding: 14px 16px;
      border: 1px solid rgba(108, 202, 213, 0.16);
      border-radius: 16px;
      background:
        radial-gradient(circle at 15% 0%, rgba(73, 190, 197, 0.075), transparent 34%),
        linear-gradient(135deg, rgba(5, 18, 22, 0.76), rgba(4, 11, 14, 0.9));
      box-shadow: inset 0 0 0 1px rgba(255, 220, 150, 0.035);
    }

    #traderModal .trader-modal-counter-note-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 11px;
      color: rgba(255, 231, 181, 0.96);
      font-family: var(--font-title, Georgia, serif);
      letter-spacing: 0.03em;
    }

    #traderModal .trader-modal-counter-note-head span {
      font-size: 1.05rem;
      font-weight: 800;
    }

    #traderModal .trader-modal-counter-note-head small {
      color: rgba(211, 225, 226, 0.62);
      font-family: var(--font-ui, system-ui, sans-serif);
      font-size: 0.78rem;
      letter-spacing: 0;
      white-space: nowrap;
    }

    #traderModal .trader-modal-counter-note-grid {
      display: grid;
      grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
      gap: 10px;
    }

    #traderModal .trader-modal-counter-note-card {
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid rgba(255, 220, 150, 0.105);
      border-radius: 13px;
      background: rgba(0, 0, 0, 0.18);
    }

    #traderModal .trader-modal-counter-note-card-wide {
      grid-column: 1 / -1;
    }

    #traderModal .trader-modal-counter-note-card strong {
      display: block;
      margin-bottom: 4px;
      color: rgba(137, 229, 235, 0.94);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    #traderModal .trader-modal-counter-note-card span {
      display: block;
      color: rgba(232, 239, 236, 0.9);
      line-height: 1.42;
      font-size: 0.94rem;
    }

    #traderModal.trader-modal-refined.trader-modal-round82.trader-modal-round83 .trader-modal-image-wrap,
    #traderModal .trader-modal-image-wrap {
      background:
        radial-gradient(circle at 50% 18%, rgba(67, 184, 191, 0.1), transparent 42%),
        linear-gradient(180deg, rgba(8, 22, 27, 0.92), rgba(2, 8, 11, 0.98));
    }

    #traderModal.trader-modal-refined.trader-modal-round82.trader-modal-round83 .trader-modal-image-wrap > img,
    #traderModal.trader-modal-refined.trader-modal-round82.trader-modal-round83 img.trader-modal-image,
    #traderModal.trader-modal-refined.trader-modal-round82.trader-modal-round83 .trader-modal-image,
    #traderModal .trader-modal-image {
      object-fit: contain !important;
      object-position: center center !important;
      background: rgba(0, 0, 0, 0.18);
    }

    #traderModal .trader-modal-portrait-caption {
      line-height: 1.28;
    }

    @media (max-width: 980px) {
      #traderModal .trader-modal-counter-note-grid {
        grid-template-columns: 1fr;
      }

      #traderModal .trader-modal-counter-note-card-wide {
        grid-column: auto;
      }
    }
  `;
  document.head.appendChild(style);
}

// ------------------------------------------------------------
// 🧑‍💼 TRADER MODAL BLOCKS
// ------------------------------------------------------------
function buildTraderHeader(trader, tabsMarkup = "") {
  const specialization =
    parseJsonArray(trader?.specialization).join(", ") ||
    safe(trader?.specialization, "—");

  const imageUrl = getTraderImageUrl(trader);
  const hasImage = Boolean(imageUrl);

  const relationshipProgress = getTraderRelationshipProgress(trader);
  const repStars = getReputationStars(Math.round(relationshipProgress.percent / 20));
  const repTitle = getTraderRelationshipLabel(trader);
  const skillTitle = trader?.skill_label || getTraderLevelLabel(trader?.trader_level || trader?.level || 1);
  const currentDiscount = getTraderDiscountDisplay(trader);
  const traderEmoji = getTraderEmoji(trader?.type);
  const restockButtonsMarkup = buildRestockButtonsMarkup(trader?.id);
  const traderLevel = Number(trader?.trader_level || trader?.level || 1) || 1;
  const reputationValue = relationshipProgress.percent;
  const portraitQuote = trader?.quote || trader?.motto || trader?.personality || "Честная сделка держится на доверии, золоте и правильном моменте.";
  const walletLabel = trader?.money_label || trader?.gold_label || trader?.gold || "—";
  const counterPanelMarkup = buildTraderCounterPanel(trader);

  ensureTraderAtmosphereStyles();

  return `
    <div class="trader-modal-header trader-modal-header-round64">
      <div class="trader-modal-profile-row">
        ${
          hasImage
            ? `
          <aside class="trader-modal-portrait-panel">
            <div class="trader-modal-image-wrap">
              <img class="trader-modal-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(
                  trader?.name || "Торговец"
                )}" loading="eager" decoding="async" />
            </div>
            <div class="trader-modal-portrait-caption">«${escapeHtml(String(portraitQuote))}»</div>
            <div class="trader-modal-reputation-card">
              <div class="trader-modal-reputation-head">
                <strong>Репутация</strong>
                <span>${escapeHtml(String(relationshipProgress.percent))}%</span>
              </div>
              <div class="trader-modal-relation-line">
                <strong>${escapeHtml(repTitle)}</strong>
                <span>отношение к торговцу</span>
              </div>
              <progress value="${escapeHtml(String(relationshipProgress.current))}" max="${escapeHtml(String(relationshipProgress.max))}"></progress>
              <div class="muted">Прогресс: ${escapeHtml(String(relationshipProgress.current))} / ${escapeHtml(String(relationshipProgress.max))}${relationshipProgress.toNext ? ` • до следующего: ${escapeHtml(String(relationshipProgress.toNext))}` : ""}</div>
            </div>
          </aside>
        `
            : ""
        }

        <section class="trader-modal-main-column">
          <div class="trader-modal-info">
            <div class="trader-header-title-row">
              <h2>${escapeHtml(traderEmoji)} ${escapeHtml(trader?.name || "Безымянный торговец")}</h2>
            </div>

            <div class="trader-meta trader-modal-meta">
              <span class="meta-item">${escapeHtml(traderEmoji)} ${escapeHtml(trader?.type || "—")}</span>
              <span class="meta-item">${getRegionEmoji()} ${escapeHtml(trader?.region || "—")}</span>
              <span class="meta-item">${getSettlementEmoji()} ${escapeHtml(trader?.settlement || "—")}</span>
              <span class="meta-item">⭐ ${escapeHtml(repStars)}</span>
            </div>

            <div class="trader-modal-summary-grid">
              <div class="trader-summary-card">
                <span>🧭 Уровень</span>
                <strong>${escapeHtml(skillTitle)}</strong>
                <small>lvl ${escapeHtml(String(traderLevel))}</small>
              </div>
              <div class="trader-summary-card">
                <span>🏷️ Скидка</span>
                <strong>${escapeHtml(String(currentDiscount))}%</strong>
                <small>учтена в ценах</small>
              </div>
              <div class="trader-summary-card trader-summary-card-wide">
                <span>🧰 Специализация</span>
                <strong>${escapeHtml(specialization)}</strong>
                <small>основной ассортимент</small>
              </div>
              <div class="trader-summary-card">
                <span>🪙 Золото</span>
                <strong>${escapeHtml(String(walletLabel))}</strong>
                <small>кошелёк NPC</small>
              </div>
            </div>

            ${restockButtonsMarkup}

            <div class="trader-detail-section trader-modal-description-section">
              <p><strong>📜 Описание:</strong> ${escapeHtml(trader?.description || "—")}</p>
            </div>

            ${counterPanelMarkup}
          </div>
        </section>
      </div>
    </div>

    <div class="trader-modal-workline trader-modal-workline-fullwidth">
      <div class="trader-modal-tabs-flow">
        ${tabsMarkup}
      </div>
    </div>
  `;
}

function buildTraderStats(trader) {
  const stats = parseJsonObject(trader?.stats);
  const abilities = parseJsonArray(trader?.abilities);
  const possessions = parseJsonArray(trader?.possessions);
  const race = trader?.race || "—";
  const className = trader?.class_name || trader?.class || "—";
  const level = trader?.trader_level || trader?.level || "—";

  const statsHtml = Object.keys(stats).length
    ? `
      <div class="stats-grid">
        <div class="stat-item"><strong>🧬 Раса</strong><span>${escapeHtml(String(
          race
        ))}</span></div>
        <div class="stat-item"><strong>🎓 Класс</strong><span>${escapeHtml(String(
          className
        ))}</span></div>
        <div class="stat-item"><strong>📈 Уровень</strong><span>${escapeHtml(String(
          level
        ))}</span></div>
        ${Object.entries(stats)
          .map(
            ([key, value]) => `
          <div class="stat-item">
            <strong>${escapeHtml(String(key).toUpperCase())}</strong>
            <span>${escapeHtml(String(value))}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
    : `
      <div class="stats-grid">
        <div class="stat-item"><strong>🧬 Раса</strong><span>${escapeHtml(String(
          race
        ))}</span></div>
        <div class="stat-item"><strong>🎓 Класс</strong><span>${escapeHtml(String(
          className
        ))}</span></div>
        <div class="stat-item"><strong>📈 Уровень</strong><span>${escapeHtml(String(
          level
        ))}</span></div>
      </div>
    `;

  return `
    <div class="trader-detail-section">
      <h4>⚔️ Статы</h4>
      ${statsHtml}
    </div>
    ${
      abilities.length
        ? `
      <div class="trader-detail-section">
        <h4>✨ Способности</h4>
        <ul>${abilities
          .map((a) => `<li>${escapeHtml(String(a))}</li>`)
          .join("")}</ul>
      </div>
    `
        : ""
    }
    ${
      possessions.length
        ? `
      <div class="trader-detail-section">
        <h4>🎒 Личные вещи</h4>
        <ul>${possessions
          .map((p) => `<li>${escapeHtml(String(p))}</li>`)
          .join("")}</ul>
      </div>
    `
        : ""
    }
  `;
}

function buildTraderInfo(trader) {
  return `
    <div class="trader-detail-section">
      <h4>📜 Описание</h4>
      <p>${escapeHtml(trader?.description || "Описание отсутствует")}</p>
    </div>

    <div class="trader-detail-section">
      <h4>🎯 Специализация</h4>
      <p>${escapeHtml(
        parseJsonArray(trader?.specialization).join(", ") ||
          safe(trader?.specialization, "—")
      )}</p>
    </div>

    <div class="trader-detail-section">
      <h4>🗣️ Особенности</h4>
      <p>${escapeHtml(safe(trader?.personality, "—"))}</p>
    </div>

    <div class="trader-detail-section">
      <h4>📌 Слухи / квесты</h4>
      <p>${escapeHtml(safe(trader?.rumors, "—"))}</p>
    </div>
  `;
}


function buildTraderFilterDrawerMarkup(context = "trader", title = "Фильтры и вид", countLabel = "") {
  return `
    <details class="trader-filter-drawer" open>
      <summary>
        <span>⚙️ ${escapeHtml(title)}</span>
        ${countLabel ? `<strong>${escapeHtml(countLabel)}</strong>` : ""}
      </summary>
      ${getCompactCollectionFiltersMarkup(context)}
    </details>
  `;
}

function buildTraderTabs(grouped, trader) {
  const categoryNames = Object.keys(grouped);

  const buyTabs = categoryNames
    .map(
      (category, index) => `
      <button class="category-tab ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(
        category
      )}">
        ${escapeHtml(categoryLabel(category))}
      </button>
    `
    )
    .join("");

  const buyContents = categoryNames
    .map(
      (category, index) => `
      <div class="category-content ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(
        category
      )}" ${index === 0 ? "" : 'style="display:none" hidden'}>
        <div class="collection-wrapper">
          ${buildTraderFilterDrawerMarkup("trader", "Фильтры и вид", `${(grouped[category] || []).length} шт.`)}
          <div class="collection-items-container"></div>
        </div>
      </div>
    `
    )
    .join("");

  return `
    <div class="tab-bar">
      <button class="tab-btn active" data-main-tab="buy">🎒 Товары</button>
      <button class="tab-btn" data-main-tab="sell">💰 Продажа</button>
      <button class="tab-btn" data-main-tab="stats">⚔️ Статы</button>
      <button class="tab-btn" data-main-tab="info">📜 Информация</button>
    </div>

    <div id="tab-buy" class="tab-content active" style="display:block;">
      ${
        categoryNames.length
          ? `<div class="category-tabs tab-bar">${buyTabs}</div>${buyContents}`
          : `<p>У торговца нет товаров.</p>`
      }
    </div>

    <div id="tab-sell" class="tab-content" style="display:none;">
      <div id="sellSection">
        <h3>💰 Продажа торговцу</h3>
        <div class="collection-wrapper">
          ${buildTraderFilterDrawerMarkup("inventory", "Фильтры продажи", "инвентарь")}
          <div class="collection-items-container" id="sellItemsContainer"></div>
        </div>
      </div>
    </div>

    <div id="tab-stats" class="tab-content" style="display:none;">
      ${buildTraderStats(trader)}
    </div>

    <div id="tab-info" class="tab-content" style="display:none;">
      ${buildTraderInfo(trader)}
    </div>
  `;
}

// ------------------------------------------------------------
// 🎛 MODAL BINDING
// ------------------------------------------------------------
function bindTraderModal(modal) {
  if (!modal) return;

  const modalContent = getTraderModalContent();
  const trader = getActiveTraderFromModal(modal);
  if (!modalContent || !trader) return;

  const grouped = groupItemsByCategory(trader.items || []);
  const inventoryItems = getInventoryState();

  modalContent.querySelectorAll(".collection-items-container").forEach((container) => {
    const categoryContent = container.closest(".category-content");
    if (!categoryContent) return;
    const category = categoryContent.dataset.cat;
    const items = grouped[category] || [];
    bindCollectionFilters(categoryContent, items, "trader", trader.id);
  });

  const sellContainer = getEl("sellItemsContainer");
  if (sellContainer) {
    bindCollectionFilters(sellContainer.parentElement, inventoryItems, "inventory", trader.id);
  }

  if (!modal.dataset.boundRenderModal) {
    modal.dataset.boundRenderModal = "1";

    modal.addEventListener("click", async (event) => {
      const currentTrader = getActiveTraderFromModal(modal);
      const currentTraderId = currentTrader?.id ?? null;

      const closeBtn = event.target.closest("[data-trader-modal-close]");
      if (closeBtn) {
        closeTraderModal(modal);
        return;
      }

      const navBtn = event.target.closest("[data-trader-nav]");
      if (navBtn) {
        const targetTraderId = Number(navBtn.dataset.traderId || 0);
        if (Number.isFinite(targetTraderId) && targetTraderId > 0 && typeof window.openTraderModal === "function") {
          await window.openTraderModal(targetTraderId);
        }
        return;
      }

      const scrollBtn = event.target.closest("[data-trader-scroll]");
      if (scrollBtn) {
        setTraderFloatingControlsVisible(modal.querySelector(".trader-modal-scroll-controls"), true);
        scrollTraderModalViewport(String(scrollBtn.dataset.traderScroll || "top"), modal);
        return;
      }

      const tabBtn = event.target.closest(".tab-btn[data-main-tab]");
      if (tabBtn) {
        const tabName = tabBtn.dataset.mainTab;

        modal.querySelectorAll(".tab-btn[data-main-tab]").forEach((btn) => {
          btn.classList.toggle("active", btn === tabBtn);
        });

        modal.querySelectorAll(".tab-content").forEach((tab) => {
          const active = tab.id === `tab-${tabName}`;
          tab.classList.toggle("active", active);
          tab.style.display = active ? "block" : "none";
        });

        return;
      }

      const catBtn = event.target.closest(".category-tab[data-cat]");
      if (catBtn) {
        const cat = catBtn.dataset.cat;
        const buyTab = modal.querySelector("#tab-buy");

        buyTab?.querySelectorAll(".category-tab").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.cat === cat);
        });

        buyTab?.querySelectorAll(".category-content").forEach((content) => {
          const active = content.dataset.cat === cat;
          content.classList.toggle("active", active);
          content.style.display = active ? "block" : "none";
          if (!active) content.setAttribute("hidden", "hidden");
          else content.removeAttribute("hidden");
        });

        return;
      }

      if (await handleCollectionActionClick(event, currentTraderId)) {
        return;
      }
    });
  }

  if (!modal.dataset.boundOverlayClose) {
    modal.dataset.boundOverlayClose = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeTraderModal(modal);
      }
    });
  }

  const nativeClose = modal.querySelector(":scope > .modal-content > .close");
  if (nativeClose && nativeClose.dataset.boundTraderClose !== "1") {
    nativeClose.dataset.boundTraderClose = "1";
    nativeClose.addEventListener("click", () => closeTraderModal(modal));
  }
}

// ------------------------------------------------------------
// 🧑‍💼 TRADER MODAL OPEN
// ------------------------------------------------------------
export async function openTraderModal(traderId) {
  const trader = getTraderById(traderId);
  const modal = getEl("traderModal");
  const modalContent = getTraderModalContent();

  if (!trader || !modal || !modalContent) {
    showToast("Не удалось открыть торговца");
    return;
  }

  const grouped = groupItemsByCategory(trader.items || []);

  const traderTabsMarkup = buildTraderTabs(grouped, trader);

  modal.querySelectorAll(":scope > .trader-modal-scroll-controls").forEach((node) => node.remove());

  modalContent.innerHTML = `
    ${buildTraderModalChrome(trader)}
    <div class="trader-modal-layout trader-modal-layout-round45">
      ${buildTraderHeader(trader, traderTabsMarkup)}
    </div>
  `;

  // Round 82: стрелки прокрутки живут рядом с .modal-content, а не внутри
  // #modalContent. Так они не зажимаются таблицей/overflow и всегда плавают
  // поверх модалки, как нижние стрелки кабинета.
  modal.insertAdjacentHTML("beforeend", buildTraderModalScrollControls());

  modal.dataset.traderId = String(trader.id);
  document.body.classList.add("trader-modal-open");
  modal.classList.add("trader-modal-refined", "trader-modal-round31", "trader-modal-round32", "trader-modal-round45", "trader-modal-round63", "trader-modal-round64", "trader-modal-round65", "trader-modal-round66", "trader-modal-round67", "trader-modal-round68", "trader-modal-round71", "trader-modal-round72", "trader-modal-round73", "trader-modal-round82", "trader-modal-round83");
  modal.style.display = "block";
  modal.dataset.traderModalUiVersion = "round83-scroll-stabilized";
  modalContent.scrollTop = 0;

  ensureTraderModalDocumentNavigation();
  bindTraderModal(modal);
  ensureTraderModalScrollControls(modal);
}

// ------------------------------------------------------------
// 🏪 TRADER CARDS
// ------------------------------------------------------------
function buildTraderCard(trader) {
  const imageUrl = getTraderImageUrl(trader);
  const hasImage = Boolean(imageUrl);
  const relationshipProgress = getTraderRelationshipProgress(trader);
  const repTitle = getTraderRelationshipLabel(trader);
  const repStars = getReputationStars(Math.round(relationshipProgress.percent / 20));
  const traderEmoji = getTraderEmoji(trader?.type);
  const preview = specializationPreview(trader);
  const traderLevel = Number(trader?.trader_level || trader?.level || 1) || 1;
  const traderLevelLabel = getTraderLevelLabel(traderLevel);
  const buyDiscount = getTraderDiscountDisplay(trader);
  const sellBonus = Number.isFinite(Number(trader?.sell_bonus_percent))
    ? Math.max(0, Number(trader.sell_bonus_percent))
    : getTraderSellBonusPercent(trader?.reputation);
  const reputationTone = getTraderRelationshipTone(trader);

  return `
    <article
      class="trader-card trader-card-clickable"
      data-trader-card-id="${escapeHtml(String(trader.id))}"
      tabindex="0"
      role="button"
      aria-label="Открыть торговца ${escapeHtml(trader?.name || "торговец")}" 
    >
      ${
        hasImage
          ? `<div class="trader-card-image-wrap">
              <img class="trader-card-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(
                trader?.name || "Торговец"
              )}">
            </div>`
          : `<div class="trader-card-image-wrap trader-card-image-fallback">${escapeHtml(traderEmoji)}</div>`
      }

      <div class="trader-info">
        <div class="trader-meta trader-card-topline">
          <span class="trader-quality">${escapeHtml(getTraderLevelLabel(traderLevel))}</span>
          <span class="meta-item">lvl ${escapeHtml(String(traderLevel))}</span>
          <span class="meta-item trader-reputation-chip trader-reputation-chip-${escapeHtml(reputationTone)}">${escapeHtml(String(buyDiscount))}%</span>
        </div>
        <div class="trader-name">${escapeHtml(traderEmoji)} ${escapeHtml(trader?.name || "Безымянный торговец")}</div>
        <div class="trader-type">${escapeHtml(trader?.type || "—")}</div>

        <div class="trader-meta">
          <span class="meta-item">${getRegionEmoji()} ${escapeHtml(trader?.region || "—")}</span>
          <span class="meta-item">${getSettlementEmoji()} ${escapeHtml(trader?.settlement || "—")}</span>
          <span class="meta-item">⭐ ${escapeHtml(repStars)}</span>
        </div>

        <div class="trader-desc">
          ${escapeHtml(trader?.description || "Описание отсутствует")}
        </div>

        <div class="trader-meta trader-meta-footer">
          <span class="meta-item">🎯 ${escapeHtml(preview)}</span>
        </div>
      </div>
    </article>
  `;
}

export function renderTraders(traders) {
  const container = getTradersContainer();
  if (!container) return;

  container.classList.add("traders-grid");

  if (!traders?.length) {
    container.innerHTML = `
      <div class="trader-detail-section">
        <p>Торговцы не найдены.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `${traders.map((trader) => buildTraderCard(trader)).join("")}${buildTraderPageScrollControls()}`;
  ensureTraderPageScrollControls();
}

// ------------------------------------------------------------
// 🛒 CART
// ------------------------------------------------------------
function renderReservedBlock(items) {
  if (!items?.length) {
    return `
      <div class="trader-detail-section">
        <h3>📌 Резерв</h3>
        <p>Резерв пуст.</p>
      </div>
    `;
  }

  return `
    <div class="trader-detail-section">
      <h3>📌 Резерв</h3>
      ${renderItemsInventoryList(items, "reserved", null)}
    </div>
  `;
}

export function renderCart(items) {
  const container = getCartContainer();
  if (!container) return;

  const reserved = getReservedState();

  container.innerHTML = `
    <div class="collection-wrapper">
      ${getCompactCollectionFiltersMarkup("cart")}
      <div class="collection-items-container">
        ${
          items?.length
            ? renderItemsInventoryList(items, "cart", null)
            : `<div class="trader-detail-section"><p>Корзина пуста.</p></div>`
        }
      </div>
    </div>

    <div style="margin-top:16px;">
      ${renderReservedBlock(reserved)}
    </div>
  `;

  const wrapper = container.querySelector(".collection-wrapper");
  const itemsContainer = container.querySelector(".collection-items-container");
  if (wrapper && itemsContainer) {
    bindCollectionFilters(wrapper, items || [], "cart", null);
  }

  bindStandaloneCollectionActions(container, null);
}

// ------------------------------------------------------------
// 🎒 INVENTORY
// ------------------------------------------------------------
export function renderInventory(items) {
  const container = getInventoryContainer();
  if (!container) return;

  container.innerHTML = `
    <div class="collection-wrapper">
      ${getCompactCollectionFiltersMarkup("inventory")}
      <div class="collection-items-container">
        ${
          items?.length
            ? renderItemsInventoryList(items, "inventory", null)
            : `<div class="trader-detail-section"><p>Инвентарь пуст.</p></div>`
        }
      </div>
    </div>
  `;

  const wrapper = container.querySelector(".collection-wrapper");
  const itemsContainer = container.querySelector(".collection-items-container");
  if (wrapper && itemsContainer) {
    bindCollectionFilters(wrapper, items || [], "inventory", null);
  }

  bindStandaloneCollectionActions(container, null);
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.renderModule = {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal,
};
window.openTraderModal = openTraderModal;
