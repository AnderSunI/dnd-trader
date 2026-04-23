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
  fetchTraders,
  markConversationRead,
  rejectFriendRequest,
  removeFriend,
  searchAccountUsers,
  sendDirectMessage,
  sendFriendRequest,
  transferToPlayer,
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
  { key: "parties", label: "Столы / Партии" },
  { key: "characters", label: "Персонажи" },
  { key: "showcase", label: "Витрина" },
  { key: "trade", label: "Обмен" },
  { key: "settings", label: "Настройки" },
  { key: "chat", label: "Чат" },
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

function renderAccountHero() {
  const user = getCurrentUser();
  if (!user) {
    return `<div class="cabinet-block"><p>Профиль не загружен.</p></div>`;
  }

  const avatar = safeText(user.avatar_url || "", "").trim();
  const avatarMarkup = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(user.nickname || "avatar")}" style="width:84px; height:84px; border-radius:22px; object-fit:cover; border:1px solid rgba(255,255,255,0.12);">`
    : `<div style="width:84px; height:84px; border-radius:22px; display:flex; align-items:center; justify-content:center; font-size:1.8rem; font-weight:800; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1);">${escapeHtml((user.nickname || user.email || "U").slice(0, 1).toUpperCase())}</div>`;
  const isGm = String(user.role || "").trim().toLowerCase() === "gm";
  const lssName = getCurrentLssCharacterName();

  return `
    <div class="cabinet-block" style="margin-bottom:12px; overflow:hidden; padding:0;">
      <div style="padding:20px; background:${user.banner_url ? `linear-gradient(rgba(11,18,28,0.60), rgba(11,18,28,0.94)), url('${escapeHtml(user.banner_url)}') center/cover` : "radial-gradient(circle at top left, rgba(79,126,165,0.55), transparent 32%), linear-gradient(135deg, rgba(23,31,43,0.98), rgba(10,15,24,0.98))"}; border:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
          ${avatarMarkup}
          <div style="min-width:220px; flex:1 1 220px;">
            <div class="muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.08em;">Мой аккаунт</div>
            <div style="font-size:1.3rem; font-weight:900; margin-top:4px;">${escapeHtml(user.display_name || user.nickname || user.email || "Игрок")}</div>
            <div class="muted" style="margin-top:4px;">@${escapeHtml(user.nickname || user.username || "player")} • ${escapeHtml(user.email || "")}</div>
            <div class="trader-meta" style="gap:6px; flex-wrap:wrap; margin-top:10px;">
              <span class="meta-item">role: ${escapeHtml(roleBadgeLabel(user))}</span>
              <span class="meta-item">${user.is_online ? "online" : `last seen: ${escapeHtml(formatDateTime(user.last_seen_at))}`}</span>
              <span class="meta-item">created: ${escapeHtml(formatDateTime(user.created_at))}</span>
              ${lssName ? `<span class="meta-item">LSS: ${escapeHtml(lssName)}</span>` : ""}
            </div>
            <div style="margin-top:10px; font-size:0.92rem;">${escapeHtml(user.short_status || "Без статуса")}</div>
            <div class="cart-buttons" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
              <button class="btn ${isGm ? "btn-danger" : "btn-primary"}" type="button" id="accountToggleGmModeBtn">
                ${isGm ? "Переключить в Player" : "Включить GM mode"}
              </button>
              <button class="btn" type="button" data-account-section-open="masterroom">Открыть Master Room</button>
              <button class="btn" type="button" data-account-section="chat">Открыть чат</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSectionNav() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px; padding:12px; background:linear-gradient(180deg, rgba(31,39,53,0.96), rgba(16,22,31,0.96)); border:1px solid rgba(255,255,255,0.06);">
      <div class="cart-buttons" style="gap:8px; flex-wrap:wrap;">
        ${ACCOUNT_SECTIONS.map((section) => `
          <button
            class="btn ${ACCOUNT_STATE.section === section.key ? "active" : ""}"
            type="button"
            style="${ACCOUNT_STATE.section === section.key ? "box-shadow: inset 0 0 0 1px rgba(135,189,255,0.35);" : ""}"
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

  return `
    <div class="cabinet-block">
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;">
        <div class="filter-group">
          <label>Username / nickname</label>
          <input id="accountNicknameInput" type="text" value="${escapeHtml(user.nickname || "")}">
        </div>
        <div class="filter-group">
          <label>Display name</label>
          <input id="accountDisplayNameInput" type="text" value="${escapeHtml(user.display_name || "")}">
        </div>
        <div class="filter-group">
          <label>Avatar URL</label>
          <input id="accountAvatarUrlInput" type="text" value="${escapeHtml(user.avatar_url || "")}" placeholder="https://...">
        </div>
        <div class="filter-group">
          <label>Banner URL</label>
          <input id="accountBannerUrlInput" type="text" value="${escapeHtml(user.banner_url || "")}" placeholder="https://...">
        </div>
        <div class="filter-group" style="grid-column:1 / -1;">
          <label>Короткий статус</label>
          <input id="accountShortStatusInput" type="text" value="${escapeHtml(user.short_status || "")}" placeholder="Во что играю, кого ищу, чем занят">
        </div>
        <div class="filter-group" style="grid-column:1 / -1;">
          <label>О себе</label>
          <textarea id="accountBioInput" rows="4" placeholder="О себе, интересы, стиль игры...">${escapeHtml(user.bio || "")}</textarea>
        </div>
      </div>
      <div class="cart-buttons" style="margin-top:10px;">
        <button class="btn btn-primary" type="button" id="accountSaveProfileBtn">Сохранить профиль</button>
      </div>
    </div>
  `;
}

