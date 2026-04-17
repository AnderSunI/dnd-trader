// ============================================================
// frontend/js/longstoryshort.js
// Long Story Short (LSS)
// - просмотр персонажа
// - импорт JSON / файла
// - локальное сохранение
// - базовое редактирование полей
// - явная загрузка фото: ссылка + локальный файл
// - история отделена и больше не смешивается с LSS
// ============================================================

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const LSS_STATE = {
  raw: null,
  profile: null,
  source: "empty",
  importPanelOpen: false,
  editPanelOpen: false,
  activeTab: "overview",
  dicePanelOpen: false,
  diceType: "d20",
  lastRoll: null,
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getToken() {
  return localStorage.getItem("token") || "";
}

function getHeaders() {
  const token = getToken();
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getSection(id) {
  return document.getElementById(id);
}

function safe(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}


const DND_XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

function getXpProgressData(profile) {
  const info = profile?.info || {};
  const level = Math.max(1, toNumber(unwrapValue(info?.level, 1), 1));
  const xp = Math.max(0, toNumber(unwrapValue(info?.experience, 0), 0));
  const floor = DND_XP_THRESHOLDS[Math.min(level - 1, DND_XP_THRESHOLDS.length - 1)] ?? 0;
  const next = DND_XP_THRESHOLDS[Math.min(level, DND_XP_THRESHOLDS.length - 1)] ?? null;
  const percent = next && next > floor ? Math.max(0, Math.min(100, ((xp - floor) / (next - floor)) * 100)) : 100;
  return { level, xp, floor, next, percent };
}

function getSpellQuickSummary(profile) {
  const ability = getSpellcastingAbility(profile);
  const attack = getSpellAttackBonus(profile);
  const saveDc = getSpellSaveDc(profile);
  const slots = getSpellSlots(profile);
  const totalSlots = slots.reduce((sum, slot) => sum + toNumber(slot.total, 0), 0);
  const freeSlots = slots.reduce((sum, slot) => sum + Math.max(0, toNumber(slot.total, 0) - toNumber(slot.filled, 0)), 0);
  return {
    ability,
    attack,
    saveDc,
    totalSlots,
    freeSlots,
  };
}

function rollSelectedDie(type) {
  const match = String(type || '').match(/d(\d+)/i);
  const sides = match ? Number(match[1]) : 20;
  const result = Math.floor(Math.random() * sides) + 1;
  LSS_STATE.diceType = `d${sides}`;
  LSS_STATE.lastRoll = { type: `d${sides}`, result, at: Date.now() };
  return LSS_STATE.lastRoll;
}

function updateLssProfile(mutator, toastMessage = '') {
  if (!LSS_STATE.profile) return;
  const nextProfile = cloneData(LSS_STATE.profile || {});
  mutator(nextProfile);
  setLssData(nextProfile, { persistLocal: true, source: 'manual' });
  renderLSS();
  if (toastMessage) showToast(toastMessage);
}

function quickAdjustHp(delta) {
  const current = Math.max(0, toNumber(unwrapValue(LSS_STATE.profile?.vitality?.['hp-current'], 0), 0));
  const next = Math.max(0, current + delta);
  if (!confirm(`Изменить текущие хиты: ${current} → ${next}?`)) return;
  updateLssProfile((profile) => {
    profile.vitality = profile.vitality || {};
    profile.vitality['hp-current'] = next;
  }, 'Хиты обновлены');
}

function quickSetHp() {
  const current = Math.max(0, toNumber(unwrapValue(LSS_STATE.profile?.vitality?.['hp-current'], 0), 0));
  const raw = prompt('Текущие хиты персонажа', String(current));
  if (raw === null) return;
  const next = Math.max(0, toNumber(raw, current));
  if (!confirm(`Сохранить текущие хиты: ${current} → ${next}?`)) return;
  updateLssProfile((profile) => {
    profile.vitality = profile.vitality || {};
    profile.vitality['hp-current'] = next;
  }, 'Хиты обновлены');
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cloneData(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function unwrapValue(node, fallback = "") {
  if (node === null || node === undefined) return fallback;

  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  ) {
    return node;
  }

  if (typeof node === "object") {
    if ("value" in node) return unwrapValue(node.value, fallback);
    if ("score" in node) return unwrapValue(node.score, fallback);
    if ("filled" in node && Object.keys(node).length === 1) {
      return unwrapValue(node.filled, fallback);
    }
  }

  return fallback;
}

function capitalizeRu(value) {
  const str = String(value || "");
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getNested(obj, path, fallback = null) {
  try {
    const value = path.split(".").reduce((acc, key) => acc?.[key], obj);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function setNested(obj, path, value) {
  const keys = path.split(".");
  let current = obj;

  keys.forEach((key, index) => {
    const isLast = index === keys.length - 1;

    if (isLast) {
      current[key] = value;
      return;
    }

    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  });
}

function statMod(score) {
  return Math.floor((toNumber(score, 10) - 10) / 2);
}

function formatSigned(num) {
  const n = toNumber(num, 0);
  return n >= 0 ? `+${n}` : `${n}`;
}

function joinNonEmpty(values, separator = ", ") {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(separator);
}

function normalizeSize(value) {
  const raw = String(value || "").trim().toLowerCase();
  const map = {
    tiny: "Крошечный",
    small: "Маленький",
    medium: "Средний",
    large: "Большой",
    huge: "Огромный",
    gargantuan: "Гигантский",
  };
  return map[raw] || safe(value, "—");
}

function getLocalStorageKey() {
  const user = window.__appUser;
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `lssData:${userKey}`;
}

function saveLocalLssRaw(raw) {
  try {
    localStorage.setItem(getLocalStorageKey(), JSON.stringify(raw));
  } catch (_) {}
}

function loadLocalLssRaw() {
  try {
    const raw = localStorage.getItem(getLocalStorageKey());
    if (!raw) return null;
    return tryParseJson(raw);
  } catch {
    return null;
  }
}

function clearLocalLssRaw() {
  try {
    localStorage.removeItem(getLocalStorageKey());
  } catch (_) {}
}

// ------------------------------------------------------------
// 📝 RICH TEXT / TIPTAP
// ------------------------------------------------------------
function extractTipTapDoc(value) {
  if (!value) return null;

  if (value?.type === "doc" && Array.isArray(value.content)) {
    return value;
  }

  if (value?.data?.type === "doc" && Array.isArray(value.data.content)) {
    return value.data;
  }

  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed) return extractTipTapDoc(parsed);
  }

  return null;
}

function tiptapInline(nodes = []) {
  return (nodes || [])
    .map((node) => {
      if (!node) return "";

      if (node.type === "text") {
        let text = escapeHtml(node.text || "");
        const marks = Array.isArray(node.marks) ? node.marks : [];

        marks.forEach((mark) => {
          const type = mark?.type;
          if (type === "bold") text = `<strong>${text}</strong>`;
          else if (type === "italic") text = `<em>${text}</em>`;
          else if (type === "underline") text = `<u>${text}</u>`;
          else if (type === "strike") text = `<s>${text}</s>`;
          else if (type === "link") {
            const href = escapeHtml(mark?.attrs?.href || "#");
            text = `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
          }
        });

        return text;
      }

      if (node.type === "hardBreak") return "<br />";

      return tiptapNode(node);
    })
    .join("");
}

function tiptapNode(node) {
  if (!node || typeof node !== "object") return "";

  if (node.type === "paragraph") {
    const content = tiptapInline(node.content || []);
    return `<p>${content || "&nbsp;"}</p>`;
  }

  if (node.type === "bulletList") {
    return `<ul>${(node.content || []).map(tiptapNode).join("")}</ul>`;
  }

  if (node.type === "orderedList") {
    const start = node.attrs?.start
      ? ` start="${Number(node.attrs.start)}"`
      : "";
    return `<ol${start}>${(node.content || []).map(tiptapNode).join("")}</ol>`;
  }

  if (node.type === "listItem") {
    return `<li>${(node.content || []).map(tiptapNode).join("")}</li>`;
  }

  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level || 3), 1), 6);
    return `<h${level}>${tiptapInline(node.content || [])}</h${level}>`;
  }

  if (node.type === "blockquote") {
    return `<blockquote>${(node.content || []).map(tiptapNode).join("")}</blockquote>`;
  }

  if (node.type === "text") {
    return tiptapInline([node]);
  }

  return (node.content || []).map(tiptapNode).join("");
}

function renderRichText(value, fallback = "—") {
  const doc = extractTipTapDoc(value);
  if (!doc) {
    const plain = safe(
      typeof value === "string" ? value : unwrapValue(value, fallback),
      fallback
    );
    return `<p>${escapeHtml(String(plain))}</p>`;
  }

  return (doc.content || []).map(tiptapNode).join("") || `<p>${escapeHtml(fallback)}</p>`;
}

// ------------------------------------------------------------
// 🖼 IMAGE / META
// ------------------------------------------------------------
function unwrapImageCandidate(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object") {
    const nestedCandidates = [
      value.url,
      value.src,
      value.href,
      value.path,
      value.value,
      value.image,
      value.imageUrl,
      value.avatar,
      value.avatarUrl,
      value.portrait,
      value.photo,
      value.file,
      value.data,
    ];

    for (const candidate of nestedCandidates) {
      const resolved = unwrapImageCandidate(candidate);
      if (resolved) return resolved;
    }
  }

  return "";
}

function normalizeImageUrl(url) {
  const raw = unwrapImageCandidate(url);
  if (!raw) return "";

  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("data:image/") ||
    raw.startsWith("blob:") ||
    raw.startsWith("file:")
  ) {
    return raw;
  }

  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("./")) return raw.slice(1);
  if (raw.startsWith("../")) return raw;
  if (raw.startsWith("static/")) return `/${raw}`;

  return `/static/images/${raw.replace(/^\/+/, "")}`;
}

function getPortraitUrl(profile) {
  const root = profile?.__lssRoot || LSS_STATE.raw || {};
  const rootParsedData =
    typeof root?.data === "string" ? tryParseJson(root.data) : root?.data;

  const candidates = [
    profile?.portrait,
    profile?.portraitUrl,
    profile?.image,
    profile?.imageUrl,
    profile?.avatar,
    profile?.avatarUrl,
    profile?.photo,
    profile?.photoUrl,
    profile?.picture,
    profile?.pictureUrl,
    profile?.pictures?.portrait,
    profile?.pictures?.image,
    profile?.media?.portrait,
    profile?.media?.image,
    profile?.art?.portrait,
    profile?.art?.image,
    profile?.assets?.portrait,
    profile?.assets?.avatar,
    profile?.visual?.portrait,
    profile?.visual?.avatar,
    profile?.info?.portrait,
    profile?.info?.image,
    profile?.cover,
    profile?.coverUrl,
    profile?.exportMeta?.portrait,

    root?.portrait,
    root?.portraitUrl,
    root?.image,
    root?.imageUrl,
    root?.avatar,
    root?.avatarUrl,
    root?.photo,
    root?.photoUrl,
    root?.picture,
    root?.pictureUrl,
    root?.media?.portrait,
    root?.media?.image,

    rootParsedData?.portrait,
    rootParsedData?.portraitUrl,
    rootParsedData?.image,
    rootParsedData?.imageUrl,
    rootParsedData?.avatar,
    rootParsedData?.avatarUrl,
    rootParsedData?.photo,
    rootParsedData?.photoUrl,
    rootParsedData?.picture,
    rootParsedData?.pictureUrl,
    rootParsedData?.media?.portrait,
    rootParsedData?.media?.image,
  ];

  const found = candidates
    .map((candidate) => normalizeImageUrl(candidate))
    .find(Boolean);

  return found || "";
}

function getEdition(profile) {
  return (
    safe(profile?.exportMeta?.edition, "") ||
    safe(profile?.edition, "") ||
    safe(LSS_STATE.raw?.edition, "")
  );
}

function getTagList(profile) {
  const rawTags =
    profile?.exportMeta?.tags ||
    profile?.tags ||
    LSS_STATE.raw?.tags ||
    [];
  return Array.isArray(rawTags) ? rawTags.filter(Boolean) : [];
}

function applyPortraitToProfile(profile, portraitValue) {
  if (!profile || typeof profile !== "object") return profile;
  const next = cloneData(profile);
  next.portrait = portraitValue || "";
  return next;
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------
// 📊 STATS / SKILLS / SAVES
// ------------------------------------------------------------
function getProficiencyBonus(profile) {
  return toNumber(profile?.proficiency, 2);
}

function getStatScore(profile, key) {
  return toNumber(getNested(profile, `stats.${key}.score`, 10), 10);
}

function getStatModifier(profile, key) {
  const score = getStatScore(profile, key);
  const derived = statMod(score);
  const direct = getNested(profile, `stats.${key}.modifier`, null);

  if (direct !== null && direct !== undefined && direct !== "") {
    const directNum = toNumber(direct, derived);
    if (Math.abs(directNum - derived) <= 1) {
      return directNum;
    }
  }

  return derived;
}

function hasSaveProficiency(profile, key) {
  return Boolean(getNested(profile, `saves.${key}.isProf`, false));
}

function getSaveModifier(profile, key) {
  const base = getStatModifier(profile, key);
  return hasSaveProficiency(profile, key)
    ? base + getProficiencyBonus(profile)
    : base;
}

function getSkillModifier(profile, skillKey) {
  const skill = getNested(profile, `skills.${skillKey}`, {});
  const baseStat = skill?.baseStat || "int";
  const prof = toNumber(skill?.isProf, 0);
  const baseMod = getStatModifier(profile, baseStat);
  const proficiency = getProficiencyBonus(profile);

  return baseMod + prof * proficiency;
}

function isSkillProficient(profile, skillKey) {
  return toNumber(getNested(profile, `skills.${skillKey}.isProf`, 0), 0) > 0;
}

function getPassivePerception(profile) {
  return 10 + getSkillModifier(profile, "perception");
}

function getPassiveInsight(profile) {
  return 10 + getSkillModifier(profile, "insight");
}

function getPassiveInvestigation(profile) {
  return 10 + getSkillModifier(profile, "investigation");
}

const STAT_DEFS = [
  { key: "str", label: "Сила" },
  { key: "dex", label: "Ловкость" },
  { key: "con", label: "Телосложение" },
  { key: "int", label: "Интеллект" },
  { key: "wis", label: "Мудрость" },
  { key: "cha", label: "Харизма" },
];

const SKILL_LABELS = {
  acrobatics: "Акробатика",
  athletics: "Атлетика",
  perception: "Восприятие",
  survival: "Выживание",
  performance: "Выступление",
  intimidation: "Запугивание",
  history: "История",
  "sleight of hand": "Ловкость рук",
  arcana: "Магия",
  medicine: "Медицина",
  deception: "Обман",
  nature: "Природа",
  insight: "Проницательность",
  religion: "Религия",
  stealth: "Скрытность",
  persuasion: "Убеждение",
  "animal handling": "Уход за животными",
  investigation: "Анализ",
};

const SKILL_BASE_STATS = {
  athletics: "str",
  acrobatics: "dex",
  "sleight of hand": "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  "animal handling": "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

function getSkillBaseStat(skillKey, profile = null) {
  return getNested(profile, `skills.${skillKey}.baseStat`, SKILL_BASE_STATS[skillKey] || "int");
}

function toggleSkillProficiency(skillKey, enabled) {
  if (!skillKey) return;
  updateLssProfile((profile) => {
    profile.skills = profile.skills || {};
    const prev = profile.skills[skillKey] || {};
    profile.skills[skillKey] = {
      ...prev,
      baseStat: prev.baseStat || getSkillBaseStat(skillKey, profile),
      isProf: enabled ? 1 : 0,
    };
  }, enabled ? "Владение навыком включено" : "Владение навыком отключено");
}

function getSkillsByStat(profile, statKey) {
  const skills = profile?.skills || {};
  return Object.entries(skills)
    .filter(([, skill]) => String(skill?.baseStat || "") === statKey)
    .sort((a, b) => {
      const aLabel = SKILL_LABELS[a[0]] || capitalizeRu(a[0]);
      const bLabel = SKILL_LABELS[b[0]] || capitalizeRu(b[0]);
      return aLabel.localeCompare(bLabel, "ru");
    });
}

// ------------------------------------------------------------
// ⚔️ SPELLCASTING / WEAPONS
// ------------------------------------------------------------
function getSpellcastingAbilityCode(profile) {
  const code = String(getNested(profile, "spellsInfo.base.code", "int") || "int")
    .trim()
    .toLowerCase();
  return ["str", "dex", "con", "int", "wis", "cha"].includes(code)
    ? code
    : "int";
}

function getSpellcastingAbility(profile) {
  const map = {
    str: "Сила",
    dex: "Ловкость",
    con: "Телосложение",
    int: "Интеллект",
    wis: "Мудрость",
    cha: "Харизма",
  };
  return map[getSpellcastingAbilityCode(profile)] || "Интеллект";
}

function getSpellAttackBonus(profile) {
  const abilityCode = getSpellcastingAbilityCode(profile);
  return getStatModifier(profile, abilityCode) + getProficiencyBonus(profile);
}

function getSpellSaveDc(profile) {
  return 8 + getSpellAttackBonus(profile);
}

function getSpellSlots(profile) {
  const spells = profile?.spells || {};
  return Object.keys(spells)
    .filter((key) => key.startsWith("slots-"))
    .map((key) => {
      const level = key.replace("slots-", "");
      const entry = spells[key] || {};
      return {
        level,
        total: toNumber(entry.value, 0),
        filled: toNumber(entry.filled, 0),
      };
    })
    .filter((slot) => slot.total > 0 || slot.filled > 0)
    .sort((a, b) => Number(a.level) - Number(b.level));
}

function getPreparedSpellIds(profile) {
  return Array.isArray(profile?.spellsMeta?.prepared)
    ? profile.spellsMeta.prepared
    : Array.isArray(profile?.spells?.prepared)
      ? profile.spells.prepared
      : Array.isArray(profile?.preparedSpellIds)
        ? profile.preparedSpellIds
        : [];
}

function getBookSpellIds(profile) {
  return Array.isArray(profile?.spellsMeta?.book)
    ? profile.spellsMeta.book
    : Array.isArray(profile?.spells?.book)
      ? profile.spells.book
      : Array.isArray(profile?.spellBookIds)
        ? profile.spellBookIds
        : [];
}

function getSpellDisplayMode(profile) {
  return (
    safe(profile?.spellsMeta?.mode, "") ||
    safe(profile?.spells?.mode, "") ||
    safe(LSS_STATE.raw?.spells?.mode, "") ||
    "list"
  );
}

function weaponAttackBonus(profile, weapon) {
  const ability = String(weapon?.ability || "str").toLowerCase();
  const abilityMod = getStatModifier(profile, ability);
  const prof = weapon?.isProf ? getProficiencyBonus(profile) : 0;
  const extra = toNumber(weapon?.modBonus?.value ?? weapon?.modBonus ?? 0, 0);
  const computed = abilityMod + prof + extra;

  const explicitRaw = weapon?.mod?.value;
  if (explicitRaw !== undefined && explicitRaw !== null && explicitRaw !== "") {
    const cleaned = String(explicitRaw).replace(/[^\d+-]/g, "");
    const explicit = toNumber(cleaned, computed);

    if (explicit === 0 && computed !== 0) return computed;
    if (Math.abs(explicit - computed) <= 1) return explicit;
  }

  return computed;
}

function normalizeWeaponDamage(weapon) {
  return safe(unwrapValue(weapon?.dmg, "—"), "—");
}

function normalizeWeaponName(weapon) {
  return safe(unwrapValue(weapon?.name, "Без названия"), "Без названия");
}

function getSpellCardsExpanded(profile) {
  const candidates = [
    profile?.spellCards,
    profile?.spellsCards,
    profile?.spellsMeta?.cards,
    profile?.spellsMeta?.preparedExpanded,
    profile?.spellsMeta?.bookExpanded,
    profile?.preparedSpellsExpanded,
    profile?.bookSpellsExpanded,
    profile?.spellsExpanded,
    profile?.spellbook,
    profile?.spellsList,
    LSS_STATE.raw?.spellCards,
    LSS_STATE.raw?.spellsCards,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }

  return [];
}

function normalizeSpellCard(card, index = 0) {
  if (!card || typeof card !== "object") {
    return {
      id: `spell-${index}`,
      name: `Заклинание ${index + 1}`,
      level: "",
      school: "",
      time: "",
      range: "",
      duration: "",
      components: "",
      description: "",
      notes: "",
    };
  }

  return {
    id: card.id || card._id || card.slug || `spell-${index}`,
    name: card.name || card.title || card.label || `Заклинание ${index + 1}`,
    level: card.level ?? card.circle ?? card.tier ?? "",
    school: card.school || card.schoolName || card.type || "",
    time: card.castingTime || card.time || card.castTime || "",
    range: card.range || card.distance || "",
    duration: card.duration || card.length || "",
    components: joinNonEmpty([card.components, card.materials]),
    description: card.description || card.text || card.effect || card.body || "",
    notes: card.notes || card.meta || "",
  };
}

// ------------------------------------------------------------
// 🔄 NORMALIZATION
// ------------------------------------------------------------
function normalizeProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") return null;

  if (rawProfile.info && rawProfile.stats && rawProfile.vitality) {
    return {
      ...rawProfile,
      spellsMeta: rawProfile.spellsMeta || rawProfile.spells || {},
      __lssRoot: rawProfile.__lssRoot || rawProfile,
    };
  }

  if (rawProfile.profile && typeof rawProfile.profile === "object") {
    return normalizeProfile(rawProfile.profile);
  }

  if (typeof rawProfile.data === "string") {
    const parsed = tryParseJson(rawProfile.data);
    if (parsed && typeof parsed === "object") {
      return {
        ...parsed,
        spellsMeta: rawProfile.spells || {},
        exportMeta: {
          tags: rawProfile.tags || [],
          edition: rawProfile.edition || "",
        },
        __lssRoot: rawProfile,
      };
    }
  }

  return {
    ...rawProfile,
    __lssRoot: rawProfile,
  };
}

// ------------------------------------------------------------
// 📡 LOAD PROFILE
// ------------------------------------------------------------
async function tryLoadFromApi() {
  const token = getToken();
  if (!token) return null;

  const urls = [
    "/player/profile",
    "/player/lss",
    "/lss/me",
    "/character/me",
    "/profile/me",
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) continue;

      const data = await res.json();
      if (!data) continue;

      return data.profile || data.character || data.lss || data;
    } catch (_) {}
  }

  return null;
}

function tryLoadFromWindow() {
  const candidates = [
    window.__LSS_EXPORT__,
    window.__lssExport,
    window.__PLAYER_LSS__,
    window.__playerLss,
    window.__CHARACTER_EXPORT__,
    window.__characterExport,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

function tryLoadFromLocal() {
  return loadLocalLssRaw();
}

export async function loadLSS() {
  let raw = await tryLoadFromApi();
  let source = "api";

  if (!raw) {
    raw = tryLoadFromWindow();
    source = "window";
  }

  if (!raw) {
    raw = tryLoadFromLocal();
    source = "local";
  }

  if (!raw) {
    LSS_STATE.raw = null;
    LSS_STATE.profile = null;
    LSS_STATE.source = "empty";
    return;
  }

  const profile = normalizeProfile(raw);

  LSS_STATE.raw = raw;
  LSS_STATE.profile = profile;
  LSS_STATE.source = source;
}

// ------------------------------------------------------------
// 🛠 EDIT HELPERS
// ------------------------------------------------------------
function ensureEditableProfileBase() {
  const profile = cloneData(LSS_STATE.profile || {});
  if (!profile.info) profile.info = {};
  if (!profile.subInfo) profile.subInfo = {};
  if (!profile.vitality) profile.vitality = {};
  if (!profile.stats) profile.stats = {};
  if (!profile.spells) profile.spells = {};
  return profile;
}

function applyBasicFormToProfile(formData) {
  const profile = ensureEditableProfileBase();

  profile.name = safeText(formData.name, profile.name || "");
  setNested(profile, "info.charClass", safeText(formData.charClass, getNested(profile, "info.charClass", "")));
  setNested(profile, "info.charSubclass", safeText(formData.charSubclass, getNested(profile, "info.charSubclass", "")));
  setNested(profile, "info.level", toNumber(formData.level, getNested(profile, "info.level", 1)));
  setNested(profile, "info.background", safeText(formData.background, getNested(profile, "info.background", "")));
  setNested(profile, "info.race", safeText(formData.race, getNested(profile, "info.race", "")));
  setNested(profile, "info.alignment", safeText(formData.alignment, getNested(profile, "info.alignment", "")));
  setNested(profile, "info.size", safeText(formData.size, getNested(profile, "info.size", "")));
  setNested(profile, "info.experience", safeText(formData.experience, getNested(profile, "info.experience", "")));

  setNested(profile, "subInfo.age", safeText(formData.age, getNested(profile, "subInfo.age", "")));
  setNested(profile, "subInfo.height", safeText(formData.height, getNested(profile, "subInfo.height", "")));
  setNested(profile, "subInfo.weight", safeText(formData.weight, getNested(profile, "subInfo.weight", "")));
  setNested(profile, "subInfo.eyes", safeText(formData.eyes, getNested(profile, "subInfo.eyes", "")));
  setNested(profile, "subInfo.skin", safeText(formData.skin, getNested(profile, "subInfo.skin", "")));
  setNested(profile, "subInfo.hair", safeText(formData.hair, getNested(profile, "subInfo.hair", "")));

  setNested(profile, "vitality.hp-current", safeText(formData.hpCurrent, getNested(profile, "vitality.hp-current", "")));
  setNested(profile, "vitality.hp-max", safeText(formData.hpMax, getNested(profile, "vitality.hp-max", "")));
  setNested(profile, "vitality.hp-temp", safeText(formData.hpTemp, getNested(profile, "vitality.hp-temp", "")));
  setNested(profile, "vitality.ac", safeText(formData.ac, getNested(profile, "vitality.ac", "")));
  setNested(profile, "vitality.speed", safeText(formData.speed, getNested(profile, "vitality.speed", "")));
  setNested(profile, "vitality.initiative", safeText(formData.initiative, getNested(profile, "vitality.initiative", "")));

  profile.portrait = safeText(formData.portrait, profile.portrait || "");
  profile.appearance = safeText(formData.appearance, profile.appearance || "");
  profile.background = safeText(formData.backgroundText, profile.background || "");
  profile.personality = safeText(formData.personality, profile.personality || "");
  profile.ideals = safeText(formData.ideals, profile.ideals || "");
  profile.bonds = safeText(formData.bonds, profile.bonds || "");
  profile.flaws = safeText(formData.flaws, profile.flaws || "");
  profile.equipment = safeText(formData.equipment, profile.equipment || "");
  profile.prof = safeText(formData.proficiencies, profile.prof || "");
  profile.allies = safeText(formData.allies, profile.allies || "");
  profile.quests = safeText(formData.goals, profile.quests || "");
  profile.attacks = safeText(formData.features, profile.attacks || "");
  profile["notes-1"] = safeText(formData.notes1, profile["notes-1"] || "");
  profile["notes-2"] = safeText(formData.notes2, profile["notes-2"] || "");

  return profile;
}

function collectEditFormData() {
  const fields = [
    "name",
    "charClass",
    "charSubclass",
    "level",
    "background",
    "race",
    "alignment",
    "size",
    "experience",
    "age",
    "height",
    "weight",
    "eyes",
    "skin",
    "hair",
    "hpCurrent",
    "hpMax",
    "hpTemp",
    "ac",
    "speed",
    "initiative",
    "portrait",
    "appearance",
    "backgroundText",
    "personality",
    "ideals",
    "bonds",
    "flaws",
    "equipment",
    "proficiencies",
    "allies",
    "goals",
    "features",
    "notes1",
    "notes2",
  ];

  const result = {};
  fields.forEach((key) => {
    result[key] = safeText(getSection(`lssEdit_${key}`)?.value, "");
  });
  return result;
}

function setPortraitFieldValue(value) {
  const input = getSection("lssEdit_portrait");
  if (input) input.value = value || "";
}

function savePortraitImmediately(portraitValue) {
  if (!LSS_STATE.profile) {
    showToast("Сначала загрузи LSS-данные");
    return;
  }

  const nextProfile = applyPortraitToProfile(LSS_STATE.profile, portraitValue || "");
  setLssData(nextProfile, { persistLocal: true, source: "manual" });
  LSS_STATE.editPanelOpen = true;
  renderLSS();
}

async function handlePortraitFile(file) {
  if (!file) return;

  if (!file.type?.startsWith("image/")) {
    showToast("Выбери файл изображения");
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    savePortraitImmediately(dataUrl);
    showToast("Фото персонажа загружено");
  } catch (error) {
    console.error(error);
    showToast("Не удалось загрузить фото");
  }
}

// ------------------------------------------------------------
// 🎨 IMPORT / EDIT PANELS
// ------------------------------------------------------------
function getPrettyRawPreview() {
  if (!LSS_STATE.raw) return "";
  try {
    return JSON.stringify(LSS_STATE.raw, null, 2);
  } catch {
    return "";
  }
}

function renderTopToolbar() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px 0;">📖 Long Story Short</h3>
          <div class="muted">
            Игровой лист персонажа: импорт, конструктор, быстрые изменения и бросок кубов доступны прямо здесь.
          </div>
        </div>

        <div class="cart-buttons" style="flex-wrap:wrap;">
          <button class="btn btn-primary" type="button" id="lssToggleImportBtn">
            ${LSS_STATE.importPanelOpen ? "Скрыть импорт" : "Загрузить данные"}
          </button>
          <button class="btn" type="button" id="lssToggleEditBtn" ${LSS_STATE.profile ? "" : "disabled"}>
            ${LSS_STATE.editPanelOpen ? "Скрыть конструктор" : "🛠 Конструктор"}
          </button>
          <button class="btn" type="button" id="lssDiceToggleBtn" ${LSS_STATE.profile ? "" : "disabled"}>
            ${LSS_STATE.dicePanelOpen ? "Скрыть кубы" : "🎲 Кубы"}
          </button>
          ${
            LSS_STATE.profile
              ? `<button class="btn btn-danger" type="button" id="lssClearDataBtn">Очистить LSS</button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function renderImportPanel() {
  return `
    <div class="cabinet-block" id="lssImportPanel" style="${LSS_STATE.importPanelOpen ? "" : "display:none;"} margin-bottom:12px;">
      <h4 style="margin-bottom:10px;">Импорт LSS</h4>

      <div class="filter-group" style="margin-bottom:10px;">
        <label for="lssJsonTextarea">Вставь JSON экспорт LSS</label>
        <textarea
          id="lssJsonTextarea"
          rows="10"
          placeholder='Сюда можно вставить JSON целиком'
        >${escapeHtml(LSS_STATE.importPanelOpen ? getPrettyRawPreview() : "")}</textarea>
      </div>

      <div class="modal-actions" style="margin-top:10px; flex-wrap:wrap; gap:8px;">
        <button class="btn btn-success" type="button" id="lssApplyJsonBtn">Применить JSON</button>
        <button class="btn" type="button" id="lssOpenFileBtn">Загрузить JSON-файл</button>
        <input
          id="lssFileInput"
          type="file"
          accept=".json,application/json,text/plain"
          style="display:none;"
        />
      </div>

      <div class="muted" style="margin-top:10px;">
        Поддерживается экспорт LSS целиком. Сырые технические поля в пользовательском слое стараемся не показывать.
      </div>
    </div>
  `;
}

function renderEditPanel(profile) {
  const p = profile || {};
  const info = p.info || {};
  const subInfo = p.subInfo || {};
  const vitality = p.vitality || {};
  const portraitUrl = getPortraitUrl(p);

  return `
    <div class="cabinet-block" id="lssEditPanel" style="${LSS_STATE.editPanelOpen ? "" : "display:none;"} margin-bottom:12px;">
      <h4 style="margin-bottom:10px;">Редактор базовых полей LSS</h4>

      <div class="profile-grid">
        <div class="filter-group">
          <label>Имя</label>
          <input id="lssEdit_name" type="text" value="${escapeHtml(safeText(unwrapValue(p.name, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Класс</label>
          <input id="lssEdit_charClass" type="text" value="${escapeHtml(safeText(unwrapValue(info.charClass, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Подкласс</label>
          <input id="lssEdit_charSubclass" type="text" value="${escapeHtml(safeText(unwrapValue(info.charSubclass, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Уровень</label>
          <input id="lssEdit_level" type="number" min="1" value="${escapeHtml(safeText(unwrapValue(info.level, "1"), "1"))}" />
        </div>
        <div class="filter-group">
          <label>Раса</label>
          <input id="lssEdit_race" type="text" value="${escapeHtml(safeText(unwrapValue(info.race, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Предыстория</label>
          <input id="lssEdit_background" type="text" value="${escapeHtml(safeText(unwrapValue(info.background, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Мировоззрение</label>
          <input id="lssEdit_alignment" type="text" value="${escapeHtml(safeText(unwrapValue(info.alignment, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Размер</label>
          <input id="lssEdit_size" type="text" value="${escapeHtml(safeText(unwrapValue(info.size, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Опыт</label>
          <input id="lssEdit_experience" type="text" value="${escapeHtml(safeText(unwrapValue(info.experience, ""), ""))}" />
        </div>

        <div class="filter-group">
          <label>Возраст</label>
          <input id="lssEdit_age" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.age, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Рост</label>
          <input id="lssEdit_height" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.height, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Вес</label>
          <input id="lssEdit_weight" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.weight, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Глаза</label>
          <input id="lssEdit_eyes" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.eyes, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Кожа</label>
          <input id="lssEdit_skin" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.skin, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Волосы</label>
          <input id="lssEdit_hair" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.hair, ""), ""))}" />
        </div>

        <div class="filter-group">
          <label>HP текущие</label>
          <input id="lssEdit_hpCurrent" type="text" value="${escapeHtml(safeText(unwrapValue(vitality["hp-current"], ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>HP максимум</label>
          <input id="lssEdit_hpMax" type="text" value="${escapeHtml(safeText(unwrapValue(vitality["hp-max"], ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>HP временные</label>
          <input id="lssEdit_hpTemp" type="text" value="${escapeHtml(safeText(unwrapValue(vitality["hp-temp"], ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>КБ</label>
          <input id="lssEdit_ac" type="text" value="${escapeHtml(safeText(unwrapValue(vitality.ac, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Скорость</label>
          <input id="lssEdit_speed" type="text" value="${escapeHtml(safeText(unwrapValue(vitality.speed, ""), ""))}" />
        </div>
        <div class="filter-group">
          <label>Инициатива</label>
          <input id="lssEdit_initiative" type="text" value="${escapeHtml(safeText(unwrapValue(vitality.initiative, ""), ""))}" />
        </div>
      </div>

      <div class="cabinet-block" style="margin-top:12px;">
        <h4 style="margin-bottom:10px;">Фото персонажа</h4>

        <div class="profile-grid" style="align-items:start;">
          <div>
            ${
              portraitUrl
                ? `
                  <div class="trader-modal-image-wrap" style="max-width:220px;">
                    <img
                      class="trader-modal-image"
                      src="${escapeHtml(portraitUrl)}"
                      alt="Фото персонажа"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      onerror="this.closest('.trader-modal-image-wrap')?.insertAdjacentHTML('afterend','<div class=&quot;stat-box&quot; style=&quot;min-height:220px;display:flex;align-items:center;justify-content:center;font-size:48px;&quot;>🧙</div>'); this.closest('.trader-modal-image-wrap')?.remove();"
                    />
                  </div>
                `
                : `
                  <div class="stat-box" style="min-height:220px;display:flex;align-items:center;justify-content:center;font-size:48px;">
                    🧙
                  </div>
                `
            }
          </div>

          <div>
            <div class="filter-group">
              <label>Ссылка на фото / data:image</label>
              <input
                id="lssEdit_portrait"
                type="text"
                value="${escapeHtml(safeText(portraitUrl, ""))}"
                placeholder="https://... или data:image/..."
              />
            </div>

            <div class="modal-actions" style="margin-top:10px;">
              <button class="btn btn-primary" type="button" id="lssPickImageBtn">Выбрать фото</button>
              <button class="btn" type="button" id="lssApplyPortraitBtn">Применить ссылку</button>
              <button class="btn btn-danger" type="button" id="lssClearImageBtn">Убрать фото</button>
              <input id="lssImageFileInput" type="file" accept="image/*" style="display:none;" />
            </div>

            <div class="muted" style="margin-top:10px;">
              Можно вставить ссылку на картинку или выбрать локальный файл. Локальное фото сохранится в браузере.
            </div>
          </div>
        </div>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Внешность</label>
        <textarea id="lssEdit_appearance" rows="4">${escapeHtml(safeText(p.appearance, ""))}</textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Предыстория / лор</label>
        <textarea id="lssEdit_backgroundText" rows="4">${escapeHtml(safeText(p.background, ""))}</textarea>
      </div>

      <div class="profile-grid" style="margin-top:12px;">
        <div class="filter-group">
          <label>Личность</label>
          <textarea id="lssEdit_personality" rows="4">${escapeHtml(safeText(p.personality, ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Идеалы</label>
          <textarea id="lssEdit_ideals" rows="4">${escapeHtml(safeText(p.ideals, ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Привязанности</label>
          <textarea id="lssEdit_bonds" rows="4">${escapeHtml(safeText(p.bonds, ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Изъяны</label>
          <textarea id="lssEdit_flaws" rows="4">${escapeHtml(safeText(p.flaws, ""))}</textarea>
        </div>
      </div>

      <div class="profile-grid" style="margin-top:12px;">
        <div class="filter-group">
          <label>Снаряжение</label>
          <textarea id="lssEdit_equipment" rows="4">${escapeHtml(safeText(p.equipment, ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Владения / языки</label>
          <textarea id="lssEdit_proficiencies" rows="4">${escapeHtml(safeText(p.prof, ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Союзники</label>
          <textarea id="lssEdit_allies" rows="4">${escapeHtml(safeText(p.allies, ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Цели / задачи</label>
          <textarea id="lssEdit_goals" rows="4">${escapeHtml(safeText(p.quests, ""))}</textarea>
        </div>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Особенности / классовые черты</label>
        <textarea id="lssEdit_features" rows="4">${escapeHtml(safeText(p.attacks, ""))}</textarea>
      </div>

      <div class="profile-grid" style="margin-top:12px;">
        <div class="filter-group">
          <label>Заметка 1</label>
          <textarea id="lssEdit_notes1" rows="4">${escapeHtml(safeText(p["notes-1"], ""))}</textarea>
        </div>
        <div class="filter-group">
          <label>Заметка 2</label>
          <textarea id="lssEdit_notes2" rows="4">${escapeHtml(safeText(p["notes-2"], ""))}</textarea>
        </div>
      </div>

      <div class="modal-actions" style="margin-top:12px;">
        <button class="btn btn-success" type="button" id="lssSaveEditBtn">Сохранить поля</button>
      </div>

      <div class="muted" style="margin-top:10px;">
        Сейчас редактируются базовые поля листа. Оружие и заклинания пока безопаснее держать через импорт JSON, чтобы не ломать структуру.
      </div>
    </div>
  `;
}

async function readFileAsText(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsText(file);
  });
}

function bindLssActions() {
  const toggleImportBtn = getSection("lssToggleImportBtn");
  const toggleEditBtn = getSection("lssToggleEditBtn");
  const clearBtn = getSection("lssClearDataBtn");
  const applyBtn = getSection("lssApplyJsonBtn");
  const openFileBtn = getSection("lssOpenFileBtn");
  const fileInput = getSection("lssFileInput");
  const jsonTextarea = getSection("lssJsonTextarea");
  const saveEditBtn = getSection("lssSaveEditBtn");

  const pickImageBtn = getSection("lssPickImageBtn");
  const applyPortraitBtn = getSection("lssApplyPortraitBtn");
  const clearImageBtn = getSection("lssClearImageBtn");
  const imageFileInput = getSection("lssImageFileInput");

  if (toggleImportBtn && toggleImportBtn.dataset.bound !== "1") {
    toggleImportBtn.dataset.bound = "1";
    toggleImportBtn.addEventListener("click", () => {
      LSS_STATE.importPanelOpen = !LSS_STATE.importPanelOpen;
      renderLSS();
    });
  }

  if (toggleEditBtn && toggleEditBtn.dataset.bound !== "1") {
    toggleEditBtn.dataset.bound = "1";
    toggleEditBtn.addEventListener("click", () => {
      if (!LSS_STATE.profile) return;
      LSS_STATE.editPanelOpen = !LSS_STATE.editPanelOpen;
      renderLSS();
      if (LSS_STATE.editPanelOpen) {
        setTimeout(() => {
          getSection("lssEditPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
    });
  }

  if (clearBtn && clearBtn.dataset.bound !== "1") {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", () => {
      const ok = confirm("Очистить текущие LSS-данные?");
      if (!ok) return;
      clearLssData();
      LSS_STATE.importPanelOpen = false;
      LSS_STATE.editPanelOpen = false;
      renderLSS();
      showToast("LSS-данные очищены");
    });
  }

  if (applyBtn && applyBtn.dataset.bound !== "1") {
    applyBtn.dataset.bound = "1";
    applyBtn.addEventListener("click", () => {
      const rawText = jsonTextarea?.value?.trim() || "";
      if (!rawText) {
        showToast("Вставь JSON экспорт LSS");
        return;
      }

      const parsed = tryParseJson(rawText);
      if (!parsed || typeof parsed !== "object") {
        showToast("JSON не распознан");
        return;
      }

      setLssData(parsed, { persistLocal: true, source: "manual" });
      LSS_STATE.importPanelOpen = false;
      renderLSS();
      showToast("LSS-данные загружены");
    });
  }

  if (openFileBtn && openFileBtn.dataset.bound !== "1") {
    openFileBtn.dataset.bound = "1";
    openFileBtn.addEventListener("click", () => {
      fileInput?.click();
    });
  }

  if (fileInput && fileInput.dataset.bound !== "1") {
    fileInput.dataset.bound = "1";
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      try {
        const text = await readFileAsText(file);
        const parsed = tryParseJson(text);

        if (!parsed || typeof parsed !== "object") {
          showToast("Файл не содержит валидный JSON");
          return;
        }

        setLssData(parsed, { persistLocal: true, source: "manual" });
        LSS_STATE.importPanelOpen = false;
        renderLSS();
        showToast("LSS-файл загружен");
      } catch (error) {
        console.error(error);
        showToast("Не удалось загрузить файл");
      } finally {
        fileInput.value = "";
      }
    });
  }

  if (saveEditBtn && saveEditBtn.dataset.bound !== "1") {
    saveEditBtn.dataset.bound = "1";
    saveEditBtn.addEventListener("click", () => {
      const formData = collectEditFormData();
      const nextProfile = applyBasicFormToProfile(formData);

      setLssData(nextProfile, { persistLocal: true, source: "manual" });
      LSS_STATE.editPanelOpen = false;
      renderLSS();
      showToast("Поля LSS сохранены");
    });
  }

  [getSection("lssDiceToggleBtn"), getSection("lssDiceToggleInlineBtn")].forEach((btn) => {
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (!LSS_STATE.profile) return;
      LSS_STATE.dicePanelOpen = !LSS_STATE.dicePanelOpen;
      renderLSS();
    });
  });

  document.querySelectorAll("[data-lss-roll-die]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const die = btn.dataset.lssRollDie || "d20";
      const roll = rollSelectedDie(die);
      renderLSS();
      showToast(`Бросок ${String(roll.type).toUpperCase()}: ${roll.result}`);
    });
  });

  [getSection("lssQuickEditBtn"), getSection("lssQuickEditBtnCompact")].forEach((quickEditBtn) => {
    if (!quickEditBtn || quickEditBtn.dataset.bound === "1") return;
    quickEditBtn.dataset.bound = "1";
    quickEditBtn.addEventListener("click", () => {
      if (!LSS_STATE.profile) return;
      LSS_STATE.editPanelOpen = !LSS_STATE.editPanelOpen;
      renderLSS();
      if (LSS_STATE.editPanelOpen) {
        setTimeout(() => {
          getSection("lssEditPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
    });
  });

  document.querySelectorAll("[data-lss-hp-action]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const action = btn.dataset.lssHpAction;
      if (action === "minus") quickAdjustHp(-1);
      else if (action === "plus") quickAdjustHp(1);
      else if (action === "set") quickSetHp();
    });
  });

  document.querySelectorAll("[data-lss-tab]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      LSS_STATE.activeTab = btn.dataset.lssTab || "overview";
      renderLSS();
    });
  });

  document.querySelectorAll("[data-lss-skill-prof]").forEach((input) => {
    if (input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", () => {
      const skillKey = input.dataset.lssSkillProf || "";
      toggleSkillProficiency(skillKey, Boolean(input.checked));
    });
  });

  if (pickImageBtn && pickImageBtn.dataset.bound !== "1") {
    pickImageBtn.dataset.bound = "1";
    pickImageBtn.addEventListener("click", () => {
      imageFileInput?.click();
    });
  }

  if (imageFileInput && imageFileInput.dataset.bound !== "1") {
    imageFileInput.dataset.bound = "1";
    imageFileInput.addEventListener("change", async () => {
      const file = imageFileInput.files?.[0];
      if (!file) return;

      try {
        await handlePortraitFile(file);
      } finally {
        imageFileInput.value = "";
      }
    });
  }

  if (applyPortraitBtn && applyPortraitBtn.dataset.bound !== "1") {
    applyPortraitBtn.dataset.bound = "1";
    applyPortraitBtn.addEventListener("click", () => {
      const value = safeText(getSection("lssEdit_portrait")?.value, "").trim();

      if (!value) {
        showToast("Вставь ссылку на изображение или выбери файл");
        return;
      }

      savePortraitImmediately(value);
      showToast("Фото персонажа обновлено");
    });
  }

  if (clearImageBtn && clearImageBtn.dataset.bound !== "1") {
    clearImageBtn.dataset.bound = "1";
    clearImageBtn.addEventListener("click", () => {
      setPortraitFieldValue("");
      savePortraitImmediately("");
      showToast("Фото персонажа удалено");
    });
  }
}

// ------------------------------------------------------------
// 🎨 SMALL RENDER HELPERS
// ------------------------------------------------------------
function renderEmptyState() {
  return `
    <div class="cabinet-block">
      <h3>📖 Long Story Short</h3>
      <p>Данные персонажа пока не загружены.</p>
      <div class="muted">Используй «Загрузить данные», чтобы вставить JSON или выбрать файл.</div>
    </div>
  `;
}

function renderDiceDock() {
  if (!LSS_STATE.profile) return "";
  const last = LSS_STATE.lastRoll;
  const dieButtons = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

  return `
    <div style="position:sticky; top:8px; z-index:4; display:flex; justify-content:flex-end; margin-bottom:10px;">
      <div class="cabinet-block" style="padding:10px 12px; width:min(100%, 360px); margin:0; box-shadow:0 10px 26px rgba(0,0,0,0.22);">
        <div class="flex-between" style="gap:10px; align-items:center;">
          <div>
            <div style="font-weight:800;">🎲 Кубы</div>
            <div class="muted" style="font-size:12px;">Быстрый бросок поверх LSS</div>
          </div>
          <button class="btn btn-secondary" type="button" id="lssDiceToggleInlineBtn">
            ${LSS_STATE.dicePanelOpen ? "Скрыть" : "Открыть"}
          </button>
        </div>
        ${LSS_STATE.dicePanelOpen ? `
          <div class="cart-buttons" style="margin-top:10px; flex-wrap:wrap; gap:6px; justify-content:flex-start;">
            ${dieButtons.map((die) => `
              <button class="btn ${LSS_STATE.diceType === die ? "btn-primary" : "btn-secondary"}" type="button" data-lss-roll-die="${die}" style="min-height:32px; padding:6px 10px;">
                ${die.toUpperCase()}
              </button>
            `).join("")}
          </div>
          <div class="muted" style="margin-top:10px;">
            ${last ? `Последний бросок: <strong>${escapeHtml(String(last.type).toUpperCase())}</strong> → <strong>${escapeHtml(String(last.result))}</strong>` : "Выбери куб для броска"}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderHero(profile) {
  const name = unwrapValue(profile?.name, "Без имени");
  const info = profile?.info || {};
  const vitality = profile?.vitality || {};
  const portraitUrl = getPortraitUrl(profile);
  const hpCurrent = unwrapValue(vitality["hp-current"], "—");
  const hpMax = unwrapValue(vitality["hp-max"], "—");
  const hpTemp = unwrapValue(vitality["hp-temp"], "0");
  const hitDie = unwrapValue(vitality["hit-die"], "—");
  const hitDiceCurrent = unwrapValue(vitality["hp-dice-current"], "0");
  const deathSuccesses = unwrapValue(vitality?.deathSuccesses, 0);
  const deathFails = unwrapValue(vitality?.deathFails, 0);
  const xp = getXpProgressData(profile);
  const spell = getSpellQuickSummary(profile);
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const slotsLabel = spell.totalSlots ? `${spell.freeSlots}/${spell.totalSlots}` : "—";
  const coins = parseCoins(profile);
  const coinEntries = coins
    ? Object.entries(coins).filter(([, value]) => String(value || "").trim())
    : [];
  const compactCoins = coinEntries.length
    ? coinEntries
        .map(([key, value]) => `${String(key).toUpperCase()}: ${String(value)}`)
        .join(' • ')
    : '';

  return `
    <div class="cabinet-block">
      <div style="display:grid; grid-template-columns:minmax(96px,120px) minmax(0,1fr); gap:14px; align-items:start;">
        <div>
          ${
            portraitUrl
              ? `
                <div class="trader-modal-image-wrap" style="max-width:120px;">
                  <img
                    class="trader-modal-image"
                    src="${escapeHtml(portraitUrl)}"
                    alt="${escapeHtml(String(name))}"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    onerror="this.closest('.trader-modal-image-wrap')?.insertAdjacentHTML('afterend','<div class=&quot;stat-box&quot; style=&quot;min-height:136px;display:flex;align-items:center;justify-content:center;font-size:30px;&quot;>🧙</div>'); this.closest('.trader-modal-image-wrap')?.remove();"
                  />
                </div>
              `
              : `
                <div class="stat-box" style="min-height:150px;display:flex;align-items:center;justify-content:center;font-size:30px;">
                  🧙
                </div>
              `
          }
        </div>

        <div>
          <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
            <div>
              <h2 style="margin-bottom:4px;">${escapeHtml(String(name))}</h2>
              <div class="muted" style="font-size:15px;">
                ${escapeHtml(String(unwrapValue(info?.race, "—")))} —
                ${escapeHtml(String(unwrapValue(info?.charClass, "—")))}
                ${unwrapValue(info?.charSubclass, "") ? `(${escapeHtml(String(unwrapValue(info?.charSubclass, "")))})` : ""}
              </div>
              <div class="muted" style="font-size:13px; margin-top:4px;">
                уровень ${escapeHtml(String(unwrapValue(info?.level, "1")))}
                • ${escapeHtml(String(unwrapValue(info?.background, "—")))}
                • ${escapeHtml(normalizeSize(unwrapValue(info?.size, "medium")))}
              </div>
            </div>

            <div class="cart-buttons" style="gap:6px; flex-wrap:wrap; justify-content:flex-end;">
              <button class="btn btn-secondary" type="button" id="lssQuickEditBtnCompact">
                🛠 Конструктор
              </button>
            </div>
          </div>

          <div style="margin-top:10px;">
            <div class="flex-between muted" style="font-size:12px; margin-bottom:6px; gap:10px;">
              <span>Опыт: ${escapeHtml(String(xp.xp))}</span>
              <span>${xp.next ? `до следующего уровня: ${escapeHtml(String(Math.max(0, xp.next - xp.xp)))}` : "максимальный уровень"}</span>
            </div>
            <div style="height:8px; border-radius:999px; background:rgba(255,255,255,0.08); overflow:hidden;">
              <div style="height:100%; width:${escapeHtml(String(xp.percent.toFixed(2)))}%; background:linear-gradient(90deg, rgba(217,168,95,0.92), rgba(216,195,154,0.98));"></div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:minmax(220px,1.35fr) minmax(210px,1.15fr) repeat(4,minmax(92px,0.72fr)); gap:8px; margin-top:12px; align-items:stretch;">
            <div class="stat-box" style="padding:12px; min-height:auto;">
              <div class="flex-between" style="align-items:center; gap:8px;">
                <div class="muted">Хиты</div>
                <div class="cart-buttons" style="gap:4px;">
                  <button class="btn btn-secondary" type="button" data-lss-hp-action="minus" style="min-height:28px; padding:4px 8px;">−1</button>
                  <button class="btn btn-secondary" type="button" data-lss-hp-action="plus" style="min-height:28px; padding:4px 8px;">+1</button>
                  <button class="btn btn-secondary" type="button" data-lss-hp-action="set" style="min-height:28px; padding:4px 8px;">✎</button>
                </div>
              </div>
              <div style="font-size:30px; font-weight:900; line-height:1.05; margin-top:8px;">${escapeHtml(String(hpCurrent))} / ${escapeHtml(String(hpMax))}</div>
              <div class="muted" style="margin-top:6px; display:flex; flex-wrap:wrap; gap:10px; font-size:12px;">
                <span>временные: <strong>${escapeHtml(String(hpTemp))}</strong></span>
                <span>кость: <strong>${escapeHtml(String(hitDie))}</strong></span>
                <span>кости: <strong>${escapeHtml(String(hitDiceCurrent))}</strong></span>
              </div>
            </div>

            <div class="stat-box" style="padding:12px; min-height:auto;">
              <div class="muted">Состояния и ресурсы</div>
              <div style="font-size:14px; font-weight:800; margin-top:8px; min-height:20px;">${escapeHtml(conditions || 'норма')}</div>
              <div class="muted" style="margin-top:6px; font-size:12px; display:flex; flex-wrap:wrap; gap:10px;">
                <span>смерть: <strong>${escapeHtml(String(deathSuccesses))} / ${escapeHtml(String(deathFails))}</strong></span>
                ${compactCoins ? `<span>${escapeHtml(compactCoins)}</span>` : ''}
              </div>
            </div>

            <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">КБ</div><div style="font-size:22px; font-weight:900; margin-top:8px;">${escapeHtml(String(unwrapValue(vitality?.ac, "—")))}</div></div>
            <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Инициатива</div><div style="font-size:22px; font-weight:900; margin-top:8px;">${escapeHtml(formatSigned(unwrapValue(vitality?.initiative, 0)))}</div></div>
            <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Скорость</div><div style="font-size:22px; font-weight:900; margin-top:8px;">${escapeHtml(String(unwrapValue(vitality?.speed, "—")))}</div></div>
            <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Мастерство</div><div style="font-size:22px; font-weight:900; margin-top:8px;">${escapeHtml(formatSigned(getProficiencyBonus(profile)))}</div></div>
          </div>

          <div style="display:grid; grid-template-columns:minmax(220px,1.15fr) minmax(220px,1.05fr); gap:8px; margin-top:8px; align-items:stretch;">
            <div class="stat-box" style="padding:12px; min-height:auto;">
              <div class="muted">Заклинания</div>
              <div style="font-size:16px; font-weight:800; margin-top:8px;">${escapeHtml(String(spell.ability))}</div>
              <div class="inv-item-details" style="margin-top:8px;">
                <span>атака ${escapeHtml(formatSigned(spell.attack))}</span>
                <span>СЛ ${escapeHtml(String(spell.saveDc))}</span>
                <span>ячейки ${escapeHtml(String(slotsLabel))}</span>
              </div>
            </div>
            <div class="stat-box" style="padding:12px; min-height:auto;">
              <div class="muted">Пассивные чувства</div>
              <div class="inv-item-details" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px;">
                <span>воспр. ${escapeHtml(String(getPassivePerception(profile)))}</span>
                <span>прониц. ${escapeHtml(String(getPassiveInsight(profile)))}</span>
                <span>анализ ${escapeHtml(String(getPassiveInvestigation(profile)))}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCombatSummary(profile) {
  const vitality = profile?.vitality || {};
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const deathSuccesses = unwrapValue(vitality?.deathSuccesses, 0);
  const deathFails = unwrapValue(vitality?.deathFails, 0);

  return `
    <div class="cabinet-block">
      <h3>Боевая сводка</h3>
      <div class="profile-grid">
        <div><b>Текущие хиты:</b> ${escapeHtml(String(unwrapValue(vitality["hp-current"], "—")))}</div>
        <div><b>Максимум хитов:</b> ${escapeHtml(String(unwrapValue(vitality["hp-max"], "—")))}</div>
        <div><b>Временные хиты:</b> ${escapeHtml(String(unwrapValue(vitality["hp-temp"], "0")))}</div>
        <div><b>Кость хитов:</b> ${escapeHtml(String(unwrapValue(vitality["hit-die"], "—")))}</div>
        <div><b>Кости хитов (тек.):</b> ${escapeHtml(String(unwrapValue(vitality["hp-dice-current"], "0")))}</div>
        <div><b>Бонус мастерства:</b> ${escapeHtml(formatSigned(getProficiencyBonus(profile)))}</div>
        <div><b>Пассивное восприятие:</b> ${escapeHtml(String(getPassivePerception(profile)))}</div>
        <div><b>Спасброски от смерти:</b> ${escapeHtml(String(deathSuccesses))} / ${escapeHtml(String(deathFails))}</div>
        ${
          conditions
            ? `<div><b>Состояния:</b> ${escapeHtml(conditions)}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderStats(profile) {
  return `
    <div class="cabinet-block">
      <h3>Характеристики и спасброски</h3>
      <div class="stats-grid">
        ${STAT_DEFS.map(({ key, label }) => {
          const score = getStatScore(profile, key);
          const mod = getStatModifier(profile, key);
          const save = getSaveModifier(profile, key);
          const profMark = hasSaveProficiency(profile, key) ? "★" : "•";

          return `
            <div class="stat-box">
              <div><b>${escapeHtml(label)}</b></div>
              <div style="font-size:20px;margin-top:4px;">${escapeHtml(formatSigned(mod))}</div>
              <div class="muted">Значение: ${escapeHtml(String(score))}</div>
              <div style="margin-top:8px;">
                ${profMark} Спасбросок: ${escapeHtml(formatSigned(save))}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderSkills(profile) {
  return `
    <div class="cabinet-block">
      <h3>Навыки</h3>
      <div class="profile-grid">
        ${STAT_DEFS.map(({ key, label }) => {
          const skills = getSkillsByStat(profile, key);
          return `
            <div class="lss-rich-block">
              <h4 style="margin-bottom:8px;">${escapeHtml(label)}</h4>
              ${
                skills.length
                  ? skills
                      .map(([skillKey]) => {
                        const skillLabel = SKILL_LABELS[skillKey] || capitalizeRu(skillKey);
                        const value = getSkillModifier(profile, skillKey);
                        const profMark = isSkillProficient(profile, skillKey) ? "★" : "•";
                        return `
                          <div style="margin-bottom:6px;">
                            ${profMark} ${escapeHtml(skillLabel)}:
                            <strong>${escapeHtml(formatSigned(value))}</strong>
                          </div>
                        `;
                      })
                      .join("")
                  : `<div class="muted">Нет навыков на этой характеристике.</div>`
              }
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderWeapons(profile) {
  const weapons = Array.isArray(profile?.weaponsList) ? profile.weaponsList : [];

  return `
    <div class="cabinet-block">
      <h3>Оружие и боевые приёмы</h3>
      ${
        weapons.length
          ? `
            <div class="inventory-list">
              ${weapons
                .map((weapon) => {
                  const name = normalizeWeaponName(weapon);
                  const dmg = normalizeWeaponDamage(weapon);
                  const mod = weaponAttackBonus(profile, weapon);
                  const notes = unwrapValue(weapon?.notes, "");
                  const ability = String(weapon?.ability || "").toUpperCase();

                  return `
                    <div class="inventory-item">
                      <div class="inventory-item-info">
                        <strong>${escapeHtml(String(name))}</strong>
                        <div class="inv-item-details">
                          <span>Атака: ${escapeHtml(formatSigned(mod))}</span>
                          <span>Урон: ${escapeHtml(String(dmg))}</span>
                          ${ability ? `<span>Хар-ка: ${escapeHtml(ability)}</span>` : ""}
                          ${weapon?.isProf ? `<span>Владение</span>` : ""}
                        </div>
                        ${
                          notes
                            ? `<div class="muted" style="margin-top:6px;">${escapeHtml(String(notes))}</div>`
                            : ""
                        }
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          `
          : `<p>Оружие не заполнено.</p>`
      }
    </div>
  `;
}

function renderFeatures(profile) {
  return `
    <div class="cabinet-block">
      <h3>Классовые / видовые особенности</h3>
      <div class="lss-rich-block">
        ${renderRichText(profile?.attacks, "Особенности пока не заполнены.")}
      </div>
    </div>
  `;
}

function renderAppearance(profile) {
  const appearance = profile?.appearance;
  const subInfo = profile?.subInfo || {};

  return `
    <div class="cabinet-block">
      <h3>Внешность</h3>
      <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px;">
        <div class="stat-box lss-mini-box"><div class="muted">Возраст</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.age, "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Рост</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.height, "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Вес</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.weight, "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Глаза</div><div style="font-size:14px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.eyes, "—")))}</div></div>
      </div>

      <div style="display:grid; grid-template-columns:minmax(0,1.15fr) minmax(260px,0.85fr); gap:12px; margin-top:12px; align-items:start;">
        <div class="lss-rich-block">
          <h4>Общее описание</h4>
          ${renderRichText(appearance, "Описание внешности отсутствует.")}
        </div>
        <div style="display:flex; flex-direction:column; gap:12px; min-width:0;">
          <div class="lss-rich-block">
            <h4>Кожа</h4>
            <p>${escapeHtml(String(unwrapValue(subInfo?.skin, "—")))}</p>
          </div>
          <div class="lss-rich-block">
            <h4>Волосы</h4>
            <p>${escapeHtml(String(unwrapValue(subInfo?.hair, "—")))}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBackground(profile) {
  return `
    <div class="cabinet-block">
      <h3>Предыстория и характер</h3>
      <div style="display:flex; flex-direction:column; gap:12px; min-width:0;">
        <div style="display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:12px; align-items:start;">
          <div class="lss-rich-block">
            <h4>Предыстория</h4>
            ${renderRichText(profile?.background, "Предыстория не заполнена.")}
          </div>
          <div class="lss-rich-block">
            <h4>Личность</h4>
            ${renderRichText(profile?.personality, "Не заполнено")}
          </div>
        </div>
        <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;">
          <div class="lss-rich-block">
            <h4>Идеалы</h4>
            ${renderRichText(profile?.ideals, "Не заполнено")}
          </div>
          <div class="lss-rich-block">
            <h4>Привязанности</h4>
            ${renderRichText(profile?.bonds, "Не заполнено")}
          </div>
          <div class="lss-rich-block">
            <h4>Изъяны</h4>
            ${renderRichText(profile?.flaws, "Не заполнено")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAlliesAndGoals(profile) {
  const prof = profile?.prof;
  const allies = profile?.allies;
  const goals = profile?.quests;

  return `
    <div class="cabinet-block">
      <h3>Союзники, владения и цели</h3>
      <div class="profile-grid">
        <div class="lss-rich-block">
          <h4>Владения и языки</h4>
          ${renderRichText(prof, "Не заполнено")}
        </div>

        <div class="lss-rich-block">
          <h4>Союзники и организации</h4>
          ${renderRichText(allies, "Не заполнено")}
        </div>

        <div class="lss-rich-block">
          <h4>Цели и задачи</h4>
          ${renderRichText(goals, "Не заполнено")}
        </div>
      </div>
    </div>
  `;
}


const LSS_TAB_DEFS = [
  { key: "overview", label: "ОБЗОР" },
  { key: "attacks", label: "АТАКИ" },
  { key: "abilities", label: "СПОСОБНОСТИ" },
  { key: "equipment", label: "СНАРЯЖЕНИЕ" },
  { key: "personality", label: "ЛИЧНОСТЬ" },
  { key: "goals", label: "ЦЕЛИ" },
  { key: "notes", label: "ЗАМЕТКИ" },
  { key: "spells", label: "ЗАКЛИНАНИЯ" },
];

function renderQuickSummary(profile) {
  const vitality = profile?.vitality || {};
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const coins = parseCoins(profile);

  return `
    <div class="cabinet-block">
      <h3>Краткая сводка</h3>
      <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px;">
        <div class="stat-box"><div class="muted">Хиты</div><div style="font-size:20px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hp-current"], "—")))} / ${escapeHtml(String(unwrapValue(vitality["hp-max"], "—")))}</div></div>
        <div class="stat-box"><div class="muted">КБ</div><div style="font-size:20px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality?.ac, "—")))}</div></div>
        <div class="stat-box"><div class="muted">Инициатива</div><div style="font-size:20px;font-weight:800;">${escapeHtml(formatSigned(unwrapValue(vitality?.initiative, 0)))}</div></div>
        <div class="stat-box"><div class="muted">Скорость</div><div style="font-size:20px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality?.speed, "—")))}</div></div>
        <div class="stat-box"><div class="muted">Мастерство</div><div style="font-size:20px;font-weight:800;">${escapeHtml(formatSigned(getProficiencyBonus(profile)))}</div></div>
        <div class="stat-box"><div class="muted">Пассивное восприятие</div><div style="font-size:20px;font-weight:800;">${escapeHtml(String(getPassivePerception(profile)))}</div></div>
      </div>
      ${(conditions || coins) ? `
        <div class="trader-meta" style="margin-top:10px;">
          ${conditions ? `<span class="meta-item">⚠️ ${escapeHtml(conditions)}</span>` : ""}
          ${coins ? Object.entries(coins).filter(([, value]) => String(value || "").trim()).map(([key, value]) => `<span class="meta-item">${escapeHtml(String(key).toUpperCase())}: ${escapeHtml(String(value))}</span>`).join("") : ""}
        </div>
      ` : ""}
    </div>
  `;
}

function renderStatsCompact(profile) {
  return `
    <div class="cabinet-block">
      <h3>Характеристики</h3>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px;">
        ${STAT_DEFS.map(({ key, label }) => {
          const score = getStatScore(profile, key);
          const mod = getStatModifier(profile, key);
          const save = getSaveModifier(profile, key);
          const profMark = hasSaveProficiency(profile, key) ? "★" : "•";

          return `
            <div class="stat-box" style="min-height:auto; padding:12px;">
              <div class="flex-between" style="align-items:center; gap:8px;">
                <b>${escapeHtml(label)}</b>
                <span class="quality-badge" style="padding:2px 8px; min-height:auto;">${escapeHtml(formatSigned(mod))}</span>
              </div>
              <div style="font-size:26px; font-weight:900; margin-top:8px; line-height:1;">${escapeHtml(String(score))}</div>
              <div class="muted" style="margin-top:6px;">${profMark} спасбросок ${escapeHtml(formatSigned(save))}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderSkillsFlat(profile) {
  return `
    <div class="cabinet-block">
      <h3>Навыки по характеристикам</h3>
      <div class="muted" style="margin-bottom:10px;">Галочка у навыка = владение. Нажал — бонус применился и сохранился.</div>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; align-items:start;">
        ${STAT_DEFS.map(({ key, label }) => {
          const statMod = getStatModifier(profile, key);
          const skills = getSkillsByStat(profile, key);
          return `
            <div class="cabinet-block" style="padding:12px; min-width:0;">
              <div class="flex-between" style="align-items:center; gap:10px; margin-bottom:10px;">
                <div>
                  <div style="font-weight:800; letter-spacing:0.02em;">${escapeHtml(label)}</div>
                  <div class="muted" style="font-size:12px; margin-top:2px;">мод. ${escapeHtml(formatSigned(statMod))}</div>
                </div>
                <span class="quality-badge" style="padding:2px 8px; min-height:auto;">${escapeHtml(String(getStatScore(profile, key)))}</span>
              </div>
              ${skills.length ? `
                <div style="display:flex; flex-direction:column; gap:8px; min-width:0;">
                  ${skills.map(([skillKey]) => {
                    const skillLabel = SKILL_LABELS[skillKey] || capitalizeRu(skillKey);
                    const value = getSkillModifier(profile, skillKey);
                    const prof = isSkillProficient(profile, skillKey);
                    return `
                      <label class="inline-checkbox" style="display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:auto; padding:8px 10px; border-radius:12px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.03); cursor:pointer;">
                        <span style="display:flex; align-items:center; gap:8px; min-width:0;">
                          <input type="checkbox" data-lss-skill-prof="${escapeHtml(skillKey)}" ${prof ? "checked" : ""} />
                          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(skillLabel)}</span>
                        </span>
                        <strong>${escapeHtml(formatSigned(value))}</strong>
                      </label>
                    `;
                  }).join("")}
                </div>
              ` : `<div class="muted">Нет навыков на этой характеристике.</div>`}
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderPassiveSenses(profile) {
  return `
    <div class="cabinet-block" style="padding:12px;">
      <h4 style="margin-bottom:10px;">Пассивные чувства</h4>
      <div class="lss-skill-stack">
        <div class="lss-inline-row"><span>Мудрость (Восприятие)</span><strong>${escapeHtml(String(getPassivePerception(profile)))}</strong></div>
        <div class="lss-inline-row"><span>Мудрость (Проницательность)</span><strong>${escapeHtml(String(getPassiveInsight(profile)))}</strong></div>
        <div class="lss-inline-row"><span>Интеллект (Анализ)</span><strong>${escapeHtml(String(getPassiveInvestigation(profile)))}</strong></div>
      </div>
    </div>
  `;
}

function renderStatesAndResources(profile) {
  const vitality = profile?.vitality || {};
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const deathSuccesses = unwrapValue(vitality?.deathSuccesses, 0);
  const deathFails = unwrapValue(vitality?.deathFails, 0);
  const coins = parseCoins(profile);

  return `
    <div class="cabinet-block" style="padding:12px;">
      <h4 style="margin-bottom:10px;">Состояния и ресурсы</h4>
      <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px;">
        <div class="stat-box lss-mini-box"><div class="muted">Врем. HP</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hp-temp"], "0")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Кость хитов</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hit-die"], "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Кости</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hp-dice-current"], "0")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Смерт. спасб.</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(deathSuccesses))} / ${escapeHtml(String(deathFails))}</div></div>
      </div>
      ${(conditions || coins) ? `
        <div class="trader-meta" style="margin-top:10px;">
          ${conditions ? `<span class="meta-item">⚠️ ${escapeHtml(conditions)}</span>` : ""}
          ${coins ? Object.entries(coins).filter(([, value]) => String(value || "").trim()).map(([key, value]) => `<span class="meta-item">${escapeHtml(String(key).toUpperCase())}: ${escapeHtml(String(value))}</span>`).join("") : ""}
        </div>
      ` : `<div class="muted" style="margin-top:10px;">Состояния и ресурсы не заданы.</div>`}
    </div>
  `;
}

function renderProfAndLanguages(profile) {
  return `
    <div class="cabinet-block" style="padding:12px;">
      <h4 style="margin-bottom:10px;">Владения и языки</h4>
      <div class="lss-rich-block">${renderRichText(profile?.prof, "Не заполнено")}</div>
    </div>
  `;
}

function renderOverviewSupportGrid(profile) {
  return `
    <div style="display:flex; flex-direction:column; gap:12px; min-width:0;">
      ${renderPassiveSenses(profile)}
      ${renderProfAndLanguages(profile)}
    </div>
  `;
}

function renderOverviewTab(profile) {
  return `
    <div style="display:grid; grid-template-columns:minmax(0,1.55fr) minmax(300px,0.95fr); gap:12px; align-items:start;">
      <div style="display:flex; flex-direction:column; gap:12px; min-width:0;">
        ${renderStatsCompact(profile)}
        ${renderSkillsFlat(profile)}
      </div>
      ${renderOverviewSupportGrid(profile)}
    </div>
  `;
}

function renderLssTabs() {
  const active = LSS_STATE.activeTab || "overview";
  return `
    <div class="cabinet-block">
      <div class="cart-buttons" style="justify-content:flex-start; gap:6px; flex-wrap:wrap;">
        ${LSS_TAB_DEFS.map((tab) => `
          <button class="btn ${tab.key === active ? "btn-primary active" : "btn-secondary"}" type="button" data-lss-tab="${escapeHtml(tab.key)}" style="min-height:34px; padding:6px 10px; border-radius:12px;">
            ${escapeHtml(tab.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderActiveLssTab(profile) {
  const active = LSS_STATE.activeTab || "overview";
  switch (active) {
    case "attacks":
      return `
        ${renderWeapons(profile)}
        <div class="cabinet-block">
          <h3>Атаки и боевые заметки</h3>
          <div class="lss-rich-block">${renderRichText(profile?.attacks, "Нет дополнительных заметок по атакам.")}</div>
        </div>
      `;
    case "abilities":
      return renderFeatures(profile);
    case "equipment":
      return renderEquipment(profile);
    case "personality":
      return `
        ${renderAppearance(profile)}
        ${renderBackground(profile)}
      `;
    case "goals":
      return renderAlliesAndGoals(profile);
    case "notes":
      return renderNotes(profile);
    case "spells":
      return `
        ${renderSpellcasting(profile)}
        ${renderSpellCards(profile)}
      `;
    case "overview":
    default:
      return renderOverviewTab(profile);
  }
}

function parseCoins(profile) {
  const coins = {
    mm: unwrapValue(profile?.coins?.mm, ""),
    sm: unwrapValue(profile?.coins?.sm, ""),
    zm: unwrapValue(profile?.coins?.zm, ""),
    em: unwrapValue(profile?.coins?.em, ""),
    pm: unwrapValue(profile?.coins?.pm, ""),
  };

  const hasAny = Object.values(coins).some((value) => String(value || "").trim());
  return hasAny ? coins : null;
}

function renderEquipment(profile) {
  const equipment = profile?.equipment;
  const coins = parseCoins(profile);

  return `
    <div class="cabinet-block">
      <h3>Снаряжение</h3>
      ${
        coins
          ? `
            <div class="trader-meta" style="margin-bottom:12px;">
              ${Object.entries(coins)
                .filter(([, value]) => String(value || "").trim())
                .map(
                  ([key, value]) =>
                    `<span class="meta-item">${escapeHtml(key.toUpperCase())}: ${escapeHtml(String(value))}</span>`
                )
                .join("")}
            </div>
          `
          : ""
      }
      <div class="lss-rich-block">
        ${renderRichText(equipment, "Снаряжение не заполнено.")}
      </div>
    </div>
  `;
}

function getNoteBlocks(profile) {
  return Object.keys(profile || {})
    .filter((key) => /^notes-\d+$/.test(key))
    .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
    .map((key) => ({
      key,
      title: `Заметка ${key.split("-")[1]}`,
      value: profile[key],
    }))
    .filter((entry) => entry.value);
}

function renderNotes(profile) {
  const notes = getNoteBlocks(profile);

  return `
    <div class="cabinet-block">
      <h3>Заметки персонажа</h3>
      ${
        notes.length
          ? `
            <div class="profile-grid">
              ${notes
                .map(
                  (note) => `
                    <div class="lss-rich-block">
                      <h4>${escapeHtml(note.title)}</h4>
                      ${renderRichText(note.value, "Пусто")}
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `<p>Заметки пока не заполнены.</p>`
      }
    </div>
  `;
}

function renderSpellcasting(profile) {
  const ability = getSpellcastingAbility(profile);
  const attack = getSpellAttackBonus(profile);
  const saveDc = getSpellSaveDc(profile);
  const slots = getSpellSlots(profile);

  return `
    <div class="cabinet-block">
      <h3>Заклинания</h3>

      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px;">
        <div class="stat-box"><div class="muted">Базовая характеристика</div><div style="font-size:18px;font-weight:800; margin-top:8px;">${escapeHtml(ability)}</div></div>
        <div class="stat-box"><div class="muted">Атака заклинанием</div><div style="font-size:18px;font-weight:800; margin-top:8px;">${escapeHtml(formatSigned(attack))}</div></div>
        <div class="stat-box"><div class="muted">СЛ спасброска</div><div style="font-size:18px;font-weight:800; margin-top:8px;">${escapeHtml(String(saveDc))}</div></div>
      </div>

      <div style="margin-top:12px;">
        <b>Ячейки заклинаний</b>
        ${
          slots.length
            ? `
              <div class="profile-grid" style="display:grid; margin-top:8px; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px;">
                ${slots
                  .map(
                    (slot) => `
                      <div class="stat-box lss-mini-box">
                        <div class="muted">${escapeHtml(String(slot.level))}-й круг</div>
                        <div style="font-size:16px;font-weight:800;">${escapeHtml(String(Math.max(0, slot.total - slot.filled)))} / ${escapeHtml(String(slot.total))}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<p style="margin-top:8px;">Ячейки пока не заполнены.</p>`
        }
      </div>
    </div>
  `;
}

function renderSpellCards(profile) {
  const expanded = getSpellCardsExpanded(profile).map(normalizeSpellCard);
  const prepared = getPreparedSpellIds(profile);
  const book = getBookSpellIds(profile);

  if (expanded.length) {
    return `
      <div class="cabinet-block">
        <h3>Карточки заклинаний</h3>
        <div class="profile-grid">
          ${expanded
            .map(
              (spell) => `
                <div class="lss-rich-block">
                  <h4 style="margin-bottom:8px;">${escapeHtml(String(spell.name))}</h4>

                  <div class="inv-item-details" style="margin-bottom:8px;">
                    ${spell.level !== "" ? `<span>Круг: ${escapeHtml(String(spell.level))}</span>` : ""}
                    ${spell.school ? `<span>${escapeHtml(String(spell.school))}</span>` : ""}
                    ${spell.time ? `<span>${escapeHtml(String(spell.time))}</span>` : ""}
                    ${spell.range ? `<span>${escapeHtml(String(spell.range))}</span>` : ""}
                    ${spell.duration ? `<span>${escapeHtml(String(spell.duration))}</span>` : ""}
                  </div>

                  ${spell.components ? `<div class="muted" style="margin-bottom:8px;">${escapeHtml(String(spell.components))}</div>` : ""}
                  ${spell.description ? `<div>${escapeHtml(String(spell.description))}</div>` : `<div class="muted">Описание пока не загружено.</div>`}
                  ${spell.notes ? `<div class="muted" style="margin-top:10px;">${escapeHtml(String(spell.notes))}</div>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="cabinet-block">
      <h3>Книга заклинаний</h3>
      <div class="muted" style="margin-bottom:10px;">
        Названия и карточки можно будет подтянуть из базы заклинаний. Пока показываем только краткую сводку по пулу.
      </div>
      <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
        <div class="stat-box"><div class="muted">Подготовлено</div><div style="font-size:22px;font-weight:900; margin-top:8px;">${escapeHtml(String(prepared.length))}</div></div>
        <div class="stat-box"><div class="muted">В книге</div><div style="font-size:22px;font-weight:900; margin-top:8px;">${escapeHtml(String(book.length))}</div></div>
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// 🧱 MAIN LSS RENDER
// ------------------------------------------------------------
export function renderLSS() {
  const container = getSection("cabinet-lss");
  if (!container) return;

  const profile = LSS_STATE.profile;

  container.innerHTML = `
    ${renderTopToolbar()}
    ${renderImportPanel()}
    ${profile ? renderEditPanel(profile) : ""}
    ${
      profile
        ? `
          <div class="lss-root">
            ${renderDiceDock()}
            ${renderHero(profile)}
            ${renderLssTabs()}
            ${renderActiveLssTab(profile)}
          </div>
        `
        : renderEmptyState()
    }
  `;

  bindLssActions();
}

// ------------------------------------------------------------
// 📜 HISTORY STUB
// ------------------------------------------------------------
export function renderHistory() {
  const container = getSection("cabinet-history");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>📜 История</h3>
      <p>
        История сайта и транзакций больше не рендерится из LSS-модуля.
        Этот раздел оставлен совместимым только временно, пока не вынесем
        отдельный <code>history.js</code>.
      </p>
    </div>
  `;
}

// ------------------------------------------------------------
// 🔧 OPTIONAL BRIDGE HELPERS
// ------------------------------------------------------------
export function getLssProfile() {
  return LSS_STATE.profile;
}

export function getLssRaw() {
  return LSS_STATE.raw;
}

export function setLssData(raw, options = {}) {
  const {
    persistLocal = true,
    source = "manual",
  } = options || {};

  LSS_STATE.raw = cloneData(raw);
  LSS_STATE.profile = normalizeProfile(cloneData(raw));
  LSS_STATE.source = source;
  if (!LSS_TAB_DEFS.some((tab) => tab.key === LSS_STATE.activeTab)) {
    LSS_STATE.activeTab = "overview";
  }

  if (persistLocal) {
    saveLocalLssRaw(LSS_STATE.raw);
  }
}

export function clearLssData(options = {}) {
  const { persistLocal = true } = options || {};

  LSS_STATE.raw = null;
  LSS_STATE.profile = null;
  LSS_STATE.source = "empty";
  LSS_STATE.activeTab = "overview";

  if (persistLocal) {
    clearLocalLssRaw();
  }
}

export async function initLSS() {
  await loadLSS();
  renderLSS();
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.lssModule = {
  loadLSS,
  renderLSS,
  renderHistory,
  getLssProfile,
  getLssRaw,
  setLssData,
  clearLssData,
  initLSS,
};