import {
  acceptFriendRequest,
  activateGmMode,
  cancelFriendRequest,
  deactivateGmMode,
  fetchAccount,
  fetchDirectConversations,
  fetchDirectMessages,
  fetchFriendsState,
  fetchPlayerInventory,
  deleteAccountMedia,
  fetchTraders,
  setPrimaryAccountMedia,
  markConversationRead,
  rejectFriendRequest,
  removeFriend,
  searchAccountUsers,
  sendDirectMessage,
  sendFriendRequest,
  transferToPlayer,
  uploadAccountMedia,
  updateAccount,
  isAuthenticated,
} from "./api.js";

import {
  escapeHtml,
  formatDateTime,
  getEl,
  safeNumber,
  safeText,
  showToast,
} from "./shared.js";

const ACCOUNT_STATE = {
  loaded: false,
  section: "profile",
  account: null,
  friends: {
    friends: [],
    incoming_requests: [],
    outgoing_requests: [],
  },
  searchQuery: "",
  searchResults: [],
  conversations: [],
  activeConversationId: "",
  activeFriendId: "",
  messages: [],
  tradeInventory: [],
  pollTimer: null,
};

const ACCOUNT_SECTIONS = [
  { key: "profile", label: "Профиль" },
  { key: "friends", label: "Друзья" },
  { key: "chat", label: "Чат" },
  { key: "parties", label: "Столы / Партии" },
  { key: "characters", label: "Персонажи" },
  { key: "showcase", label: "Витрина" },
  { key: "trade", label: "Обмен" },
  { key: "settings", label: "Настройки" },
];

function syncAccountUser(userPatch = {}) {
  const currentUser = window.__appUser || {};
  const previousRole = String(currentUser.role || "player").trim().toLowerCase() === "gm" ? "gm" : "player";
  const nextUser = {
    ...currentUser,
    ...(userPatch && typeof userPatch === "object" ? userPatch : {}),
  };
  const nextRole = String(nextUser.role || "player").trim().toLowerCase() === "gm" ? "gm" : "player";

  window.__appUser = nextUser;
  window.__appUserRole = nextRole;
  window.__userRole = window.__appUserRole;
  document.body.dataset.role = window.__appUserRole;

  try {
    localStorage.setItem("user", JSON.stringify(nextUser));
  } catch (_) {}

  if (previousRole !== nextRole) {
    try {
      window.dispatchEvent(
        new CustomEvent("dnd:role:changed", {
          detail: { role: window.__appUserRole, user: nextUser },
        })
      );
    } catch (_) {}
  }

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:user:updated", {
        detail: { user: nextUser },
      })
    );
  } catch (_) {}
}

function getAccountRoot() {
  return getEl("cabinet-myaccount");
}

function getCurrentUser() {
  return ACCOUNT_STATE.account?.user || null;
}

function getCurrentParties() {
  return Array.isArray(ACCOUNT_STATE.account?.parties) ? ACCOUNT_STATE.account.parties : [];
}

function getCurrentCharacters() {
  return Array.isArray(ACCOUNT_STATE.account?.characters) ? ACCOUNT_STATE.account.characters : [];
}

function getCurrentShowcase() {
  return ACCOUNT_STATE.account?.showcase || {};
}

function getProfileMedia() {
  const media = ACCOUNT_STATE.account?.user?.profile_media;
  if (!media || typeof media !== "object") {
    return {
      avatar: null,
      banner: null,
      showcase: [],
    };
  }
  return {
    avatar: media.avatar && typeof media.avatar === "object" ? media.avatar : null,
    banner: media.banner && typeof media.banner === "object" ? media.banner : null,
    showcase: Array.isArray(media.showcase) ? media.showcase : [],
  };
}

function getProfileAvatarUrl() {
  const user = getCurrentUser() || {};
  const media = getProfileMedia();
  return safeText(media.avatar?.url || user.avatar_url || "", "").trim();
}

function getProfileBannerUrl() {
  const user = getCurrentUser() || {};
  const media = getProfileMedia();
  return safeText(media.banner?.url || user.banner_url || "", "").trim();
}

function getActiveConversation() {
  return ACCOUNT_STATE.conversations.find((entry) => String(entry.id) === String(ACCOUNT_STATE.activeConversationId)) || null;
}

function getActiveChatPeer() {
  const conversation = getActiveConversation();
  if (conversation?.friend) {
    return conversation.friend;
  }
  const friends = Array.isArray(ACCOUNT_STATE.friends?.friends) ? ACCOUNT_STATE.friends.friends : [];
  const activeFriend = friends.find((entry) => Number(entry?.friend?.id || 0) === Number(ACCOUNT_STATE.activeFriendId || 0));
  return activeFriend?.friend || null;
}

function getConversationFriendUserId(conversation) {
  return Number(conversation?.friend?.id || ACCOUNT_STATE.activeFriendId || 0);
}