function renderFriendsSearch() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="profile-grid" style="grid-template-columns:minmax(240px,1fr) auto; gap:10px; align-items:end;">
        <div class="filter-group">
          <label>Поиск игроков</label>
          <input id="accountFriendsSearchInput" type="text" value="${escapeHtml(ACCOUNT_STATE.searchQuery || "")}" placeholder="Ник, display name или email">
        </div>
        <button class="btn" type="button" id="accountFriendsSearchBtn">Найти</button>
      </div>
      <div style="margin-top:10px;">
        ${ACCOUNT_STATE.searchResults.length
          ? ACCOUNT_STATE.searchResults.map((user) => `
              <div class="cabinet-block" style="padding:10px 12px; margin-top:8px;">
                <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
                  <div>
                    <div style="font-weight:800;">${escapeHtml(user.display_name || user.nickname || user.email || "Игрок")}</div>
                    <div class="muted" style="font-size:0.82rem;">@${escapeHtml(user.nickname || user.username || "")} ${user.short_status ? `• ${escapeHtml(user.short_status)}` : ""}</div>
                  </div>
                  ${renderFriendActionButton(user)}
                </div>
              </div>
            `).join("")
          : `<div class="muted">Поиск пока пуст.</div>`}
      </div>
    </div>
  `;
}

function renderFriendsList() {
  const state = ACCOUNT_STATE.friends;
  return `
    ${renderFriendsSearch()}
    <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px;">
      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Друзья</h4>
        ${state.friends.length
          ? state.friends.map((entry) => `
              <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,0.06);">
                <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
                  <div>
                    <div style="font-weight:800;">${escapeHtml(entry.friend?.display_name || entry.friend?.nickname || "Игрок")}</div>
                    <div class="muted" style="font-size:0.82rem;">@${escapeHtml(entry.friend?.nickname || "")} • ${entry.friend?.is_online ? "online" : "offline"}</div>
                  </div>
                  <div class="cart-buttons" style="gap:6px;">
                    <button class="btn" type="button" data-account-open-chat="${escapeHtml(String(entry.friend?.id || ""))}">Чат</button>
                    <button class="btn" type="button" data-account-open-trade="${escapeHtml(String(entry.friend?.id || ""))}">Обмен</button>
                    <button class="btn btn-danger" type="button" data-account-remove-friend="${escapeHtml(String(entry.friend?.id || ""))}">Удалить</button>
                  </div>
                </div>
              </div>
            `).join("")
          : `<div class="muted">Друзей пока нет.</div>`}
      </div>

      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Входящие заявки</h4>
        ${state.incoming_requests.length
          ? state.incoming_requests.map((entry) => `
              <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,0.06);">
                <div style="font-weight:800;">${escapeHtml(entry.user?.display_name || entry.user?.nickname || "Игрок")}</div>
                <div class="muted" style="font-size:0.82rem;">${escapeHtml(entry.message || "Без сообщения")}</div>
                <div class="cart-buttons" style="margin-top:8px; gap:6px;">
                  <button class="btn btn-primary" type="button" data-account-accept-request="${escapeHtml(String(entry.id))}">Принять</button>
                  <button class="btn btn-danger" type="button" data-account-reject-request="${escapeHtml(String(entry.id))}">Отклонить</button>
                </div>
              </div>
            `).join("")
          : `<div class="muted">Входящих заявок нет.</div>`}
      </div>

      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Исходящие заявки</h4>
        ${state.outgoing_requests.length
          ? state.outgoing_requests.map((entry) => `
              <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,0.06);">
                <div style="font-weight:800;">${escapeHtml(entry.user?.display_name || entry.user?.nickname || "Игрок")}</div>
                <div class="muted" style="font-size:0.82rem;">${escapeHtml(entry.message || "Ожидает ответа")}</div>
                <div class="cart-buttons" style="margin-top:8px; gap:6px;">
                  <button class="btn btn-danger" type="button" data-account-cancel-request="${escapeHtml(String(entry.id))}">Отменить</button>
                </div>
              </div>
            `).join("")
          : `<div class="muted">Исходящих заявок нет.</div>`}
      </div>
    </div>
  `;
}

function renderTradeSection() {
  const activePeer = getActiveChatPeer();
  const friends = Array.isArray(ACCOUNT_STATE.friends?.friends) ? ACCOUNT_STATE.friends.friends : [];
  const tradeItems = Array.isArray(ACCOUNT_STATE.tradeInventory) ? ACCOUNT_STATE.tradeInventory : [];
  const currentMoneyLabel = formatMoneyCp(getCurrentUser()?.money_cp_total || 0);

  return `
    <div class="profile-grid" style="grid-template-columns:minmax(280px,0.78fr) minmax(0,1.32fr); gap:12px; align-items:start;">
      <div class="cabinet-block">
        <h4 style="margin:0 0 10px;">Кому передать</h4>
        ${friends.length
          ? friends.map((entry) => `
              <button
                class="btn ${Number(entry?.friend?.id || 0) === Number(ACCOUNT_STATE.activeFriendId || 0) ? "active" : ""}"
                type="button"
                style="width:100%; justify-content:flex-start; margin-bottom:8px;"
                data-account-open-trade="${escapeHtml(String(entry?.friend?.id || ""))}"
              >
                ${escapeHtml(entry?.friend?.display_name || entry?.friend?.nickname || "Друг")}
              </button>
            `).join("")
          : `<div class="muted">Сначала добавь друзей.</div>`}
      </div>

      <div class="cabinet-block">
        <div class="flex-between" style="gap:12px; flex-wrap:wrap; margin-bottom:10px;">
          <div>
            <h4 style="margin:0 0 4px;">${escapeHtml(activePeer?.display_name || activePeer?.nickname || "Обмен с другом")}</h4>
            <div class="muted" style="font-size:0.82rem;">${activePeer ? `@${escapeHtml(activePeer.nickname || "")}` : "Выбери друга слева"}</div>
          </div>
          <span class="meta-item">Твоё золото: ${escapeHtml(currentMoneyLabel)}</span>
        </div>

        <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
          <div class="filter-group">
            <label>Золото</label>
            <input id="accountTradeGoldInput" type="number" min="0" step="1" placeholder="в медяках" ${activePeer ? "" : "disabled"}>
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
        <div class="cart-buttons" style="margin-top:10px;">
          <button class="btn btn-primary" type="button" id="accountSendTradeBtn" ${activePeer ? "" : "disabled"}>Передать</button>
        </div>
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
      <h4 style="margin:0 0 10px;">Мои персонажи</h4>
      ${lssName ? `
        <div class="cabinet-block" style="padding:10px 12px; margin-bottom:10px;">
          <div style="font-weight:800;">Текущий персонаж из LSS</div>
          <div class="muted" style="font-size:0.82rem; margin-top:4px;">${escapeHtml(lssName)}</div>
        </div>
      ` : ""}
      ${characters.length
        ? characters.map((character) => `
            <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,0.06);">
              <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
                <div>
                  <div style="font-weight:800;">${escapeHtml(character.name || "Персонаж")}</div>
                  <div class="muted" style="font-size:0.82rem;">lvl ${escapeHtml(String(character.level || 1))} • ${escapeHtml(character.class_name || "class")} • ${escapeHtml(character.race || "race")}</div>
                </div>
                <label class="meta-item" style="cursor:pointer;">
                  <input type="radio" name="accountActiveCharacter" value="${escapeHtml(String(character.id))}" ${activeCharacterId === Number(character.id) ? "checked" : ""}>
                  active
                </label>
              </div>
            </div>
          `).join("")
        : `<div class="muted">Персонажей пока нет.</div>`}
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
  const currentMoneyLabel = formatMoneyCp(getCurrentUser()?.money_cp_total || 0);
  return `
    <div class="profile-grid" style="grid-template-columns:minmax(280px,0.82fr) minmax(0,1.4fr); gap:12px; align-items:start;">
      <div class="cabinet-block">
        <h4 style="margin:0 0 8px;">Диалоги и друзья</h4>
        ${chatEntries.length
          ? chatEntries.map((entry) => {
              const isActive =
                String(entry?.conversation?.id || "") === String(ACCOUNT_STATE.activeConversationId || "") ||
                Number(entry?.friend?.id || 0) === Number(ACCOUNT_STATE.activeFriendId || 0);
              const buttonStyle = isActive
                ? "width:100%; justify-content:flex-start; margin-bottom:8px; background:linear-gradient(180deg, rgba(61,106,134,0.94), rgba(41,79,104,0.98)); border-color:rgba(134,203,211,0.26); color:rgba(245,249,250,0.98);"
                : "width:100%; justify-content:flex-start; margin-bottom:8px; background:linear-gradient(180deg, rgba(21,31,38,0.94), rgba(12,20,26,0.98)); border-color:rgba(255,255,255,0.08); color:rgba(232,239,241,0.96);";
              const secondaryStyle = isActive
                ? "font-size:0.78rem; color:rgba(232,242,245,0.88);"
                : "font-size:0.78rem; color:rgba(174,191,198,0.88);";
              const tertiaryStyle = isActive
                ? "font-size:0.76rem; color:rgba(214,231,236,0.76);"
                : "font-size:0.76rem; color:rgba(148,167,175,0.82);";
              return `
              <button
                class="btn ${isActive ? "active" : ""}"
                type="button"
                style="${buttonStyle}"
                data-account-open-friend="${escapeHtml(String(entry?.friend?.id || ""))}"
              >
                <span style="display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%;">
                  <span>${escapeHtml(entry?.friend?.display_name || entry?.friend?.nickname || "Диалог")}</span>
                  <span style="${secondaryStyle}">
                    ${escapeHtml(
                      entry?.conversation?.latest_message?.body ||
                      entry?.friend?.short_status ||
                      "Открыть диалог"
                    )}
                  </span>
                  <span style="${tertiaryStyle}">
                    ${entry?.friend?.is_online ? "online" : `last seen: ${escapeHtml(formatDateTime(entry?.friend?.last_seen_at))}`}
                  </span>
                  ${safeNumber(entry?.conversation?.unread_count, 0) > 0 ? `<span class="meta-item">unread: ${escapeHtml(String(entry.conversation.unread_count))}</span>` : ""}
                </span>
              </button>
            `;
            }).join("")
          : `<div class="muted">Диалогов пока нет. Добавь друга и выбери его в списке.</div>`}
      </div>

      <div class="cabinet-block" style="background:linear-gradient(180deg, rgba(16,27,34,0.97), rgba(8,14,20,0.99)); border-color:rgba(134,203,211,0.16);">
        <div class="flex-between" style="gap:12px; flex-wrap:wrap; margin-bottom:10px;">
          <div>
            <h4 style="margin:0 0 4px;">${escapeHtml(activePeer?.display_name || activePeer?.nickname || "Direct chat")}</h4>
            <div class="muted" style="font-size:0.82rem;">
              ${activePeer ? `@${escapeHtml(activePeer.nickname || "")}` : "Выбери друга слева"}
            </div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; min-height:340px; max-height:52vh; overflow:auto; padding:10px 8px 10px 2px; border-radius:16px; background:linear-gradient(180deg, rgba(10,18,24,0.88), rgba(15,24,30,0.92)); border:1px solid rgba(255,255,255,0.06);">
          ${ACCOUNT_STATE.messages.length
            ? ACCOUNT_STATE.messages.map((message) => `
                <div style="align-self:${Number(message.sender_user_id) === Number(getCurrentUser()?.id) ? "flex-end" : "flex-start"}; max-width:min(78%, 560px); padding:10px 12px; border-radius:14px; background:${Number(message.sender_user_id) === Number(getCurrentUser()?.id) ? "linear-gradient(180deg, rgba(61,106,134,0.92), rgba(41,79,104,0.96))" : "linear-gradient(180deg, rgba(35,47,56,0.96), rgba(25,35,43,0.98))"}; border:1px solid ${Number(message.sender_user_id) === Number(getCurrentUser()?.id) ? "rgba(134,203,211,0.24)" : "rgba(255,255,255,0.08)"}; box-shadow:0 8px 18px rgba(0,0,0,0.22);">
                  <div style="white-space:pre-wrap; color:rgba(240,245,247,0.96);">${escapeHtml(message.body || "")}</div>
                  <div style="font-size:0.76rem; margin-top:4px; color:rgba(220,232,236,0.72);">${escapeHtml(formatDateTime(message.created_at))}</div>
                </div>
              `).join("")
            : `<div class="muted">${activePeer ? "Диалог ещё пуст. Напиши первым." : "Слева выбери друга или существующий диалог."}</div>`}
        </div>
        <div style="margin-top:12px;">
          <textarea id="accountChatMessageInput" rows="3" placeholder="Сообщение другу..." ${activePeer ? "" : "disabled"}></textarea>
          <div class="cart-buttons" style="margin-top:8px;">
            <button class="btn btn-primary" type="button" id="accountSendMessageBtn" ${activePeer ? "" : "disabled"}>Отправить</button>
          </div>
        </div>

        <div class="cabinet-block" style="margin-top:12px; padding:12px;">
          <div class="flex-between" style="gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <h4 style="margin:0 0 4px;">Обмен / Бартер</h4>
              <div class="muted" style="font-size:0.82rem;">
                ${activePeer ? `Передача другу ${escapeHtml(activePeer.display_name || activePeer.nickname || "игроку")}` : "Сначала выбери друга"}
              </div>
            </div>
            <span class="meta-item">Твоё золото: ${escapeHtml(currentMoneyLabel)}</span>
          </div>

          <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
            <div class="filter-group">
              <label>Передать золото</label>
              <input id="accountTradeGoldInput" type="number" min="0" step="1" placeholder="в медяках" ${activePeer ? "" : "disabled"}>
              <div class="muted" style="font-size:0.76rem; margin-top:4px;">Ввод в медяках для точного расчёта.</div>
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
          <div class="cart-buttons" style="margin-top:10px;">
            <button class="btn btn-primary" type="button" id="accountSendTradeBtn" ${activePeer ? "" : "disabled"}>Передать</button>
          </div>
        </div>
      </div>
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
    ${renderAccountHero()}
    ${renderSectionNav()}
    ${renderCurrentSection()}
  `;

  bindAccountModuleActions();
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