function renderAccountChatAvatar(user, className = "account-chat-avatar") {
  const name = safeText(user?.display_name || user?.nickname || user?.email || "Игрок", "Игрок");
  const initial = name.slice(0, 1).toUpperCase();
  const avatarUrl = safeText(user?.avatar_url || "", "").trim();
  return `
    <span class="${className} ${user?.is_online ? "account-chat-avatar-online" : ""}">
      ${avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}">`
        : `<span>${escapeHtml(initial)}</span>`}
    </span>
  `;
}

function scrollAccountChatToBottom() {
  if (ACCOUNT_STATE.section !== "chat") return;
  window.setTimeout(() => {
    const thread = document.querySelector(".account-chat-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, 0);
}

function formatAccountChatTime(value) {
  const formatted = formatDateTime(value);
  if (!formatted || formatted === "—") return "";
  const parts = formatted.split(",");
  return (parts.length > 1 ? parts[parts.length - 1] : formatted).trim();
}

function getCurrentLssCharacterName() {
  const shared = window.__sharedState?.lss?.profile || window.__sharedState?.lss?.raw || {};
  const direct = window.__LSS_EXPORT__ || window.__lssExport || window.__PLAYER_LSS__ || window.__playerLss || {};
  const localRaw = (() => {
    try {
      const user = window.__appUser || {};
      const userKey = user?.email || user?.id || "guest";
      const raw = localStorage.getItem(`lssData:${userKey}`);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  })();

  return String(
    shared?.name ||
      shared?.info?.name ||
      direct?.name ||
      direct?.info?.name ||
      localRaw?.name ||
      localRaw?.info?.name ||
      ""
  ).trim();
}

function getChatEntries() {
  const conversations = Array.isArray(ACCOUNT_STATE.conversations) ? ACCOUNT_STATE.conversations : [];
  const friends = Array.isArray(ACCOUNT_STATE.friends?.friends) ? ACCOUNT_STATE.friends.friends : [];
  const map = new Map();

  conversations.forEach((conversation) => {
    const friendId = Number(conversation?.friend?.id || 0);
    if (!friendId) return;
    map.set(friendId, {
      friend: conversation.friend,
      conversation,
    });
  });

  friends.forEach((entry) => {
    const friend = entry?.friend;
    const friendId = Number(friend?.id || 0);
    if (!friendId) return;
    if (!map.has(friendId)) {
      map.set(friendId, {
        friend,
        conversation: null,
      });
    }
  });

  return Array.from(map.values()).sort((left, right) => {
    const leftStamp = left?.conversation?.last_message_at || left?.conversation?.updated_at || "";
    const rightStamp = right?.conversation?.last_message_at || right?.conversation?.updated_at || "";
    return String(rightStamp).localeCompare(String(leftStamp));
  });
}

function getFriendRelationshipState(userId) {
  const targetId = Number(userId || 0);
  if (!targetId) return "none";
  if ((ACCOUNT_STATE.friends?.friends || []).some((entry) => Number(entry?.friend?.id || 0) === targetId)) {
    return "friend";
  }
  if ((ACCOUNT_STATE.friends?.outgoing_requests || []).some((entry) => Number(entry?.user?.id || 0) === targetId)) {
    return "outgoing";
  }
  if ((ACCOUNT_STATE.friends?.incoming_requests || []).some((entry) => Number(entry?.user?.id || 0) === targetId)) {
    return "incoming";
  }
  return "none";
}

function renderFriendActionButton(user) {
  const state = getFriendRelationshipState(user?.id);
  if (state === "friend") {
    return `<button class="btn active" type="button" disabled>В друзьях</button>`;
  }
  if (state === "outgoing") {
    return `<button class="btn" type="button" disabled>Заявка отправлена</button>`;
  }
  if (state === "incoming") {
    return `<button class="btn btn-primary" type="button" disabled>Ждёт твоего ответа</button>`;
  }
  return `<button class="btn btn-primary" type="button" data-account-send-request="${escapeHtml(String(user?.id || ""))}">Добавить</button>`;
}

function formatMoneyCp(totalCp) {
  const total = Math.max(0, safeNumber(totalCp, 0));
  const gold = Math.floor(total / 10000);
  const silver = Math.floor((total % 10000) / 100);
  const copper = total % 100;
  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper || !parts.length) parts.push(`${copper}м`);
  return parts.join(" ");
}

function ensureChatPolling() {
  if (ACCOUNT_STATE.pollTimer) {
    clearInterval(ACCOUNT_STATE.pollTimer);
    ACCOUNT_STATE.pollTimer = null;
  }

  if (ACCOUNT_STATE.section !== "chat") return;

  ACCOUNT_STATE.pollTimer = window.setInterval(async () => {
    try {
      await loadConversations();
      if (ACCOUNT_STATE.activeConversationId) {
        await loadMessages(ACCOUNT_STATE.activeConversationId, { silent: true });
      }
      renderAccountModule();
    } catch (_) {}
  }, 8000);
}

function isAuthError(error) {
  return /not authenticated|401/i.test(String(error?.message || ""));
}

function roleBadgeLabel(user) {
  const preferred = safeText(user?.preferred_role || user?.role || "player", "player").toLowerCase();
  if (preferred === "both") return "mixed";
  if (preferred === "gm") return "gm";
  return "player";
}

function getCharacterNameState(character) {
  const manualName = safeText(character?.manual_name || character?.name || "", "").trim();
  const lssName = safeText(character?.lss_name || "", "").trim();
  const backendSource = safeText(character?.name_source || "", "").trim();
  const resolved = safeText(character?.name || manualName || lssName || "Персонаж", "Персонаж");
  const source = backendSource || (manualName ? "character_manual" : lssName ? "lss" : "fallback");
  const sourceLabelMap = {
    table_manual: "Ручное имя за столом",
    character_manual: "Ручное имя персонажа",
    manual: "Ручное имя персонажа",
    lss: "Из LSS",
    fallback: "Базовое имя",
  };
  return {
    resolved,
    source,
    sourceLabel: sourceLabelMap[source] || "Базовое имя",
    manualName,
    lssName,
  };
}

function renderMediaSlot(kind, title, description, previewUrl) {
  const pendingPreview = getPendingMediaData(kind).dataUrl;
  const effectivePreview = pendingPreview || previewUrl;
  return `
    <div class="cabinet-block account-media-slot">
      <div class="flex-between account-hub-card-head">
        <div>
          <div class="account-hub-card-title">${escapeHtml(title)}</div>
          <div class="muted account-hub-stat-note">${escapeHtml(description)}</div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <button class="btn btn-primary" type="button" data-account-pick-media="${escapeHtml(kind)}">Выбрать файл</button>
          <button class="btn" type="button" data-account-upload-media="${escapeHtml(kind)}">Загрузить</button>
          <button class="btn btn-danger" type="button" data-account-delete-media="${escapeHtml(kind)}">Очистить</button>
        </div>
      </div>
      <div class="profile-grid account-media-slot-grid">
        <div class="account-media-preview ${effectivePreview ? "account-media-preview-filled" : ""}" data-account-media-preview="${escapeHtml(kind)}">
          ${
            effectivePreview
              ? `<img src="${escapeHtml(effectivePreview)}" alt="${escapeHtml(title)}" class="account-media-preview-image">`
              : `<div class="muted account-media-preview-empty">PNG / JPG / WEBP / GIF<br>до ${kind === "showcase" ? "8" : "4"} МБ</div>`
          }
        </div>
        <div class="filter-group">
          <label>URL fallback</label>
          <input id="${kind === "avatar" ? "accountAvatarUrlInput" : "accountBannerUrlInput"}" type="text" value="${escapeHtml(previewUrl || "")}" placeholder="https://...">
          <div class="muted account-media-slot-note">Можно оставить ссылку вручную, но основной путь теперь через загрузку файла.</div>
        </div>
      </div>
      <input id="account${kind.charAt(0).toUpperCase() + kind.slice(1)}FileInput" type="file" accept="image/*" hidden>
    </div>
  `;
}

function renderShowcaseGallery() {
  const media = getProfileMedia();
  const items = Array.isArray(media.showcase) ? media.showcase : [];
  const pendingPreview = getPendingMediaData("showcase").dataUrl;
  return `
    <div class="cabinet-block">
      <div class="flex-between account-hub-card-head">
        <div>
          <h4 class="account-hub-card-title">Витрина и скриншоты</h4>
          <div class="muted account-hub-card-copy">Можно хранить игровые скрины, арты и обложку профиля.</div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <button class="btn btn-primary" type="button" data-account-pick-media="showcase">Добавить скрин</button>
          <button class="btn" type="button" data-account-upload-media="showcase">Загрузить выбранное</button>
        </div>
      </div>
      <div class="profile-grid account-media-slot-grid account-showcase-upload-grid">
        <div class="account-media-preview ${pendingPreview ? "account-media-preview-filled" : ""}" data-account-media-preview="showcase">
          ${pendingPreview ? `<img src="${escapeHtml(pendingPreview)}" alt="showcase preview" class="account-media-preview-image">` : `<div class="muted account-media-preview-empty">Drag-and-drop через браузер пока не нужен: достаточно выбора файла, превью и серверной загрузки.</div>`}
        </div>
        <div class="filter-group">
          <label>Подпись к скрину</label>
          <input id="accountShowcaseCaptionInput" type="text" maxlength="160" placeholder="Например: победа над боссом или арт персонажа">
          <div class="muted account-media-slot-note">Первый или помеченный primary элемент становится обложкой витрины.</div>
        </div>
      </div>
      <input id="accountShowcaseFileInput" type="file" accept="image/*" hidden>
      ${
        items.length
          ? `<div class="account-showcase-grid">
              ${items.map((entry) => `
                <article class="account-showcase-card">
                  <div class="account-showcase-thumb">
                    <img src="${escapeHtml(entry.url || "")}" alt="${escapeHtml(entry.caption || "showcase")}">
                  </div>
                  <div class="flex-between account-showcase-card-head">
                    <div>
                      <div class="account-showcase-card-title">${escapeHtml(entry.caption || "Без подписи")}</div>
                      <div class="muted account-showcase-card-note">${entry.is_primary ? "Обложка витрины" : "Доп. скрин"}</div>
                    </div>
                    ${entry.is_primary ? `<span class="meta-item">primary</span>` : ""}
                  </div>
                  <div class="cart-buttons account-showcase-card-actions">
                    ${entry.is_primary ? "" : `<button class="btn" type="button" data-account-set-primary-media="${escapeHtml(entry.id)}">Сделать обложкой</button>`}
                    <button class="btn btn-danger" type="button" data-account-delete-media="${escapeHtml(entry.id)}">Удалить</button>
                  </div>
                </article>
              `).join("")}
            </div>`
          : `<div class="muted">Витрина пока пустая. Загрузите первый скрин или арт.</div>`
      }
    </div>
  `;
}

function renderAccountHero() {
  const user = getCurrentUser();
  if (!user) {
    return `<div class="cabinet-block"><p>Профиль не загружен.</p></div>`;
  }

  const avatar = getProfileAvatarUrl();
  const banner = getProfileBannerUrl();
  const avatarMarkup = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(user.nickname || "avatar")}" class="account-hub-avatar-media">`
    : `<div class="account-hub-avatar-fallback">${escapeHtml((user.nickname || user.email || "U").slice(0, 1).toUpperCase())}</div>`;
  const isGm = String(user.role || "").trim().toLowerCase() === "gm";
  const lssName = getCurrentLssCharacterName();
  const partiesCount = getCurrentParties().length;
  const charactersCount = getCurrentCharacters().length;
  const showcase = getCurrentShowcase();
  const heroBackdrop = banner
    ? `linear-gradient(rgba(9,16,24,0.46), rgba(9,16,24,0.92)), url('${escapeHtml(banner)}') center/cover`
    : "radial-gradient(circle at top left, rgba(214,181,122,0.22), transparent 28%), radial-gradient(circle at top right, rgba(105,153,171,0.28), transparent 24%), linear-gradient(135deg, rgba(25,31,42,0.98), rgba(9,13,19,0.99))";

  return `
    <section class="cabinet-block account-hub-hero">
      <div class="account-hub-hero-backdrop" style="--account-hero-backdrop:${heroBackdrop};">
        <div class="account-hub-hero-layout">
          <div class="account-hub-identity">
            <div class="account-hub-avatar-wrap">${avatarMarkup}</div>
            <div class="account-hub-copy">
              <div class="account-hub-kicker">Игровой профиль</div>
              <div class="account-hub-title">${escapeHtml(user.display_name || user.nickname || user.email || "Игрок")}</div>
              <div class="muted account-hub-subtitle">@${escapeHtml(user.nickname || user.username || "player")} • ${escapeHtml(user.email || "")}</div>
              <div class="trader-meta account-hub-meta">
              <span class="meta-item">role: ${escapeHtml(roleBadgeLabel(user))}</span>
              <span class="meta-item">${user.is_online ? "online" : `last seen: ${escapeHtml(formatDateTime(user.last_seen_at))}`}</span>
              <span class="meta-item">created: ${escapeHtml(formatDateTime(user.created_at))}</span>
              ${lssName ? `<span class="meta-item">LSS: ${escapeHtml(lssName)}</span>` : ""}
              </div>
              <div class="account-hub-status">${escapeHtml(user.short_status || "Без статуса")}</div>
              <div class="cart-buttons account-hub-actions">
              <button class="btn ${isGm ? "btn-danger" : "btn-primary"}" type="button" id="accountToggleGmModeBtn">
                ${isGm ? "Переключить в Player" : "Включить GM mode"}
              </button>
              <button class="btn" type="button" data-account-section-open="masterroom">Открыть Master Room</button>
              <button class="btn" type="button" data-account-section="chat">Открыть чат</button>
            </div>
          </div>
          </div>
          <div class="account-hub-sidepanel">
            <div class="account-hub-sidepanel-header">
              <div class="account-hub-kicker">Витрина профиля</div>
              <div class="muted account-hub-sidepanel-note">Личные игровые маркеры</div>
            </div>
            <div class="account-hub-metrics-grid">
              <div class="stat-box account-hub-metric-card">
                <div class="muted">Персонажи</div>
                <div class="account-hub-metric-value">${escapeHtml(String(charactersCount))}</div>
              </div>
              <div class="stat-box account-hub-metric-card">
                <div class="muted">Партии</div>
                <div class="account-hub-metric-value">${escapeHtml(String(partiesCount))}</div>
              </div>
              <div class="stat-box account-hub-metric-card">
                <div class="muted">Друзья</div>
                <div class="account-hub-metric-value">${escapeHtml(String(showcase.friends_count || 0))}</div>
              </div>
              <div class="stat-box account-hub-metric-card">
                <div class="muted">Витрина</div>
                <div class="account-hub-metric-value">${escapeHtml(String((getProfileMedia().showcase || []).length))}</div>
              </div>
            </div>
            <div class="account-hub-featured-note">
              ${escapeHtml(user.bio || "Профиль игрока, витрина персонажей и социальный хаб кампании.")}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSectionNav() {
  return `
    <div class="cabinet-block account-hub-nav account-hub-nav-shell">
      <div class="account-hub-tab-row">
        ${ACCOUNT_SECTIONS.map((section) => `
          <button
            class="btn ${ACCOUNT_STATE.section === section.key ? "active" : ""}"
            type="button"
            data-account-section="${escapeHtml(section.key)}"
          >
            ${escapeHtml(section.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderProfileSection() {
  const user = getCurrentUser();
  if (!user) return `<div class="cabinet-block"><p>Профиль недоступен.</p></div>`;
  const showcase = getCurrentShowcase();
  const activeCharacter = showcase.active_character;
  const activeParty = showcase.active_party;
  const media = getProfileMedia();
  const previewTitle = activeCharacter?.name || getCurrentLssCharacterName() || user.display_name || user.nickname || "Кабинет персонажа";
  const previewMeta = [
    `Роль: ${roleBadgeLabel(user)}`,
    activeParty?.title ? `Стол: ${activeParty.title}` : "",
    lssCharacterMeta(user, activeCharacter),
  ].filter(Boolean);

  return `
    <div class="account-hub-profile-grid">
      <div class="cabinet-block account-hub-stage-card">
        <div class="flex-between account-hub-card-head">
          <div>
            <h4 class="account-hub-card-title">Обзор профиля</h4>
            <div class="muted account-hub-card-copy">Сначала идентичность и быстрые игровые блоки, редактирование ниже.</div>
          </div>
          <span class="meta-item">${media.avatar?.url ? "avatar uploaded" : "avatar via URL/fallback"}</span>
        </div>
        <div class="profile-grid account-hub-stats-grid">
          <div class="stat-box account-hub-stat-card">
            <div class="muted">О себе</div>
            <div class="account-hub-stat-copy">${escapeHtml(user.bio || showcase.about_me || "Заполни краткое описание профиля и стиля игры.")}</div>
          </div>
          <div class="stat-box account-hub-stat-card">
            <div class="muted">Активный персонаж</div>
            <div class="account-hub-stat-value">${escapeHtml(activeCharacter?.name || getCurrentLssCharacterName() || "Не выбран")}</div>
            <div class="muted account-hub-stat-note">${escapeHtml(activeCharacter?.class_name || "Связь с LSS доступна")}</div>
          </div>
          <div class="stat-box account-hub-stat-card">
            <div class="muted">Текущий стол</div>
            <div class="account-hub-stat-value">${escapeHtml(activeParty?.title || "Не выбран")}</div>
            <div class="muted account-hub-stat-note">${escapeHtml(activeParty?.role_in_table || "Можно выбрать в настройках")}</div>
          </div>
          <div class="stat-box account-hub-stat-card">
            <div class="muted">Быстрые теги</div>
            <div class="account-hub-stat-tags">${escapeHtml((user.profile_tags || []).join(" • ") || "co-op • roleplay • bg3")}</div>
          </div>
        </div>
      </div>

      <div class="account-hub-support-column">
        <div class="cabinet-block account-hub-stage-card">
          <div class="flex-between account-hub-card-head">
            <div>
              <h4 class="account-hub-card-title">Featured</h4>
              <div class="muted account-hub-card-copy">Главное о твоём профиле без ухода в настройки.</div>
            </div>
            <span class="meta-item">${escapeHtml(roleBadgeLabel(user))}</span>
          </div>
          <div class="profile-grid account-hub-featured-grid">
            <div class="stat-box account-hub-stat-card">
              <div class="muted">Статус</div>
              <div class="account-hub-stat-value">${escapeHtml(user.short_status || "Без статуса")}</div>
            </div>
            <div class="stat-box account-hub-stat-card">
              <div class="muted">Витрина</div>
              <div class="account-hub-stat-value">${escapeHtml(String((media.showcase || []).length))} media</div>
            </div>
            <div class="stat-box account-hub-stat-card">
              <div class="muted">Активный стол</div>
              <div class="account-hub-stat-value">${escapeHtml(activeParty?.title || "Не выбран")}</div>
            </div>
          </div>
        </div>
        ${renderMediaSlot("avatar", "Аватар", "Основной образ профиля, используется в хабе и social-блоках.", getProfileAvatarUrl())}
        ${renderMediaSlot("banner", "Баннер", "Фон hero-зоны профиля. Можно оставить URL как fallback.", getProfileBannerUrl())}
      </div>
    </div>

    <div class="cabinet-block account-hub-edit-panel account-hub-edit-shell">
      <div class="flex-between account-hub-card-head">
        <div>
          <h4 class="account-hub-card-title">Редактирование профиля</h4>
          <div class="muted account-hub-card-copy">Редактирование остаётся доступным, но больше не занимает весь экран вместо профиля.</div>
        </div>
      </div>
      <div class="profile-grid account-hub-edit-grid">
        <div class="filter-group">
          <label>Username / nickname</label>
          <input id="accountNicknameInput" type="text" value="${escapeHtml(user.nickname || "")}">
        </div>
        <div class="filter-group">
          <label>Display name</label>
          <input id="accountDisplayNameInput" type="text" value="${escapeHtml(user.display_name || "")}">
        </div>
        <div class="filter-group account-hub-full-span">
          <label>Короткий статус</label>
          <input id="accountShortStatusInput" type="text" value="${escapeHtml(user.short_status || "")}" placeholder="Во что играю, кого ищу, чем занят">
        </div>
        <div class="filter-group account-hub-full-span">
          <label>О себе</label>
          <textarea id="accountBioInput" rows="4" placeholder="О себе, интересы, стиль игры...">${escapeHtml(user.bio || "")}</textarea>
        </div>
      </div>
      <div class="cart-buttons account-hub-edit-actions">
        <button class="btn btn-primary" type="button" id="accountSaveProfileBtn">Сохранить профиль</button>
      </div>
    </div>

    <div class="cabinet-block account-hub-preview-card">
      <div class="account-hub-preview-emblem">✦</div>
      <div class="account-hub-preview-copy">
        <div class="account-hub-kicker">Личный кабинет — превью</div>
        <div class="account-hub-preview-title">${escapeHtml(previewTitle)}</div>
        <div class="account-hub-preview-meta">${escapeHtml(previewMeta.join(" • ") || "Игровой профиль и social hub")}</div>
      </div>
      <div class="account-hub-preview-scene"></div>
    </div>
  `;
}

function lssCharacterMeta(user, activeCharacter) {
  return activeCharacter?.class_name || user.short_status || "Игровой профиль и social hub";
}

function renderFriendsSearch() {
  const results = Array.isArray(ACCOUNT_STATE.searchResults) ? ACCOUNT_STATE.searchResults : [];
  return `
    <section class="cabinet-block account-social-search">
      <div class="account-social-search-head">
        <div>
          <div class="account-hub-kicker">Social search</div>
          <h4 class="account-social-title">Поиск игроков</h4>
          <div class="muted account-social-copy">Найди игрока по нику, display name или email и открой direct chat.</div>
        </div>
        <span class="meta-item">${escapeHtml(String(results.length))} найдено</span>
      </div>
      <div class="account-social-search-row">
        <div class="filter-group">
          <label>Поиск игроков</label>
          <input id="accountFriendsSearchInput" type="text" value="${escapeHtml(ACCOUNT_STATE.searchQuery || "")}" placeholder="Ник, display name или email">
        </div>
        <button class="btn btn-primary" type="button" id="accountFriendsSearchBtn">Найти</button>
      </div>
      <div class="account-social-search-results">
        ${results.length
          ? results.map((user) => `
              <div class="account-social-result-row">
                ${renderAccountChatAvatar(user, "account-chat-avatar account-chat-avatar-small")}
                <div class="account-social-person-copy">
                  <strong>${escapeHtml(user.display_name || user.nickname || user.email || "Игрок")}</strong>
                  <span>@${escapeHtml(user.nickname || user.username || "")}${user.short_status ? ` • ${escapeHtml(user.short_status)}` : ""}</span>
                </div>
                ${renderFriendActionButton(user)}
              </div>
            `).join("")
          : `<div class="account-social-empty">Поиск пока пуст. Введи ник или email игрока.</div>`}
      </div>
    </section>
  `;
}

function renderFriendsList() {
  const state = ACCOUNT_STATE.friends;
  const friends = Array.isArray(state.friends) ? state.friends : [];
  const incoming = Array.isArray(state.incoming_requests) ? state.incoming_requests : [];
  const outgoing = Array.isArray(state.outgoing_requests) ? state.outgoing_requests : [];
  return `
    <div class="account-social-shell">
      ${renderFriendsSearch()}
      <div class="account-social-summary">
        <div class="account-social-summary-card">
          <span>Друзья</span>
          <strong>${escapeHtml(String(friends.length))}</strong>
        </div>
        <div class="account-social-summary-card">
          <span>Входящие</span>
          <strong>${escapeHtml(String(incoming.length))}</strong>
        </div>
        <div class="account-social-summary-card">
          <span>Исходящие</span>
          <strong>${escapeHtml(String(outgoing.length))}</strong>
        </div>
      </div>

      <div class="account-social-grid">
        <section class="cabinet-block account-social-panel account-social-panel-main">
          <div class="account-social-panel-head">
            <div>
              <div class="account-hub-kicker">Party network</div>
              <h4 class="account-social-title">Друзья</h4>
            </div>
            <span class="meta-item">${escapeHtml(String(friends.length))}</span>
          </div>
          <div class="account-social-list">
            ${friends.length
              ? friends.map((entry) => {
                  const friend = entry.friend || {};
                  return `
                    <div class="account-social-friend-card">
                      ${renderAccountChatAvatar(friend)}
                      <div class="account-social-person-copy">
                        <strong>${escapeHtml(friend.display_name || friend.nickname || "Игрок")}</strong>
                        <span>@${escapeHtml(friend.nickname || "")} • ${friend.is_online ? "online" : "offline"}</span>
                        ${friend.short_status ? `<small>${escapeHtml(friend.short_status)}</small>` : ""}
                      </div>
                      <div class="account-social-actions">
                        <button class="btn" type="button" data-account-open-chat="${escapeHtml(String(friend.id || ""))}">Чат</button>
                        <button class="btn" type="button" data-account-open-trade="${escapeHtml(String(friend.id || ""))}">Обмен</button>
                        <button class="btn btn-danger" type="button" data-account-remove-friend="${escapeHtml(String(friend.id || ""))}">Удалить</button>
                      </div>
                    </div>
                  `;
                }).join("")
              : `<div class="account-social-empty">Друзей пока нет. Используй поиск выше, чтобы собрать party network.</div>`}
          </div>
        </section>

        <section class="cabinet-block account-social-panel">
          <div class="account-social-panel-head">
            <div>
              <div class="account-hub-kicker">Incoming</div>
              <h4 class="account-social-title">Входящие заявки</h4>
            </div>
            <span class="meta-item">${escapeHtml(String(incoming.length))}</span>
          </div>
          <div class="account-social-list">
            ${incoming.length
              ? incoming.map((entry) => {
                  const user = entry.user || {};
                  return `
                    <div class="account-social-request-card">
                      ${renderAccountChatAvatar(user, "account-chat-avatar account-chat-avatar-small")}
                      <div class="account-social-person-copy">
                        <strong>${escapeHtml(user.display_name || user.nickname || "Игрок")}</strong>
                        <span>${escapeHtml(entry.message || "Без сообщения")}</span>
                      </div>
                      <div class="account-social-actions account-social-actions-inline">
                        <button class="btn btn-primary" type="button" data-account-accept-request="${escapeHtml(String(entry.id))}">Принять</button>
                        <button class="btn btn-danger" type="button" data-account-reject-request="${escapeHtml(String(entry.id))}">Отклонить</button>
                      </div>
                    </div>
                  `;
                }).join("")
              : `<div class="account-social-empty">Входящих заявок нет.</div>`}
          </div>
        </section>

        <section class="cabinet-block account-social-panel">
          <div class="account-social-panel-head">
            <div>
              <div class="account-hub-kicker">Outgoing</div>
              <h4 class="account-social-title">Исходящие заявки</h4>
            </div>
            <span class="meta-item">${escapeHtml(String(outgoing.length))}</span>
          </div>
          <div class="account-social-list">
            ${outgoing.length
              ? outgoing.map((entry) => {
                  const user = entry.user || {};
                  return `
                    <div class="account-social-request-card">
                      ${renderAccountChatAvatar(user, "account-chat-avatar account-chat-avatar-small")}
                      <div class="account-social-person-copy">
                        <strong>${escapeHtml(user.display_name || user.nickname || "Игрок")}</strong>
                        <span>${escapeHtml(entry.message || "Ожидает ответа")}</span>
                      </div>
                      <div class="account-social-actions account-social-actions-inline">
                        <button class="btn btn-danger" type="button" data-account-cancel-request="${escapeHtml(String(entry.id))}">Отменить</button>
                      </div>
                    </div>
                  `;
                }).join("")
              : `<div class="account-social-empty">Исходящих заявок нет.</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderTradeSection() {
  const activePeer = getActiveChatPeer();
  const friends = Array.isArray(ACCOUNT_STATE.friends?.friends) ? ACCOUNT_STATE.friends.friends : [];
  const tradeItems = Array.isArray(ACCOUNT_STATE.tradeInventory) ? ACCOUNT_STATE.tradeInventory : [];
  const currentMoneyLabel = formatMoneyCp(getCurrentUser()?.money_cp_total || 0);
  const activePeerName = activePeer?.display_name || activePeer?.nickname || "Обмен с другом";

  return `
    <div class="account-trade-shell">
      <section class="cabinet-block account-trade-hero">
        <div class="account-trade-hero-copy">
          <div class="account-hub-kicker">Player exchange</div>
          <h4 class="account-social-title">Обмен / передача</h4>
          <div class="muted account-social-copy">Передай золото или предмет игроку из списка друзей. Вся логика передачи остаётся через текущий API.</div>
        </div>
        <div class="account-trade-summary">
          <div class="account-social-summary-card">
            <span>Золото</span>
            <strong>${escapeHtml(currentMoneyLabel)}</strong>
          </div>
          <div class="account-social-summary-card">
            <span>Предметы</span>
            <strong>${escapeHtml(String(tradeItems.length))}</strong>
          </div>
          <div class="account-social-summary-card">
            <span>Друзья</span>
            <strong>${escapeHtml(String(friends.length))}</strong>
          </div>
        </div>
      </section>

      <div class="account-trade-grid">
        <aside class="cabinet-block account-trade-peer-panel">
          <div class="account-social-panel-head">
            <div>
              <div class="account-hub-kicker">Recipient</div>
              <h4 class="account-social-title">Кому передать</h4>
            </div>
            <span class="meta-item">${escapeHtml(String(friends.length))}</span>
          </div>
          <div class="account-trade-peer-list">
            ${friends.length
              ? friends.map((entry) => {
                  const friend = entry?.friend || {};
                  const isActive = Number(friend.id || 0) === Number(ACCOUNT_STATE.activeFriendId || 0);
                  return `
                    <button
                      class="account-trade-peer-card ${isActive ? "account-trade-peer-card-active" : ""}"
                      type="button"
                      data-account-open-trade="${escapeHtml(String(friend.id || ""))}"
                    >
                      ${renderAccountChatAvatar(friend, "account-chat-avatar account-chat-avatar-small")}
                      <span class="account-social-person-copy">
                        <strong>${escapeHtml(friend.display_name || friend.nickname || "Друг")}</strong>
                        <span>@${escapeHtml(friend.nickname || "")} • ${friend.is_online ? "online" : "offline"}</span>
                      </span>
                    </button>
                  `;
                }).join("")
              : `<div class="account-social-empty">Сначала добавь друзей.</div>`}
          </div>
        </aside>

        <section class="cabinet-block account-trade-console">
          <div class="account-chat-header">
            <div class="account-chat-peer">
              ${renderAccountChatAvatar(activePeer || {}, "account-chat-avatar account-chat-avatar-large")}
              <div class="account-chat-peer-copy">
                <h4>${escapeHtml(activePeerName)}</h4>
                <span>${activePeer ? `@${escapeHtml(activePeer.nickname || "")}` : "Выбери друга слева"}</span>
              </div>
            </div>
            <span class="meta-item">Твоё золото: ${escapeHtml(currentMoneyLabel)}</span>
          </div>

          <div class="account-trade-form-grid">
            <div class="filter-group">
              <label>Золото</label>
              <input id="accountTradeGoldInput" type="number" min="0" step="1" placeholder="в медяках" ${activePeer ? "" : "disabled"}>
              <div class="muted account-chat-field-note">Можно оставить 0, если передаёшь только предмет.</div>
            </div>
            <div class="filter-group">
              <label>Предмет</label>
              <select id="accountTradeItemSelect" ${activePeer ? "" : "disabled"}>
                <option value="">Не выбран</option>
                ${tradeItems.map((item) => `
                  <option value="${escapeHtml(String(item.item_id || item.id || ""))}">
                    ${escapeHtml(item.name || "Предмет")} ×${escapeHtml(String(item.quantity || 1))}
                  </option>
                `).join("")}
              </select>
            </div>
            <div class="filter-group">
              <label>Количество</label>
              <input id="accountTradeQuantityInput" type="number" min="1" step="1" value="1" ${activePeer ? "" : "disabled"}>
            </div>
          </div>

          <div class="account-trade-note">
            <span>Передача попадёт в social/trade flow аккаунта.</span>
            <strong>${escapeHtml(activePeer ? "Готово к отправке" : "Получатель не выбран")}</strong>
          </div>

          <div class="cart-buttons account-trade-actions">
            <button class="btn btn-primary" type="button" id="accountSendTradeBtn" ${activePeer ? "" : "disabled"}>Передать</button>
            <button class="btn" type="button" data-account-section="chat">Открыть чат</button>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderPartiesSection() {
  const parties = getCurrentParties();
  return `
    <div class="cabinet-block">
      <h4 style="margin:0 0 10px;">Мои столы / партии</h4>
      ${parties.length
        ? parties.map((entry) => `
            <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,0.06);">
              <div style="font-weight:800;">${escapeHtml(entry.title || "Стол")}</div>
              <div class="muted" style="font-size:0.82rem;">role: ${escapeHtml(entry.role_in_table || "player")} • status: ${escapeHtml(entry.status || "active")} • token: ${escapeHtml(entry.token || "")}</div>
            </div>
          `).join("")
        : `<div class="muted">Вы пока не участвуете ни в одном столе.</div>`}
    </div>
  `;
}

function renderCharactersSection() {
  const characters = getCurrentCharacters();
  const activeCharacterId = Number(getCurrentUser()?.active_character_id || 0);
  const lssName = getCurrentLssCharacterName();
  return `
    <div class="cabinet-block">
      <div class="flex-between" style="gap:12px; align-items:flex-start; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <h4 style="margin:0 0 4px;">Мои персонажи</h4>
          <div class="muted" style="font-size:0.82rem;">Приоритет имени сейчас такой: ручное имя персонажа в аккаунте, затем имя из LSS. Это видно прямо в карточке.</div>
        </div>
      </div>
      ${lssName ? `
        <div class="cabinet-block" style="padding:10px 12px; margin-bottom:10px;">
          <div style="font-weight:800;">Текущий персонаж из LSS</div>
          <div class="muted" style="font-size:0.82rem; margin-top:4px;">${escapeHtml(lssName)}</div>
        </div>
      ` : ""}
      <div class="account-showcase-grid">
      ${characters.length
        ? characters.map((character) => {
            const nameState = getCharacterNameState(character);
            return `
            <article class="account-showcase-card">
              <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
                <div>
                  <div style="font-weight:800;">${escapeHtml(nameState.resolved)}</div>
                  <div class="muted" style="font-size:0.82rem; margin-top:4px;">lvl ${escapeHtml(String(character.level || 1))} • ${escapeHtml(character.class_name || "class")} • ${escapeHtml(character.race || "race")}</div>
                  <div class="muted" style="font-size:0.76rem; margin-top:6px;">Источник имени: ${escapeHtml(nameState.sourceLabel)}${nameState.lssName ? ` • LSS: ${escapeHtml(nameState.lssName)}` : ""}</div>
                </div>
                <label class="meta-item" style="cursor:pointer;">
                  <input type="radio" name="accountActiveCharacter" value="${escapeHtml(String(character.id))}" ${activeCharacterId === Number(character.id) ? "checked" : ""}>
                  active
                </label>
              </div>
            </article>
          `;
          }).join("")
        : `<div class="muted">Персонажей пока нет.</div>`}
      </div>
      <div class="cart-buttons" style="margin-top:10px;">
        <button class="btn btn-primary" type="button" id="accountSaveActiveCharacterBtn">Сохранить active character</button>
      </div>
    </div>
  `;
}

function renderShowcaseSection() {
  const showcase = getCurrentShowcase();
  return `
    <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px;">
      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">About me</h4>
        <div>${escapeHtml(showcase.about_me || "Пока пусто.")}</div>
      </div>
      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Active character</h4>
        ${showcase.active_character
          ? `<div style="font-weight:800;">${escapeHtml(showcase.active_character.name || "Персонаж")}</div><div class="muted">${escapeHtml(showcase.active_character.class_name || "")} • lvl ${escapeHtml(String(showcase.active_character.level || 1))}</div>`
          : `<div class="muted">Не выбран.</div>`}
      </div>
      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Current party</h4>
        ${showcase.active_party
          ? `<div style="font-weight:800;">${escapeHtml(showcase.active_party.title || "Стол")}</div><div class="muted">${escapeHtml(showcase.active_party.role_in_table || "player")} • ${escapeHtml(showcase.active_party.status || "active")}</div>`
          : `<div class="muted">Не выбрана.</div>`}
      </div>
      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Featured items</h4>
        ${Array.isArray(showcase.featured_items) && showcase.featured_items.length
          ? showcase.featured_items.map((item) => `<div style="padding:6px 0;">${escapeHtml(item.name || "Предмет")} ×${escapeHtml(String(item.quantity || 1))}</div>`).join("")
          : `<div class="muted">Пока пусто.</div>`}
      </div>
    </div>
    <div style="margin-top:12px;">
      ${renderShowcaseGallery()}
    </div>
  `;
}

function renderSettingsSection() {
  const user = getCurrentUser();
  const parties = getCurrentParties();
  return `
    <div class="cabinet-block">
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;">
        <div class="filter-group">
          <label>Preferred role</label>
          <select id="accountPreferredRoleInput">
            <option value="player" ${user?.preferred_role === "player" ? "selected" : ""}>player</option>
            <option value="gm" ${user?.preferred_role === "gm" ? "selected" : ""}>gm</option>
            <option value="both" ${user?.preferred_role === "both" ? "selected" : ""}>both</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Privacy</label>
          <select id="accountPrivacyLevelInput">
            <option value="public" ${user?.privacy_level === "public" ? "selected" : ""}>public</option>
            <option value="friends" ${user?.privacy_level === "friends" ? "selected" : ""}>friends</option>
            <option value="private" ${user?.privacy_level === "private" ? "selected" : ""}>private</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Кто может писать</label>
          <select id="accountAllowMessagesInput">
            <option value="everyone" ${user?.allow_direct_messages === "everyone" ? "selected" : ""}>everyone</option>
            <option value="friends" ${user?.allow_direct_messages !== "everyone" && user?.allow_direct_messages !== "nobody" ? "selected" : ""}>friends</option>
            <option value="nobody" ${user?.allow_direct_messages === "nobody" ? "selected" : ""}>nobody</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Timezone</label>
          <input id="accountTimezoneInput" type="text" value="${escapeHtml(user?.timezone || "UTC")}">
        </div>
        <div class="filter-group">
          <label>Locale</label>
          <input id="accountLocaleInput" type="text" value="${escapeHtml(user?.locale || "ru-RU")}">
        </div>
        <div class="filter-group">
          <label>Profile tags</label>
          <input id="accountProfileTagsInput" type="text" value="${escapeHtml((user?.profile_tags || []).join(", "))}" placeholder="co-op, roleplay, bg3">
        </div>
        <div class="filter-group">
          <label>Preferred systems</label>
          <input id="accountPreferredSystemsInput" type="text" value="${escapeHtml((user?.preferred_systems || []).join(", "))}" placeholder="D&D, BG3">
        </div>
        <div class="filter-group">
          <label>Active party</label>
          <select id="accountActivePartyInput">
            <option value="">Не выбрана</option>
            ${parties.map((entry) => `
              <option value="${escapeHtml(String(entry.table_id || ""))}" ${Number(user?.active_party_id || 0) === Number(entry.table_id) ? "selected" : ""}>${escapeHtml(entry.title || "Стол")}</option>
            `).join("")}
          </select>
        </div>
      </div>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:12px;">
        <label class="meta-item" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="accountAllowFriendRequestsInput" type="checkbox" ${user?.allow_friend_requests ? "checked" : ""}>
          allow friend requests
        </label>
        <label class="meta-item" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="accountAllowPartyInvitesInput" type="checkbox" ${user?.allow_party_invites ? "checked" : ""}>
          allow party invites
        </label>
        <label class="meta-item" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="accountAllowProfilePublicInput" type="checkbox" ${user?.allow_profile_view_public ? "checked" : ""}>
          public profile
        </label>
        <label class="meta-item" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="accountShowGmBadgeInput" type="checkbox" ${user?.show_gm_badge ? "checked" : ""}>
          show gm badge
        </label>
      </div>
      <div class="cart-buttons" style="margin-top:12px;">
        <button class="btn btn-primary" type="button" id="accountSaveSettingsBtn">Сохранить настройки</button>
      </div>
    </div>
  `;
}

function renderChatSection() {
  const activeConversation = getActiveConversation();
  const activePeer = getActiveChatPeer();
  const chatEntries = getChatEntries();
  const tradeItems = Array.isArray(ACCOUNT_STATE.tradeInventory) ? ACCOUNT_STATE.tradeInventory : [];
  const currentUser = getCurrentUser() || {};
  const currentMoneyLabel = formatMoneyCp(currentUser?.money_cp_total || 0);
  const currentUserId = Number(currentUser?.id || 0);
  const activePeerName = activePeer?.display_name || activePeer?.nickname || "Выбери диалог";
  const activePeerStatus = activePeer
    ? (activePeer.is_online ? "online" : `last seen ${formatDateTime(activePeer.last_seen_at)}`)
    : "Диалог не выбран";
  const lastMessageStamp = activeConversation?.last_message_at || activeConversation?.updated_at || "";
  const participantRows = [
    {
      user: currentUser,
      title: currentUser?.display_name || currentUser?.nickname || "Ты",
      role: "Ты",
      status: "online",
    },
    activePeer
      ? {
          user: activePeer,
          title: activePeer.display_name || activePeer.nickname || "Игрок",
          role: activePeer.is_online ? "В сети" : "Не в сети",
          status: activePeer.is_online ? "online" : "offline",
        }
      : null,
  ].filter(Boolean);

  return `
    <div class="account-messenger-shell">
      <aside class="cabinet-block account-messenger-list">
        <div class="account-messenger-list-head">
          <div>
            <div class="account-hub-kicker">Direct messages</div>
            <h4 class="account-messenger-title">Чаты</h4>
          </div>
          <button class="btn account-chat-icon-btn" type="button" data-account-refresh-chat="1" title="Обновить" aria-label="Обновить">↻</button>
        </div>

        <div class="account-messenger-list-scroll">
          ${chatEntries.length
            ? chatEntries.map((entry) => {
                const friend = entry?.friend || {};
                const latest = entry?.conversation?.latest_message || null;
                const isActive =
                  String(entry?.conversation?.id || "") === String(ACCOUNT_STATE.activeConversationId || "") ||
                  Number(friend?.id || 0) === Number(ACCOUNT_STATE.activeFriendId || 0);
                const unreadCount = safeNumber(entry?.conversation?.unread_count, 0);
                const preview = latest?.body || friend?.short_status || "Открыть диалог";
                const stamp = entry?.conversation?.last_message_at || entry?.conversation?.updated_at || friend?.last_seen_at || "";
                const stampLabel = stamp ? formatAccountChatTime(stamp) : "";
                return `
                  <button
                    class="account-dialog-row ${isActive ? "account-dialog-row-active" : ""}"
                    type="button"
                    data-account-open-friend="${escapeHtml(String(friend?.id || ""))}"
                  >
                    ${renderAccountChatAvatar(friend)}
                    <span class="account-dialog-main">
                      <span class="account-dialog-topline">
                        <strong>${escapeHtml(friend?.display_name || friend?.nickname || "Диалог")}</strong>
                        <small>${escapeHtml(stampLabel)}</small>
                      </span>
                      <span class="account-dialog-preview">${escapeHtml(preview)}</span>
                      <span class="account-dialog-status ${friend?.is_online ? "account-dialog-status-online" : "account-dialog-status-offline"}">${friend?.is_online ? "online" : "offline"}</span>
                    </span>
                    ${unreadCount > 0 ? `<span class="account-dialog-unread">${escapeHtml(String(unreadCount))}</span>` : ""}
                  </button>
                `;
              }).join("")
            : `
              <div class="account-chat-empty-state">
                <strong>Диалогов пока нет</strong>
                <span>Добавь друга, и direct chat появится здесь.</span>
                <button class="btn" type="button" data-account-section="friends">К друзьям</button>
              </div>
            `}
        </div>
      </aside>

      <section class="cabinet-block account-messenger-panel">
        <header class="account-chat-header">
          <div class="account-chat-peer">
            ${renderAccountChatAvatar(activePeer || {}, "account-chat-avatar account-chat-avatar-large")}
            <div class="account-chat-peer-copy">
              <h4>${escapeHtml(activePeerName)}</h4>
              <span>${activePeer ? `@${escapeHtml(activePeer.nickname || "")} • ${escapeHtml(activePeerStatus)}` : "Слева выбери друга или существующий диалог"}</span>
            </div>
          </div>
          <div class="account-chat-header-actions">
            <button class="btn" type="button" data-account-section="friends">Друзья</button>
            <button class="btn" type="button" data-account-open-trade="${escapeHtml(String(activePeer?.id || ""))}" ${activePeer ? "" : "disabled"}>Обмен</button>
          </div>
        </header>

        <div class="account-chat-pinned">
          <span class="account-chat-pinned-mark">Закреплено</span>
          <span>${escapeHtml(activePeer ? "Личная беседа игрока, обмен и быстрые сообщения." : "Выбери диалог слева, чтобы открыть переписку.")}</span>
          ${lastMessageStamp ? `<small>${escapeHtml(formatDateTime(lastMessageStamp))}</small>` : ""}
        </div>

        <div class="account-chat-thread" aria-live="polite">
          ${ACCOUNT_STATE.messages.length
            ? ACCOUNT_STATE.messages.map((message) => {
                const own = Number(message.sender_user_id) === currentUserId;
                return `
                  <div class="account-message-row ${own ? "account-message-row-own" : "account-message-row-peer"}">
                    ${own ? "" : renderAccountChatAvatar(activePeer || {}, "account-chat-avatar account-chat-avatar-small")}
                    <div class="account-message-bubble">
                      <div class="account-message-body">${escapeHtml(message.body || "")}</div>
                      <div class="account-message-meta">${escapeHtml(formatAccountChatTime(message.created_at))}</div>
                    </div>
                  </div>
                `;
              }).join("")
            : `
              <div class="account-chat-empty-thread">
                <strong>${activePeer ? "Диалог ещё пуст" : "Диалог не выбран"}</strong>
                <span>${activePeer ? "Напиши первым." : "Выбери друга слева, чтобы открыть личные сообщения."}</span>
              </div>
            `}
        </div>

        <footer class="account-chat-composer">
          <textarea id="accountChatMessageInput" rows="1" placeholder="Сообщение..." ${activePeer ? "" : "disabled"}></textarea>
          <button class="btn btn-primary account-chat-send-btn" type="button" id="accountSendMessageBtn" ${activePeer ? "" : "disabled"}>Отправить</button>
        </footer>

        <details class="account-chat-trade-drawer">
          <summary>
            <span>Обмен / Бартер</span>
            <span class="meta-item">Твоё золото: ${escapeHtml(currentMoneyLabel)}</span>
          </summary>
          <div class="account-chat-trade-body">
            <div class="muted account-hub-card-copy">
              ${activePeer ? `Передача другу ${escapeHtml(activePeer.display_name || activePeer.nickname || "игроку")}` : "Сначала выбери друга"}
            </div>

            <div class="profile-grid account-chat-trade-grid">
            <div class="filter-group">
              <label>Передать золото</label>
              <input id="accountTradeGoldInput" type="number" min="0" step="1" placeholder="в медяках" ${activePeer ? "" : "disabled"}>
              <div class="muted account-chat-field-note">Ввод в медяках для точного расчёта.</div>
            </div>
            <div class="filter-group">
              <label>Предмет</label>
              <select id="accountTradeItemSelect" ${activePeer ? "" : "disabled"}>
                <option value="">Не выбран</option>
                ${tradeItems.map((item) => `
                  <option value="${escapeHtml(String(item.item_id || item.id || ""))}">
                    ${escapeHtml(item.name || "Предмет")} ×${escapeHtml(String(item.quantity || 1))}
                  </option>
                `).join("")}
              </select>
            </div>
            <div class="filter-group">
              <label>Количество предмета</label>
              <input id="accountTradeQuantityInput" type="number" min="1" step="1" value="1" ${activePeer ? "" : "disabled"}>
            </div>
          </div>
          <div class="cart-buttons account-chat-trade-actions">
            <button class="btn btn-primary" type="button" id="accountSendTradeBtn" ${activePeer ? "" : "disabled"}>Передать</button>
          </div>
          </div>
        </details>
      </section>

      <aside class="cabinet-block account-messenger-info">
        <div class="account-messenger-info-head">
          <div class="account-hub-kicker">О беседе</div>
          <div class="account-messenger-info-title">${escapeHtml(activePeerName)}</div>
          <div class="account-messenger-info-subtitle">
            ${escapeHtml(activePeer ? "Личные сообщения" : "Диалог не выбран")}
          </div>
        </div>

        <div class="account-messenger-info-card">
          <div class="account-messenger-info-label">Статус</div>
          <strong>${escapeHtml(activePeerStatus)}</strong>
          <span>${escapeHtml(activeConversation ? "conversation active" : "выбери друга или беседу")}</span>
        </div>

        <div class="account-messenger-participants">
          <div class="account-messenger-info-row-head">
            <span>Участники</span>
            <strong>${escapeHtml(String(participantRows.length))}</strong>
          </div>
          ${participantRows.map((entry) => `
            <div class="account-messenger-participant-row">
              ${renderAccountChatAvatar(entry.user, "account-chat-avatar account-chat-avatar-small")}
              <span>
                <strong>${escapeHtml(entry.title)}</strong>
                <small class="account-messenger-participant-${escapeHtml(entry.status)}">${escapeHtml(entry.role)}</small>
              </span>
            </div>
          `).join("")}
        </div>

        <div class="account-messenger-actions">
          <button class="btn" type="button" data-account-section="friends">Друзья</button>
          <button class="btn" type="button" data-account-open-trade="${escapeHtml(String(activePeer?.id || ""))}" ${activePeer ? "" : "disabled"}>Открыть обмен</button>
          <button class="btn" type="button" data-account-section="profile">Профиль</button>
        </div>
      </aside>
    </div>
  `;
}

function renderCurrentSection() {
  if (ACCOUNT_STATE.section === "profile") return renderProfileSection();
  if (ACCOUNT_STATE.section === "friends") return renderFriendsList();
  if (ACCOUNT_STATE.section === "parties") return renderPartiesSection();
  if (ACCOUNT_STATE.section === "characters") return renderCharactersSection();
  if (ACCOUNT_STATE.section === "showcase") return renderShowcaseSection();
  if (ACCOUNT_STATE.section === "trade") return renderTradeSection();
  if (ACCOUNT_STATE.section === "settings") return renderSettingsSection();
  return renderChatSection();
}

function parseCsvInput(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function loadConversations() {
  const payload = await fetchDirectConversations();
  ACCOUNT_STATE.conversations = Array.isArray(payload?.conversations) ? payload.conversations : [];
  if (
    ACCOUNT_STATE.activeFriendId &&
    !ACCOUNT_STATE.activeConversationId
  ) {
    const matching = ACCOUNT_STATE.conversations.find((entry) => Number(entry?.friend?.id || 0) === Number(ACCOUNT_STATE.activeFriendId || 0));
    if (matching) {
      ACCOUNT_STATE.activeConversationId = String(matching.id);
    }
  }
  if (!ACCOUNT_STATE.activeConversationId && ACCOUNT_STATE.conversations.length) {
    ACCOUNT_STATE.activeConversationId = String(ACCOUNT_STATE.conversations[0].id);
    ACCOUNT_STATE.activeFriendId = String(ACCOUNT_STATE.conversations[0]?.friend?.id || "");
  }
}

async function loadMessages(conversationId, { silent = false } = {}) {
  if (!conversationId) {
    ACCOUNT_STATE.messages = [];
    return;
  }
  const payload = await fetchDirectMessages(conversationId);
  ACCOUNT_STATE.messages = Array.isArray(payload?.messages) ? payload.messages : [];
  ACCOUNT_STATE.activeConversationId = String(conversationId);
  ACCOUNT_STATE.activeFriendId = String(getConversationFriendUserId(ACCOUNT_STATE.conversations.find((entry) => String(entry.id) === String(conversationId)) || {}));
  if (!silent) {
    await markConversationRead(conversationId);
  }
}

async function loadTradeInventory() {
  try {
    const payload = await fetchPlayerInventory();
    ACCOUNT_STATE.tradeInventory = Array.isArray(payload?.items) ? payload.items : [];
    if (ACCOUNT_STATE.account?.user && payload && typeof payload === "object") {
      ACCOUNT_STATE.account.user = {
        ...ACCOUNT_STATE.account.user,
        money_cp_total: payload.money_cp_total,
        money_gold: payload.money_gold,
        money_silver: payload.money_silver,
        money_copper: payload.money_copper,
        money_label: payload.money_label,
      };
      syncAccountUser(ACCOUNT_STATE.account.user);
    }
  } catch (_) {
    ACCOUNT_STATE.tradeInventory = [];
  }
}

export async function loadAccountModule() {
  if (!isAuthenticated()) {
    ACCOUNT_STATE.account = null;
    ACCOUNT_STATE.friends = {
      friends: [],
      incoming_requests: [],
      outgoing_requests: [],
    };
    ACCOUNT_STATE.conversations = [];
    ACCOUNT_STATE.messages = [];
    ACCOUNT_STATE.tradeInventory = [];
    ensureChatPolling();
    renderAccountModule();
    return;
  }

  let accountPayload = null;
  let friendsPayload = null;
  try {
    [accountPayload, friendsPayload] = await Promise.all([
      fetchAccount(),
      fetchFriendsState(),
    ]);
  } catch (error) {
    if (isAuthError(error)) {
      ACCOUNT_STATE.account = null;
      ACCOUNT_STATE.friends = {
        friends: [],
        incoming_requests: [],
        outgoing_requests: [],
      };
      ACCOUNT_STATE.conversations = [];
      ACCOUNT_STATE.messages = [];
      ACCOUNT_STATE.tradeInventory = [];
      ensureChatPolling();
      renderAccountModule();
      return;
    }
    throw error;
  }

  ACCOUNT_STATE.account = accountPayload || null;
  syncAccountUser(accountPayload?.user || {});
  ACCOUNT_STATE.friends = friendsPayload || {
    friends: [],
    incoming_requests: [],
    outgoing_requests: [],
  };
  await loadConversations();
  await loadTradeInventory();
  if (ACCOUNT_STATE.activeConversationId) {
    await loadMessages(ACCOUNT_STATE.activeConversationId);
  } else if (!ACCOUNT_STATE.activeFriendId && ACCOUNT_STATE.friends?.friends?.length) {
    ACCOUNT_STATE.activeFriendId = String(ACCOUNT_STATE.friends.friends[0]?.friend?.id || "");
  }
  ACCOUNT_STATE.loaded = true;
  ensureChatPolling();
  renderAccountModule();
}

export function renderAccountModule() {
  const root = getAccountRoot();
  if (!root) return;

  if (!ACCOUNT_STATE.account) {
    root.innerHTML = `
      <div class="cabinet-block">
        <h3 style="margin:0 0 8px 0;">Мой аккаунт</h3>
        <p>Этот раздел доступен после входа в аккаунт.</p>
        <div class="muted">Профиль, друзья, чат и обмен работают только для авторизованного игрока.</div>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="account-hub-shell">
      ${renderAccountHero()}
      ${renderSectionNav()}
      <div class="account-hub-section account-hub-section-${escapeHtml(ACCOUNT_STATE.section)}">
        ${renderCurrentSection()}
      </div>
    </div>
  `;

  bindAccountModuleActions();
  scrollAccountChatToBottom();
}

async function saveProfileSection() {
  const payload = await updateAccount({
    nickname: String(getEl("accountNicknameInput")?.value || "").trim(),
    display_name: String(getEl("accountDisplayNameInput")?.value || "").trim(),
    avatar_url: String(getEl("accountAvatarUrlInput")?.value || "").trim(),
    banner_url: String(getEl("accountBannerUrlInput")?.value || "").trim(),
    short_status: String(getEl("accountShortStatusInput")?.value || "").trim(),
    bio: String(getEl("accountBioInput")?.value || "").trim(),
  });
  ACCOUNT_STATE.account = payload;
  syncAccountUser(payload?.user || {});
  renderAccountModule();
  showToast("Профиль сохранён");
}

async function saveSettingsSection() {
  const payload = await updateAccount({
    preferred_role: String(getEl("accountPreferredRoleInput")?.value || "player"),
    privacy_level: String(getEl("accountPrivacyLevelInput")?.value || "public"),
    allow_direct_messages: String(getEl("accountAllowMessagesInput")?.value || "friends"),
    timezone: String(getEl("accountTimezoneInput")?.value || "UTC").trim(),
    locale: String(getEl("accountLocaleInput")?.value || "ru-RU").trim(),
    profile_tags: parseCsvInput(getEl("accountProfileTagsInput")?.value),
    preferred_systems: parseCsvInput(getEl("accountPreferredSystemsInput")?.value),
    active_party_id: safeNumber(getEl("accountActivePartyInput")?.value, 0) || null,
    allow_friend_requests: Boolean(getEl("accountAllowFriendRequestsInput")?.checked),
    allow_party_invites: Boolean(getEl("accountAllowPartyInvitesInput")?.checked),
    allow_profile_view_public: Boolean(getEl("accountAllowProfilePublicInput")?.checked),
    show_gm_badge: Boolean(getEl("accountShowGmBadgeInput")?.checked),
  });
  ACCOUNT_STATE.account = payload;
  syncAccountUser(payload?.user || {});
  renderAccountModule();
  showToast("Настройки сохранены");
}

async function saveActiveCharacter() {
  const value = document.querySelector('input[name="accountActiveCharacter"]:checked')?.value || "";
  if (!value) {
    showToast("Выбери персонажа");
    return;
  }
  const payload = await updateAccount({
    active_character_id: Number(value),
  });
  ACCOUNT_STATE.account = payload;
  syncAccountUser(payload?.user || {});
  renderAccountModule();
  showToast("Active character обновлён");
}

async function toggleGlobalGmMode() {
  const currentRole = String(getCurrentUser()?.role || "player").trim().toLowerCase();
  const nextUser = currentRole === "gm"
    ? await deactivateGmMode()
    : await activateGmMode();

  syncAccountUser(nextUser || {});
  if (ACCOUNT_STATE.account?.user) {
    ACCOUNT_STATE.account.user = {
      ...ACCOUNT_STATE.account.user,
      ...(nextUser || {}),
    };
  }
  renderAccountModule();
  showToast(currentRole === "gm" ? "Глобальный режим GM выключен" : "Глобальный режим GM включён");
}

async function runFriendSearch() {
  const query = String(getEl("accountFriendsSearchInput")?.value || "").trim();
  ACCOUNT_STATE.searchQuery = query;
  if (!query) {
    ACCOUNT_STATE.searchResults = [];
    renderAccountModule();
    return;
  }
  const payload = await searchAccountUsers(query);
  ACCOUNT_STATE.searchResults = Array.isArray(payload?.users) ? payload.users : [];
  renderAccountModule();
}

async function openConversationByFriendId(friendUserId) {
  friendUserId = Number(friendUserId);
  const existing = ACCOUNT_STATE.conversations.find((entry) => Number(entry?.friend?.id || 0) === friendUserId);
  ACCOUNT_STATE.section = "chat";
  ACCOUNT_STATE.activeFriendId = String(friendUserId);
  await loadTradeInventory();
  if (existing) {
    ACCOUNT_STATE.activeConversationId = String(existing.id);
    await loadMessages(existing.id);
  } else {
    ACCOUNT_STATE.activeConversationId = "";
    ACCOUNT_STATE.messages = [];
    renderAccountModule();
  }
  ensureChatPolling();
  renderAccountModule();
}

async function openTradeByFriendId(friendUserId) {
  ACCOUNT_STATE.section = "trade";
  ACCOUNT_STATE.activeFriendId = String(Number(friendUserId || 0));
  await loadTradeInventory();
  renderAccountModule();
}

async function sendCurrentDirectMessage() {
  const activeConversation = getActiveConversation();
  const friendUserId = activeConversation
    ? getConversationFriendUserId(activeConversation)
    : safeNumber(ACCOUNT_STATE.activeFriendId, 0);
  const body = String(getEl("accountChatMessageInput")?.value || "").trim();
  if (!friendUserId) {
    showToast("Сначала выбери друга");
    return;
  }
  if (!body) {
    showToast("Введите сообщение");
    return;
  }
  await sendDirectMessage(friendUserId, body);
  await loadConversations();
  const refreshed = ACCOUNT_STATE.conversations.find((entry) => Number(entry?.friend?.id || 0) === Number(friendUserId));
  if (refreshed) {
    await loadMessages(refreshed.id);
  }
  renderAccountModule();
}

async function sendTradeToCurrentFriend() {
  const friendUserId = safeNumber(ACCOUNT_STATE.activeFriendId, 0);
  if (!friendUserId) {
    showToast("Сначала выбери друга для обмена");
    return;
  }

  const goldCp = Math.max(0, safeNumber(getEl("accountTradeGoldInput")?.value, 0));
  const itemId = safeNumber(getEl("accountTradeItemSelect")?.value, 0);
  const quantity = Math.max(1, safeNumber(getEl("accountTradeQuantityInput")?.value, 1));

  if (!goldCp && !itemId) {
    showToast("Выбери золото или предмет");
    return;
  }

  const payload = await transferToPlayer({
    target_user_id: friendUserId,
    gold_cp: goldCp,
    item_id: itemId || null,
    quantity,
  });

  if (ACCOUNT_STATE.account?.user) {
    ACCOUNT_STATE.account.user = {
      ...ACCOUNT_STATE.account.user,
      money_cp_total: payload?.money_cp_total ?? ACCOUNT_STATE.account.user.money_cp_total,
      money_gold: payload?.money_gold,
      money_silver: payload?.money_silver,
      money_copper: payload?.money_copper,
      money_label: payload?.money_label,
    };
    syncAccountUser(ACCOUNT_STATE.account.user);
  }

  await loadTradeInventory();
  renderAccountModule();
  showToast("Передача выполнена");
}

function getAccountFileInput(kind) {
  if (kind === "avatar") return getEl("accountAvatarFileInput");
  if (kind === "banner") return getEl("accountBannerFileInput");
  return getEl("accountShowcaseFileInput");
}

async function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function validateImageFile(file, kind) {
  if (!file) throw new Error("Файл не выбран");
  if (!file.type?.startsWith("image/")) throw new Error("Нужен файл изображения");
  const limit = kind === "showcase" ? 8 * 1024 * 1024 : 4 * 1024 * 1024;
  if (Number(file.size || 0) > limit) {
    throw new Error(`Файл слишком большой. Лимит: ${kind === "showcase" ? "8" : "4"} МБ`);
  }
}

async function handleMediaFilePicked(kind) {
  const input = getAccountFileInput(kind);
  const file = input?.files?.[0];
  validateImageFile(file, kind);
  const dataUrl = await readImageFileAsDataUrl(file);
  if (input) {
    input.dataset.previewDataUrl = dataUrl;
    input.dataset.fileName = file.name || `${kind}.png`;
  }
  renderAccountModule();
}

function getPendingMediaData(kind) {
  const input = getAccountFileInput(kind);
  return {
    dataUrl: String(input?.dataset?.previewDataUrl || "").trim(),
    fileName: String(input?.dataset?.fileName || "").trim(),
  };
}

async function uploadPickedMedia(kind) {
  const pending = getPendingMediaData(kind);
  if (!pending.dataUrl) throw new Error("Сначала выбери файл");
  const payload = await uploadAccountMedia({
    kind,
    data_url: pending.dataUrl,
    file_name: pending.fileName || `${kind}.png`,
    caption: kind === "showcase" ? String(getEl("accountShowcaseCaptionInput")?.value || "").trim() : "",
    make_primary: kind === "showcase" && !getProfileMedia().showcase.length,
  });
  const input = getAccountFileInput(kind);
  if (input) {
    input.value = "";
    delete input.dataset.previewDataUrl;
    delete input.dataset.fileName;
  }
  ACCOUNT_STATE.account = payload;
  syncAccountUser(payload?.user || {});
  renderAccountModule();
  showToast(kind === "showcase" ? "Изображение добавлено в витрину" : "Изображение профиля обновлено");
}

async function removeAccountMedia(mediaId) {
  const media = getProfileMedia();
  let payload = null;
  if ((mediaId === "avatar" && !media.avatar && getCurrentUser()?.avatar_url) || (mediaId === "banner" && !media.banner && getCurrentUser()?.banner_url)) {
    payload = await updateAccount({
      avatar_url: mediaId === "avatar" ? "" : undefined,
      banner_url: mediaId === "banner" ? "" : undefined,
    });
  } else {
    payload = await deleteAccountMedia(mediaId);
  }
  ACCOUNT_STATE.account = payload;
  syncAccountUser(payload?.user || {});
  renderAccountModule();
  showToast("Изображение удалено");
}

async function promoteAccountMedia(mediaId) {
  const payload = await setPrimaryAccountMedia(mediaId);
  ACCOUNT_STATE.account = payload;
  syncAccountUser(payload?.user || {});
  renderAccountModule();
  showToast("Обложка витрины обновлена");
}

export function bindAccountModuleActions() {
  document.querySelectorAll("[data-account-section]").forEach((btn) => {
    if (btn.dataset.boundAccountSection === "1") return;
    btn.dataset.boundAccountSection = "1";
    btn.addEventListener("click", async () => {
      ACCOUNT_STATE.section = btn.dataset.accountSection || "profile";
      ensureChatPolling();
      renderAccountModule();
      if (ACCOUNT_STATE.section === "chat") {
        await loadConversations();
        await loadTradeInventory();
        if (ACCOUNT_STATE.activeConversationId) {
          await loadMessages(ACCOUNT_STATE.activeConversationId);
        }
        renderAccountModule();
      }
    });
  });

  getEl("accountSaveProfileBtn")?.addEventListener("click", async () => {
    try {
      await saveProfileSection();
    } catch (error) {
      showToast(error.message || "Не удалось сохранить профиль");
    }
  });

  getEl("accountSaveSettingsBtn")?.addEventListener("click", async () => {
    try {
      await saveSettingsSection();
    } catch (error) {
      showToast(error.message || "Не удалось сохранить настройки");
    }
  });

  getEl("accountSaveActiveCharacterBtn")?.addEventListener("click", async () => {
    try {
      await saveActiveCharacter();
    } catch (error) {
      showToast(error.message || "Не удалось обновить active character");
    }
  });

  getEl("accountFriendsSearchBtn")?.addEventListener("click", async () => {
    try {
      await runFriendSearch();
    } catch (error) {
      showToast(error.message || "Не удалось выполнить поиск");
    }
  });

  document.querySelectorAll("[data-account-send-request]").forEach((btn) => {
    if (btn.dataset.boundAccountSendRequest === "1") return;
    btn.dataset.boundAccountSendRequest = "1";
    btn.addEventListener("click", async () => {
      try {
        await sendFriendRequest({ target_user_id: Number(btn.dataset.accountSendRequest) });
        await loadAccountModule();
        ACCOUNT_STATE.section = "friends";
        renderAccountModule();
        showToast("Заявка отправлена");
      } catch (error) {
        showToast(error.message || "Не удалось отправить заявку");
      }
    });
  });

  document.querySelectorAll("[data-account-accept-request]").forEach((btn) => {
    if (btn.dataset.boundAccountAcceptRequest === "1") return;
    btn.dataset.boundAccountAcceptRequest = "1";
    btn.addEventListener("click", async () => {
      try {
        await acceptFriendRequest(Number(btn.dataset.accountAcceptRequest));
        await loadAccountModule();
        ACCOUNT_STATE.section = "friends";
        renderAccountModule();
      } catch (error) {
        showToast(error.message || "Не удалось принять заявку");
      }
    });
  });

  document.querySelectorAll("[data-account-reject-request]").forEach((btn) => {
    if (btn.dataset.boundAccountRejectRequest === "1") return;
    btn.dataset.boundAccountRejectRequest = "1";
    btn.addEventListener("click", async () => {
      try {
        await rejectFriendRequest(Number(btn.dataset.accountRejectRequest));
        await loadAccountModule();
        ACCOUNT_STATE.section = "friends";
        renderAccountModule();
      } catch (error) {
        showToast(error.message || "Не удалось отклонить заявку");
      }
    });
  });

  document.querySelectorAll("[data-account-cancel-request]").forEach((btn) => {
    if (btn.dataset.boundAccountCancelRequest === "1") return;
    btn.dataset.boundAccountCancelRequest = "1";
    btn.addEventListener("click", async () => {
      try {
        await cancelFriendRequest(Number(btn.dataset.accountCancelRequest));
        await loadAccountModule();
        ACCOUNT_STATE.section = "friends";
        renderAccountModule();
      } catch (error) {
        showToast(error.message || "Не удалось отменить заявку");
      }
    });
  });

  document.querySelectorAll("[data-account-remove-friend]").forEach((btn) => {
    if (btn.dataset.boundAccountRemoveFriend === "1") return;
    btn.dataset.boundAccountRemoveFriend = "1";
    btn.addEventListener("click", async () => {
      try {
        await removeFriend(Number(btn.dataset.accountRemoveFriend));
        await loadAccountModule();
        ACCOUNT_STATE.section = "friends";
        renderAccountModule();
      } catch (error) {
        showToast(error.message || "Не удалось удалить из друзей");
      }
    });
  });

  document.querySelectorAll("[data-account-open-chat]").forEach((btn) => {
    if (btn.dataset.boundAccountOpenChat === "1") return;
    btn.dataset.boundAccountOpenChat = "1";
    btn.addEventListener("click", async () => {
      try {
        await openConversationByFriendId(btn.dataset.accountOpenChat);
      } catch (error) {
        showToast(error.message || "Не удалось открыть чат");
      }
    });
  });

  document.querySelectorAll("[data-account-open-trade]").forEach((btn) => {
    if (btn.dataset.boundAccountOpenTrade === "1") return;
    btn.dataset.boundAccountOpenTrade = "1";
    btn.addEventListener("click", async () => {
      try {
        await openTradeByFriendId(btn.dataset.accountOpenTrade);
      } catch (error) {
        showToast(error.message || "Не удалось открыть обмен");
      }
    });
  });

  document.querySelectorAll("[data-account-open-friend]").forEach((btn) => {
    if (btn.dataset.boundAccountOpenFriend === "1") return;
    btn.dataset.boundAccountOpenFriend = "1";
    btn.addEventListener("click", async () => {
      try {
        await openConversationByFriendId(btn.dataset.accountOpenFriend);
      } catch (error) {
        showToast(error.message || "Не удалось открыть диалог");
      }
    });
  });

  document.querySelectorAll("[data-account-open-conversation]").forEach((btn) => {
    if (btn.dataset.boundAccountOpenConversation === "1") return;
    btn.dataset.boundAccountOpenConversation = "1";
    btn.addEventListener("click", async () => {
      try {
        await loadMessages(btn.dataset.accountOpenConversation);
        renderAccountModule();
      } catch (error) {
        showToast(error.message || "Не удалось загрузить диалог");
      }
    });
  });

  getEl("accountSendMessageBtn")?.addEventListener("click", async () => {
    try {
      await sendCurrentDirectMessage();
    } catch (error) {
      showToast(error.message || "Не удалось отправить сообщение");
    }
  });

  getEl("accountChatMessageInput")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    try {
      await sendCurrentDirectMessage();
    } catch (error) {
      showToast(error.message || "Не удалось отправить сообщение");
    }
  });

  document.querySelectorAll("[data-account-refresh-chat]").forEach((btn) => {
    if (btn.dataset.boundAccountRefreshChat === "1") return;
    btn.dataset.boundAccountRefreshChat = "1";
    btn.addEventListener("click", async () => {
      try {
        await loadConversations();
        if (ACCOUNT_STATE.activeConversationId) {
          await loadMessages(ACCOUNT_STATE.activeConversationId);
        }
        renderAccountModule();
      } catch (error) {
        showToast(error.message || "Не удалось обновить чат");
      }
    });
  });

  getEl("accountSendTradeBtn")?.addEventListener("click", async () => {
    try {
      await sendTradeToCurrentFriend();
    } catch (error) {
      showToast(error.message || "Не удалось выполнить передачу");
    }
  });

  getEl("accountToggleGmModeBtn")?.addEventListener("click", async () => {
    try {
      await toggleGlobalGmMode();
    } catch (error) {
      showToast(error.message || "Не удалось переключить GM mode");
    }
  });

  ["avatar", "banner", "showcase"].forEach((kind) => {
    const input = getAccountFileInput(kind);
    if (input && input.dataset.boundAccountMediaInput !== "1") {
      input.dataset.boundAccountMediaInput = "1";
      input.addEventListener("change", async () => {
        try {
          await handleMediaFilePicked(kind);
          showToast("Превью готово, можно загружать");
        } catch (error) {
          showToast(error.message || "Не удалось подготовить изображение");
        }
      });
    }
  });

  document.querySelectorAll("[data-account-pick-media]").forEach((btn) => {
    if (btn.dataset.boundAccountPickMedia === "1") return;
    btn.dataset.boundAccountPickMedia = "1";
    btn.addEventListener("click", () => {
      getAccountFileInput(btn.dataset.accountPickMedia || "")?.click();
    });
  });

  document.querySelectorAll("[data-account-upload-media]").forEach((btn) => {
    if (btn.dataset.boundAccountUploadMedia === "1") return;
    btn.dataset.boundAccountUploadMedia = "1";
    btn.addEventListener("click", async () => {
      try {
        await uploadPickedMedia(btn.dataset.accountUploadMedia || "");
      } catch (error) {
        showToast(error.message || "Не удалось загрузить изображение");
      }
    });
  });

  document.querySelectorAll("[data-account-delete-media]").forEach((btn) => {
    if (btn.dataset.boundAccountDeleteMedia === "1") return;
    btn.dataset.boundAccountDeleteMedia = "1";
    btn.addEventListener("click", async () => {
      try {
        await removeAccountMedia(btn.dataset.accountDeleteMedia || "");
      } catch (error) {
        showToast(error.message || "Не удалось удалить изображение");
      }
    });
  });

  document.querySelectorAll("[data-account-set-primary-media]").forEach((btn) => {
    if (btn.dataset.boundAccountPrimaryMedia === "1") return;
    btn.dataset.boundAccountPrimaryMedia = "1";
    btn.addEventListener("click", async () => {
      try {
        await promoteAccountMedia(btn.dataset.accountSetPrimaryMedia || "");
      } catch (error) {
        showToast(error.message || "Не удалось обновить обложку");
      }
    });
  });

  document.querySelectorAll("[data-account-section-open]").forEach((btn) => {
    if (btn.dataset.boundAccountSectionOpen === "1") return;
    btn.dataset.boundAccountSectionOpen = "1";
    btn.addEventListener("click", async () => {
      const target = String(btn.dataset.accountSectionOpen || "").trim();
      if (target === "masterroom" && typeof window.cabinetModule?.switchCabinetTab === "function") {
        await window.cabinetModule.switchCabinetTab("masterroom");
      }
    });
  });
}

if (!window.__accountPartySyncBound) {
  window.__accountPartySyncBound = true;
  window.addEventListener("dnd:party:changed", async () => {
    if (!ACCOUNT_STATE.loaded) return;
    try {
      const payload = await fetchAccount();
      ACCOUNT_STATE.account = payload || ACCOUNT_STATE.account;
      syncAccountUser(payload?.user || {});
      if (ACCOUNT_STATE.section === "parties" || ACCOUNT_STATE.section === "trade") {
        await loadTradeInventory();
      }
      renderAccountModule();
    } catch (_) {}
  });
}
