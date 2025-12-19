/* eslint-disable no-alert */
const STORAGE_PROGRESS_KEY = "jp_vocab.progress.v1";
const STORAGE_SETTINGS_KEY = "jp_vocab.settings.v1";
const STORAGE_HINTS_KEY = "jp_vocab.hints.v1";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function isoDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function maybeById(id) {
  return document.getElementById(id);
}

function ensureDailyEntry(progress, now) {
  const key = isoDay(now);
  if (!progress.daily[key] || typeof progress.daily[key] !== "object") {
    progress.daily[key] = { reviewed: 0, correct: 0, wrong: 0, skipped: 0 };
    return progress.daily[key];
  }
  const entry = progress.daily[key];
  if (typeof entry.reviewed !== "number") entry.reviewed = 0;
  if (typeof entry.correct !== "number") entry.correct = 0;
  if (typeof entry.wrong !== "number") entry.wrong = 0;
  if (typeof entry.skipped !== "number") entry.skipped = 0;
  return entry;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(text) {
  return escapeHtml(String(text ?? "").replace(/\s+/g, " ").trim());
}

function normalizeAnswer(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function englishTokens(text) {
  const stop = new Set(["a", "an", "the", "to", "of", "and", "or", "in", "on", "for", "with", "at", "from", "by"]);
  return normalizeAnswer(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t && !stop.has(t));
}

function isEnglishLooseMatch(typed, option) {
  if (!typed || !option) return false;
  if (typed === option) return true;

  const typedTokens = englishTokens(typed);
  const optionTokens = englishTokens(option);
  const typedSet = new Set(typedTokens);

  if (optionTokens.length >= 2) {
    const required = optionTokens.filter((t) => t.length >= 3);
    if (required.length === 0) return false;
    return required.every((t) => typedSet.has(t));
  }

  const minLen = 4;
  if (typed.length >= minLen && option.includes(typed)) return true;
  if (option.length >= minLen && typed.includes(option)) return true;
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatShortTime(msUntilDue) {
  if (msUntilDue <= 0) return "due";
  const minutes = Math.round(msUntilDue / MIN_MS);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function loadJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    if (row.length === 1 && row[0] === "" && rows.length === 0) return;
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        const next = normalized[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      pushField();
      continue;
    }

    if (char === "\n") {
      pushField();
      pushRow();
      continue;
    }

    field += char;
  }

  pushField();
  pushRow();

  const headers = rows.shift() ?? [];
  const headerNames = headers.map((h) => h.trim());
  const objects = rows
    .filter((r) => r.some((cell) => String(cell).trim() !== ""))
    .map((r) => {
      const obj = {};
      for (let i = 0; i < headerNames.length; i += 1) obj[headerNames[i]] = r[i] ?? "";
      return obj;
    });

  return { headers: headerNames, rows: objects };
}

function normalizeCardRow(row) {
  return {
    front: row.Front ?? row.front ?? "",
    back: row.Back ?? row.back ?? "",
    japanese: row.Japanese ?? row.japanese ?? "",
    hiragana: row.Hiragana ?? row.hiragana ?? "",
    english: row.English ?? row.english ?? "",
    exampleJp: row.Example_JP ?? row.example_jp ?? "",
    exampleHira: row.Example_Hiragana ?? row.example_hiragana ?? "",
    exampleEn: row.Example_EN ?? row.example_en ?? "",
    example2Jp: row.Example2_JP ?? row.Example_2_JP ?? row.example2_jp ?? "",
    example2Hira: row.Example2_Hiragana ?? row.Example_2_Hiragana ?? row.example2_hiragana ?? "",
    example2En: row.Example2_EN ?? row.Example_2_EN ?? row.example2_en ?? "",
    example3Jp: row.Example3_JP ?? row.Example_3_JP ?? row.example3_jp ?? "",
    example3Hira: row.Example3_Hiragana ?? row.Example_3_Hiragana ?? row.example3_hiragana ?? "",
    example3En: row.Example3_EN ?? row.Example_3_EN ?? row.example3_en ?? "",
    tags: row.Tags ?? row.tags ?? "",
    notes: row.Notes ?? row.notes ?? "",
  };
}

function buildCardId(deckId, row) {
  const basis = [deckId, row.japanese, row.hiragana, row.english, row.front].join("|");
  return `${deckId}:${fnv1a(basis)}`;
}

function defaultCardState(now) {
  return {
    status: "new", // new | learning | known | unknown
    ease: 2.5,
    intervalDays: 0,
    dueAt: now,
    seen: 0,
    correct: 0,
    wrong: 0,
    lapses: 0,
    lastReviewedAt: 0,
    lastGrade: "",
  };
}

function getCardState(progress, cardId, now) {
  const existing = progress.cards[cardId];
  if (existing) return existing;
  const next = defaultCardState(now);
  progress.cards[cardId] = next;
  return next;
}

function gradeCard(state, grade, now) {
  const next = { ...state };
  next.seen += 1;
  next.lastReviewedAt = now;
  next.lastGrade = grade;

  const oldEase = typeof next.ease === "number" ? next.ease : 2.5;
  const oldInterval = typeof next.intervalDays === "number" ? next.intervalDays : 0;

  if (grade === "again") {
    next.wrong += 1;
    next.lapses += 1;
    next.status = "unknown";
    next.ease = clamp(oldEase - 0.2, 1.3, 3.0);
    next.intervalDays = 0;
    next.dueAt = now + 10 * MIN_MS;
    return next;
  }

  if (grade === "hard") {
    next.correct += 1;
    next.status = oldInterval >= 7 ? "known" : "learning";
    next.ease = clamp(oldEase - 0.05, 1.3, 3.0);
    next.intervalDays = clamp(oldInterval > 0 ? oldInterval * 1.2 : 0.5, 0.2, 3650);
    next.dueAt = now + next.intervalDays * DAY_MS;
    return next;
  }

  if (grade === "good") {
    next.correct += 1;
    next.status = oldInterval >= 7 ? "known" : "learning";
    next.ease = clamp(oldEase, 1.3, 3.0);
    next.intervalDays = clamp(oldInterval > 0 ? oldInterval * oldEase : 1, 0.2, 3650);
    next.dueAt = now + next.intervalDays * DAY_MS;
    return next;
  }

  if (grade === "easy") {
    next.correct += 1;
    next.status = "known";
    next.ease = clamp(oldEase + 0.05, 1.3, 3.0);
    next.intervalDays = clamp(oldInterval > 0 ? oldInterval * oldEase * 1.3 : 3, 0.2, 3650);
    next.dueAt = now + next.intervalDays * DAY_MS;
    return next;
  }

  return next;
}

function computeCounts(cards, progress, now, options) {
  const deckId = options?.deckId ?? "all";
  const includeAllDecks = deckId === "all";

  let total = 0;
  let dueNow = 0;
  let unknown = 0;
  let known = 0;
  let learning = 0;
  let fresh = 0;

  for (const card of cards) {
    if (!includeAllDecks && card.deckId !== deckId) continue;
    total += 1;
    const state = getCardState(progress, card.id, now);
    if (state.status === "new") fresh += 1;
    if (state.status === "learning") learning += 1;
    if (state.status === "known") known += 1;
    if (state.status === "unknown") unknown += 1;
    if (state.dueAt <= now) dueNow += 1;
  }

  return { total, dueNow, unknown, known, learning, fresh };
}

function renderStats(container, counts) {
  container.innerHTML = "";
  const add = (label, value) => {
    const el = document.createElement("div");
    el.className = "stat";
    el.textContent = `${label}: ${value}`;
    container.appendChild(el);
  };
  add("Total", counts.total);
  add("Due", counts.dueNow);
  add("Unknown", counts.unknown);
  add("Learning", counts.learning);
  add("Known", counts.known);
  add("New", counts.fresh);
  if (typeof counts.todayReviewed === "number") add("Today", counts.todayReviewed);
  if (typeof counts.streak === "number") add("Streak", `${counts.streak}d`);
}

function highlight(text, needle) {
  if (!needle) return text;
  return String(text).split(needle).join(`<span class="hl">${needle}</span>`);
}

function expectedEnglishOptions(english) {
  const raw = String(english || "");
  const cleaned = raw.replace(/\(.*?\)/g, " ");
  const parts = cleaned
    .split(/\/|,|;|\bor\b|\band\b/gi)
    .map((s) => normalizeAnswer(s))
    .filter(Boolean);
  const uniq = [];
  for (const p of parts) if (!uniq.includes(p)) uniq.push(p);
  return uniq.length ? uniq : [normalizeAnswer(raw)].filter(Boolean);
}

function checkTypedAnswer(card, settings, typedText) {
  const typed = normalizeAnswer(typedText);
  if (!typed) return { ok: false, message: "Type an answer first." };

  if (settings.direction === "jp_to_en") {
    const options = expectedEnglishOptions(card.english);
    const ok = options.some((opt) => opt && isEnglishLooseMatch(typed, opt));
    return ok
      ? { ok: true, message: "Correct. Grade 3 (Good) or 4 (Easy)." }
      : { ok: false, message: `Not quite. Expected: ${card.english}` };
  }

  const expectedJp = (card.japanese || card.front || "").trim();
  const expectedHira = (card.hiragana || "").trim();
  const rawTyped = String(typedText || "").trim();
  const ok =
    rawTyped === expectedJp ||
    rawTyped === expectedHira ||
    typed === normalizeAnswer(expectedJp) ||
    (expectedHira && typed === normalizeAnswer(expectedHira));
  return ok
    ? { ok: true, message: "Correct. Grade 3 (Good) or 4 (Easy)." }
    : { ok: false, message: `Not quite. Expected: ${expectedJp}${expectedHira ? ` (${expectedHira})` : ""}` };
}

function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function pickVoice(langPrefix) {
  const voices = speechSynthesis.getVoices?.() ?? [];
  const v = voices.find((vv) => String(vv.lang).toLowerCase().startsWith(langPrefix));
  return v ?? null;
}

function speakText(text, lang) {
  if (!canSpeak()) return false;
  const utter = new SpeechSynthesisUtterance(String(text));
  utter.lang = lang;
  const voice = pickVoice(lang.split("-")[0].toLowerCase());
  if (voice) utter.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
  return true;
}

function speakButtonHtml(text, lang, label) {
  const safeText = escapeAttr(text);
  const safeLang = escapeAttr(lang);
  const safeLabel = escapeAttr(label || "Speak");
  // Inline SVG to avoid emoji dependency.
  return `<button class="iconBtn speakBtn" type="button" data-speak-text="${safeText}" data-speak-lang="${safeLang}" aria-label="${safeLabel}" title="${safeLabel}">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 10v4c0 .55.45 1 1 1h3l4 3c.66.5 1.6.03 1.6-.8V6.8c0-.83-.94-1.3-1.6-.8L7 9H4c-.55 0-1 .45-1 1zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zm2.5 0c0 2.88-1.72 5.36-4.2 6.49-.4.18-.8-.2-.8-.63 0-.26.15-.5.39-.61C16.62 16.3 18 14.27 18 12s-1.38-4.3-3.61-5.25c-.24-.1-.39-.35-.39-.61 0-.43.4-.81.8-.63C17.28 6.64 19 9.12 19 12z"/>
    </svg>
  </button>`;
}

function cardFrontHtml(card, direction, settings) {
  if (direction === "en_to_jp") {
    const en = escapeHtml(card.english);
    const speak = card.english ? speakButtonHtml(card.english, "en-US", "Speak (English)") : "";
    return `<div class="termRow">${speak}<div>${en}</div></div><div class="muted" style="margin-top:8px;font-size:14px">Answer in Japanese</div>`;
  }

  const jp = escapeHtml(card.japanese || card.front);
  const hira = escapeHtml(card.hiragana);
  const speak = card.japanese || card.front ? speakButtonHtml(card.japanese || card.front, "ja-JP", "Speak (Japanese)") : "";
  const subtitle =
    settings?.showReading && hira ? `<div class="muted" style="margin-top:6px;font-size:16px">${hira}</div>` : "";
  return `<div class="termRow">${speak}<div>${jp}</div></div>${subtitle}`;
}

function formatExamples(card, settings) {
  if (!settings?.showExamples) return "";
  const lines = [];
  if (card.exampleJp || card.exampleEn) {
    const jp = highlight(escapeHtml(card.exampleJp), escapeHtml(card.japanese));
    const hira = escapeHtml(card.exampleHira);
    const en = escapeHtml(card.exampleEn);
    const speak = card.exampleJp ? speakButtonHtml(card.exampleJp, "ja-JP", "Speak example 1") : "";
    lines.push(
      `<div class="exampleBlock"><b>Example 1</b>: <span class="exampleRow">${speak}<span>${jp}</span></span>${
        hira ? ` <div class="muted exampleBlock__sub">${hira}</div>` : ""
      }${en ? `<div class="muted exampleBlock__sub">${en}</div>` : ""}</div>`,
    );
  }
  if (card.example2Jp || card.example2En) {
    const jp = highlight(escapeHtml(card.example2Jp), escapeHtml(card.japanese));
    const hira = escapeHtml(card.example2Hira);
    const en = escapeHtml(card.example2En);
    const speak = card.example2Jp ? speakButtonHtml(card.example2Jp, "ja-JP", "Speak example 2") : "";
    lines.push(
      `<div class="exampleBlock"><b>Example 2</b>: <span class="exampleRow">${speak}<span>${jp}</span></span>${
        hira ? ` <div class="muted exampleBlock__sub">${hira}</div>` : ""
      }${en ? `<div class="muted exampleBlock__sub">${en}</div>` : ""}</div>`,
    );
  }
  if (card.example3Jp || card.example3En) {
    const jp = highlight(escapeHtml(card.example3Jp), escapeHtml(card.japanese));
    const hira = escapeHtml(card.example3Hira);
    const en = escapeHtml(card.example3En);
    const speak = card.example3Jp ? speakButtonHtml(card.example3Jp, "ja-JP", "Speak example 3") : "";
    lines.push(
      `<div class="exampleBlock"><b>Example 3</b>: <span class="exampleRow">${speak}<span>${jp}</span></span>${
        hira ? ` <div class="muted exampleBlock__sub">${hira}</div>` : ""
      }${en ? `<div class="muted exampleBlock__sub">${en}</div>` : ""}</div>`,
    );
  }
  return lines.join("");
}

function cardBackHtml(card, direction, settings) {
  if (direction === "en_to_jp") {
    const jp = escapeHtml(card.japanese || card.front);
    const hira = escapeHtml(card.hiragana);
    const en = escapeHtml(card.english);
    const examples = formatExamples(card, settings);
    const speak = card.japanese || card.front ? speakButtonHtml(card.japanese || card.front, "ja-JP", "Speak (Japanese)") : "";
    return `
      <div class="termRow" style="font-size:20px;font-weight:750">${speak}<div>${jp}</div></div>
      ${settings?.showReading && hira ? `<div class="muted" style="margin-top:4px">${hira}</div>` : ""}
      ${en ? `<div style="margin-top:10px"><b>Meaning</b>: ${en}</div>` : ""}
      ${examples ? `<div style="margin-top:12px">${examples}</div>` : ""}
    `;
  }

  const en = escapeHtml(card.english);
  const jp = escapeHtml(card.japanese || card.front);
  const hira = escapeHtml(card.hiragana);
  const examples = formatExamples(card, settings);
  const speak = card.japanese || card.front ? speakButtonHtml(card.japanese || card.front, "ja-JP", "Speak (Japanese)") : "";
  return `
    ${en ? `<div style="font-size:20px;font-weight:750">${en}</div>` : ""}
    <div class="termRow" style="margin-top:10px"><b>Japanese</b>: ${speak}<span>${jp}</span>${
      settings?.showReading && hira ? ` <span class="muted">(${hira})</span>` : ""
    }</div>
    ${examples ? `<div style="margin-top:12px">${examples}</div>` : ""}
  `;
}

function listPillHtml(card, state, now) {
  const dueIn = state.dueAt - now;
  const meta = state.status === "unknown" ? `lapses ${state.lapses}` : formatShortTime(dueIn);
  const jp = escapeHtml(card.japanese || card.front);
  const en = escapeHtml(card.english);
  return `
    <div class="pill" role="button" tabindex="0" data-card-id="${escapeHtml(card.id)}" aria-label="Jump to card">
      <div class="pill__main">
        <div class="pill__jp">${jp}</div>
        <div class="pill__en">${en}</div>
      </div>
      <div class="pill__meta">${meta}</div>
    </div>
  `;
}

function chooseNextCard(cards, progress, now, settings) {
  const deckId = settings.deckId;
  const onlyDue = settings.onlyDue;
  const direction = settings.direction;

  const eligible = cards.filter((c) => deckId === "all" || c.deckId === deckId);

  const due = [];
  const unknown = [];
  const learning = [];
  const fresh = [];
  const rest = [];

  for (const card of eligible) {
    const state = getCardState(progress, card.id, now);
    const isDue = state.dueAt <= now;
    if (state.status === "unknown") unknown.push(card);
    else if (state.status === "learning") learning.push(card);
    else if (state.status === "new") fresh.push(card);
    else rest.push(card);
    if (isDue) due.push(card);
  }

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  if (onlyDue) {
    shuffle(due);
    return due[0] ?? null;
  }

  // Keep reminding "unknown": bias them heavily.
  shuffle(unknown);
  shuffle(learning);
  shuffle(due);
  shuffle(fresh);

  const pool = [
    ...unknown.slice(0, 3),
    ...due.slice(0, 3),
    ...learning.slice(0, 2),
    ...fresh.slice(0, 2),
  ];

  if (pool.length === 0) return null;

  // Small extra randomization to avoid repetition.
  const pick = pool[Math.floor(Math.random() * pool.length)];

  // If asking EN->JP and the card has no Japanese, skip it.
  if (direction === "en_to_jp" && !(pick.japanese || pick.front)) return pool[0] ?? null;
  return pick;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

async function loadDecks() {
  const text = await fetchText("data/decks.json");
  const parsed = JSON.parse(text);
  if (!parsed?.sourceFile || !Array.isArray(parsed?.decks)) throw new Error("Invalid data/decks.json");
  return parsed;
}

async function loadCardsFromMasterCsv(masterFile, deckTitleById) {
  const csvText = await fetchText(`data/${masterFile}`);
  const parsed = parseCSV(csvText);
  return parsed.rows.map((raw) => {
    const row = normalizeCardRow(raw);
    const deckId = (raw.Deck ?? raw.deck ?? "").trim() || "unknown";
    const id = buildCardId(deckId, row);
    return { id, deckId, deckTitle: deckTitleById[deckId] ?? deckId, ...row };
  });
}

function ensureProgressShape(progress) {
  if (!progress || typeof progress !== "object")
    return { version: 1, cards: {}, streak: { lastDay: "", count: 0 }, daily: {} };
  if (!progress.cards || typeof progress.cards !== "object") progress.cards = {};
  if (!progress.streak || typeof progress.streak !== "object") progress.streak = { lastDay: "", count: 0 };
  if (!progress.daily || typeof progress.daily !== "object") progress.daily = {};
  // Backfill skipped counts for older data.
  for (const key of Object.keys(progress.daily)) {
    const entry = progress.daily[key];
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.skipped !== "number") entry.skipped = 0;
  }
  return progress;
}

function ensureHintsShape(hints) {
  if (!hints || typeof hints !== "object") return { quickControlsDismissed: false };
  if (typeof hints.quickControlsDismissed !== "boolean") hints.quickControlsDismissed = false;
  return hints;
}

function supportsFileSystemAccess() {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB is not available"));
      return;
    }
    const req = indexedDB.open("jp_vocab", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function idbGet(key) {
  const db = await openIdb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const store = tx.objectStore("kv");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openIdb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await openIdb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function updateStreak(progress, now) {
  const today = isoDay(now);
  const last = progress.streak.lastDay;
  if (!last) {
    progress.streak.lastDay = today;
    progress.streak.count = 1;
    return;
  }
  if (last === today) return;

  const lastDate = new Date(`${last}T00:00:00Z`).getTime();
  const todayDate = new Date(`${today}T00:00:00Z`).getTime();
  const diffDays = Math.round((todayDate - lastDate) / DAY_MS);
  progress.streak.lastDay = today;
  progress.streak.count = diffDays === 1 ? progress.streak.count + 1 : 1;
}

function getTodayReviewed(progress, now) {
  const key = isoDay(now);
  const entry = progress.daily[key];
  if (!entry || typeof entry !== "object") return 0;
  return typeof entry.reviewed === "number" ? entry.reviewed : 0;
}

function getTodayCorrectWrong(progress, now) {
  const key = isoDay(now);
  const entry = progress.daily[key];
  if (!entry || typeof entry !== "object") return { correct: 0, wrong: 0 };
  return {
    correct: typeof entry.correct === "number" ? entry.correct : 0,
    wrong: typeof entry.wrong === "number" ? entry.wrong : 0,
  };
}

function bumpTodayReviewed(progress, now) {
  const entry = ensureDailyEntry(progress, now);
  entry.reviewed += 1;
}

function bumpTodayCorrect(progress, now) {
  const entry = ensureDailyEntry(progress, now);
  entry.correct += 1;
}

function bumpTodayWrong(progress, now) {
  const entry = ensureDailyEntry(progress, now);
  entry.wrong += 1;
}

function bumpTodaySkipped(progress, now) {
  const entry = ensureDailyEntry(progress, now);
  entry.skipped += 1;
}

async function main() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  const deckSelect = byId("deckSelect");
  const directionSelect = byId("directionSelect");
  const onlyDueToggle = byId("onlyDueToggle");
  const resetSessionBtn = byId("resetSessionBtn");
  const deckSelectMobile = byId("deckSelectMobile");
  const directionSelectMobile = byId("directionSelectMobile");
  const onlyDueToggleMobile = byId("onlyDueToggleMobile");
  const resetSessionBtnMobile = byId("resetSessionBtnMobile");

  const statsEl = byId("stats");
  const progressRingEl = byId("progressRing");
  const statsStatsEl = byId("statsStats");
  const progressRingStatsEl = byId("progressRingStats");
  const cardEl = byId("card");
  const cardMetaEl = byId("cardMeta");
  const cardFrontEl = byId("cardFront");
  const cardBackEl = byId("cardBack");
  const cardHintEl = byId("cardHint");
  const revealBtn = byId("revealBtn");
  const nextBtn = byId("nextBtn");
  const speakJpBtn = maybeById("speakJpBtn");
  const speakEnBtn = maybeById("speakEnBtn");
  const gradesEl = byId("grades");
  const typingArea = byId("typingArea");
  const answerInput = byId("answerInput");
  const checkBtn = byId("checkBtn");
  const clearBtn = byId("clearBtn");
  const typingFeedback = byId("typingFeedback");
  const mcqArea = byId("mcqArea");
  const mcqOptions = byId("mcqOptions");
  const mcqFeedback = byId("mcqFeedback");
  const hintToast = maybeById("hintToast");
  const hintToastCloseBtn = maybeById("hintToastCloseBtn");
  const reviewMiniBar = byId("reviewMiniBar");
  const sideTitle = byId("sideTitle");
  const tabbar = byId("tabbar");
  const thumbBar = byId("thumbBar");
  const thumbRevealBtn = byId("thumbRevealBtn");
  const thumbAgainBtn = byId("thumbAgainBtn");
  const thumbGoodBtn = byId("thumbGoodBtn");
  const unknownListEl = byId("unknownList");
  const dueListEl = byId("dueList");
  const unknownCountEl = byId("unknownCount");
  const dueCountEl = byId("dueCount");
  const listFilterInput = byId("listFilterInput");
  const showReadingToggle = byId("showReadingToggle");
  const showExamplesToggle = byId("showExamplesToggle");
  const typingModeToggle = byId("typingModeToggle");
  const singleHandToggle = byId("singleHandToggle");
  const autoSpeakToggle = byId("autoSpeakToggle");
  const dailyGoalInput = byId("dailyGoalInput");
  const analyticsEl = byId("analytics");
  const exportBtn = byId("exportBtn");
  const importFile = byId("importFile");
  const menuBtn = byId("menuBtn");
  const sideOverlay = byId("sideOverlay");
  const installAppBtn = byId("installAppBtn");
  const fileSyncToggle = byId("fileSyncToggle");
  const pickProgressFileBtn = byId("pickProgressFileBtn");
  const writeProgressFileBtn = byId("writeProgressFileBtn");
  const forgetProgressFileBtn = byId("forgetProgressFileBtn");
  const fileSyncStatus = byId("fileSyncStatus");
  const quizCountInput = byId("quizCountInput");
  const quizSourceSelect = byId("quizSourceSelect");
  const quizModeSelect = byId("quizModeSelect");
  const quizAffectsSrsToggle = byId("quizAffectsSrsToggle");
  const quizAutoAdvanceToggle = byId("quizAutoAdvanceToggle");
  const startQuizBtn = byId("startQuizBtn");
  const stopQuizBtn = byId("stopQuizBtn");
  const quizStatus = byId("quizStatus");

  const progress = ensureProgressShape(loadJson(STORAGE_PROGRESS_KEY, null));
  const settings = loadJson(STORAGE_SETTINGS_KEY, {
    deckId: "all",
    direction: "jp_to_en",
    onlyDue: false,
    showReading: true,
    showExamples: true,
    typingMode: true,
    autoSpeak: false,
    dailyGoal: 30,
    fileSyncEnabled: false,
    sideOpen: false,
    mobileTab: "review",
    singleHand: false,
  });
  const hints = ensureHintsShape(loadJson(STORAGE_HINTS_KEY, null));

  let progressFileHandle = null;
  try {
    progressFileHandle = await idbGet("progressFileHandle");
  } catch {
    progressFileHandle = null;
  }

  let deckConfig = { sourceFile: "vocab_master.csv", decks: [] };
  let allCards = [];
  let cardById = new Map();
  let currentCard = null;
  let revealed = false;
  let sessionSeenIds = new Set();
  let listFilter = "";
  let lastTyped = { ok: false, message: "" };
  let quiz = {
    active: false,
    ids: [],
    poolIds: [],
    index: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
    affectsSrs: true,
    autoAdvance: true,
    currentRecorded: false,
    finishedSummary: "",
    mode: "mcq", // mcq | typing
    mcq: null, // { choiceIds: string[], correctIndex: number }
  };

  let fileWriteTimer = null;
  const setFileStatus = (text) => {
    fileSyncStatus.textContent = text || "";
  };

  const updateFileUi = () => {
    const supported = supportsFileSystemAccess();
    fileSyncToggle.disabled = !supported;
    pickProgressFileBtn.disabled = !supported;
    writeProgressFileBtn.disabled = !supported;
    forgetProgressFileBtn.disabled = !supported;
    if (!supported) {
      fileSyncToggle.checked = false;
      setFileStatus("Not supported in this browser. Use Export/Import instead.");
      return;
    }
    fileSyncToggle.checked = !!settings.fileSyncEnabled;
    setFileStatus(
      progressFileHandle
        ? `File selected: ${progressFileHandle.name || "(unnamed)"}`
        : "No file selected (Pick file to enable local file saving).",
    );
  };

  const writeProgressToFile = async ({ requestPermission } = { requestPermission: false }) => {
    if (!supportsFileSystemAccess()) return false;
    if (!settings.fileSyncEnabled) return false;
    if (!progressFileHandle) return false;
    try {
      if (typeof progressFileHandle.queryPermission === "function") {
        let perm = await progressFileHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted" && requestPermission && typeof progressFileHandle.requestPermission === "function") {
          perm = await progressFileHandle.requestPermission({ mode: "readwrite" });
        }
        if (perm !== "granted") {
          setFileStatus("File permission not granted. Click 'Write now' once to grant.");
          return false;
        }
      }
      const writable = await progressFileHandle.createWritable();
      await writable.write(
        JSON.stringify(
          {
            progress,
            settings,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      await writable.close();
      setFileStatus(`Saved: ${progressFileHandle.name || "(unnamed)"} • ${new Date().toLocaleTimeString()}`);
      return true;
    } catch (e) {
      setFileStatus(`File save failed: ${e}`);
      return false;
    }
  };

  const scheduleFileWrite = () => {
    if (!supportsFileSystemAccess()) return;
    if (!settings.fileSyncEnabled) return;
    if (!progressFileHandle) return;
    if (fileWriteTimer) clearTimeout(fileWriteTimer);
    fileWriteTimer = setTimeout(() => {
      fileWriteTimer = null;
      void writeProgressToFile({ requestPermission: false });
    }, 500);
  };

  const saveAll = () => {
    saveJson(STORAGE_PROGRESS_KEY, progress);
    saveJson(STORAGE_SETTINGS_KEY, settings);
    scheduleFileWrite();
  };

  const setSideOpen = (open) => {
    settings.sideOpen = !!open;
    document.body.classList.toggle("is-sideOpen", !!settings.sideOpen);
    sideOverlay.hidden = !settings.sideOpen;
    saveAll();
  };

  const isMobile = () => window.matchMedia?.("(max-width: 980px)")?.matches ?? false;

  const setMiniCollapsed = (collapsed) => {
    document.body.classList.toggle("is-miniCollapsed", !!collapsed);
  };

  const setMobileTab = (tab) => {
    const allowed = new Set(["review", "quiz", "lists", "stats", "settings"]);
    const next = allowed.has(tab) ? tab : "review";
    settings.mobileTab = next;
    document.body.dataset.mobileTab = next;
    for (const btn of tabbar.querySelectorAll("[data-tab]")) {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === next);
    }
    const titles = {
      review: "Review",
      quiz: "Quiz",
      lists: "Lists",
      stats: "Stats",
      settings: "Settings",
    };
    sideTitle.textContent = titles[next] || "Progress";
    // Close legacy side sheet, if any.
    setSideOpen(false);
    // Update single-hand class only in Review tab.
    document.body.classList.toggle("is-singleHand", next === "review" && !!settings.singleHand && !quiz.active);
    setMiniCollapsed(false);
    saveAll();
    renderCard();
    refreshSideLists();
  };

  const onMobileScroll = () => {
    if (!isMobile()) return;
    if (settings.mobileTab !== "review") return;
    const y = window.scrollY || 0;
    const faces = cardEl.querySelectorAll?.(".card__face") ?? [];
    let faceScroll = 0;
    for (const el of faces) {
      faceScroll = Math.max(faceScroll, el.scrollTop || 0);
    }
    setMiniCollapsed(y > 12 || faceScroll > 24);
  };

  const saveHints = () => {
    saveJson(STORAGE_HINTS_KEY, hints);
  };

  const dismissQuickControls = () => {
    if (!hintToast) return;
    hints.quickControlsDismissed = true;
    hintToast.hidden = true;
    saveHints();
  };

  const maybeShowQuickControls = () => {
    if (!hintToast) return;
    if (hints.quickControlsDismissed) return;
    const prefersCoarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const narrow = window.matchMedia?.("(max-width: 980px)")?.matches ?? false;
    if (!prefersCoarse && !narrow) return;
    hintToast.hidden = false;
  };

  const refreshSideLists = () => {
    const now = Date.now();
    const eligible = allCards.filter((c) => settings.deckId === "all" || c.deckId === settings.deckId);

    const unknownCards = [];
    const dueCards = [];
    for (const card of eligible) {
      const state = getCardState(progress, card.id, now);
      const matches =
        !listFilter ||
        (card.japanese || "").includes(listFilter) ||
        (card.hiragana || "").includes(listFilter) ||
        (card.english || "").toLowerCase().includes(listFilter.toLowerCase());
      if (state.status === "unknown" && matches) unknownCards.push({ card, state });
      if (state.dueAt <= now && matches) dueCards.push({ card, state });
    }

    unknownCards.sort((a, b) => b.state.lapses - a.state.lapses || a.state.dueAt - b.state.dueAt);
    dueCards.sort((a, b) => a.state.dueAt - b.state.dueAt);

    unknownListEl.innerHTML = unknownCards
      .slice(0, 25)
      .map(({ card, state }) => listPillHtml(card, state, now))
      .join("");

    dueListEl.innerHTML = dueCards
      .slice(0, 25)
      .map(({ card, state }) => listPillHtml(card, state, now))
      .join("");

    const counts = computeCounts(allCards, progress, now, { deckId: settings.deckId });
    unknownCountEl.textContent = String(unknownCards.length);
    dueCountEl.textContent = String(dueCards.length);

    const todayReviewed = getTodayReviewed(progress, now);
    const countsForStats = {
      ...counts,
      streak: progress.streak.count,
      todayReviewed,
    };
    renderStats(statsEl, countsForStats);
    renderStats(statsStatsEl, countsForStats);

    const goal = Math.max(1, Number(settings.dailyGoal || 30));
    const pct = clamp(Math.round((todayReviewed / goal) * 100), 0, 100);
    progressRingEl.style.background = `conic-gradient(rgba(110,231,255,0.95) ${pct}%, rgba(255,255,255,0.08) 0)`;
    progressRingEl.innerHTML = `<div class="progressRing__label"><div><b>${todayReviewed}/${goal}</b>Today</div></div>`;
    progressRingStatsEl.style.background = progressRingEl.style.background;
    progressRingStatsEl.innerHTML = progressRingEl.innerHTML;

    const { correct, wrong } = getTodayCorrectWrong(progress, now);
    const acc = correct + wrong > 0 ? Math.round((correct / (correct + wrong)) * 100) : 0;
    const todayEntry = ensureDailyEntry(progress, now);
    const todaySkipped = todayEntry.skipped;

    let allCorrect = 0;
    let allWrong = 0;
    let allLapses = 0;
    let allSkipped = 0;
    for (const c of eligible) {
      const st = getCardState(progress, c.id, now);
      allCorrect += typeof st.correct === "number" ? st.correct : 0;
      allWrong += typeof st.wrong === "number" ? st.wrong : 0;
      allLapses += typeof st.lapses === "number" ? st.lapses : 0;
    }
    const allAcc = allCorrect + allWrong > 0 ? Math.round((allCorrect / (allCorrect + allWrong)) * 100) : 0;
    for (const dayKey of Object.keys(progress.daily || {})) {
      const entry = progress.daily[dayKey];
      if (!entry || typeof entry !== "object") continue;
      allSkipped += typeof entry.skipped === "number" ? entry.skipped : 0;
    }

    const last14 = [];
    for (let i = 13; i >= 0; i -= 1) {
      const day = isoDay(now - i * DAY_MS);
      const entry = progress.daily[day];
      last14.push(typeof entry?.reviewed === "number" ? entry.reviewed : 0);
    }
    const max = Math.max(1, ...last14);
    const bars = last14
      .map((v) => {
        const h = clamp(Math.round((v / max) * 100), 8, 100);
        const dim = v === 0 ? " bar--dim" : "";
        return `<div class="bar${dim}" style="height:${h}%"></div>`;
      })
      .join("");

    const hardest = eligible
      .map((c) => ({ card: c, state: getCardState(progress, c.id, now) }))
      .filter((x) => x.state.lapses > 0)
      .sort((a, b) => b.state.lapses - a.state.lapses)
      .slice(0, 5)
      .map(
        ({ card, state }) => `
          <div class="miniLink" data-card-id="${escapeHtml(card.id)}" role="button" tabindex="0">
            <div class="miniLink__main">
              <div class="miniLink__jp">${escapeHtml(card.japanese || card.front)}</div>
            </div>
            <div class="miniLink__meta">lapses ${state.lapses}</div>
          </div>
        `,
      )
      .join("");

    analyticsEl.innerHTML = `
      <div class="chart">
        <div class="chart__row"><div>Today accuracy</div><div>${acc}% (${correct}✓ / ${wrong}✗)</div></div>
        <div class="chart__row"><div>Today skipped</div><div>${todaySkipped}</div></div>
        <div class="chart__row"><div>All-time accuracy</div><div>${allAcc}% (${allCorrect}✓ / ${allWrong}✗)</div></div>
        <div class="chart__row"><div>All-time skipped</div><div>${allSkipped}</div></div>
        <div class="chart__row"><div>Total lapses</div><div>${allLapses}</div></div>
        <div class="chart__row"><div>Last 14 days</div><div>${last14.reduce((a, b) => a + b, 0)} reviews</div></div>
        <div class="bars" aria-label="Last 14 days bar chart">${bars}</div>
        <div class="chart__row"><div>Hardest (lapses)</div><div></div></div>
        <div class="listMini">${hardest || `<div class=\"muted\">No lapses yet.</div>`}</div>
      </div>
    `;

    // Mobile review mini bar
    if (isMobile()) {
      const deckName =
        settings.deckId === "all"
          ? "All decks"
          : deckConfig.decks.find((d) => d.id === settings.deckId)?.title || settings.deckId;
      const dirLabel = settings.direction === "en_to_jp" ? "EN→JP" : "JP→EN";
      reviewMiniBar.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div style="min-width:0">
            <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(
              deckName,
            )}</div>
            <div class="muted" style="font-size:12px">${escapeHtml(dirLabel)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:850">${todayReviewed}/${goal}</div>
            <div class="muted" style="font-size:12px">today</div>
          </div>
        </div>
      `;
    }
  };

  const setRevealed = (nextRevealed) => {
    const updateThumbUi = () => {
      const enabled = isMobile() && settings.mobileTab === "review" && !!settings.singleHand && !quiz.active;
      document.body.classList.toggle("is-singleHand", enabled);
      thumbBar.hidden = !enabled;
      if (!enabled) return;
      thumbRevealBtn.textContent = revealed ? "Skip" : "Reveal";
      thumbAgainBtn.classList.toggle("is-muted", !revealed);
      thumbGoodBtn.classList.toggle("is-muted", !revealed);
    };

    revealed = nextRevealed;
    if (revealed) {
      cardEl.classList.add("is-revealed");
      gradesEl.classList.add("is-enabled");
      revealBtn.disabled = true;
      if (quiz.active) {
        cardHintEl.textContent = quiz.currentRecorded
          ? "Tap Next question to continue"
          : quiz.mode === "mcq"
            ? "Answer shown — choose 1–4 to answer, or Skip"
            : "Answer shown — Enter to Check (scores), or Next to skip";
      } else {
        cardHintEl.textContent = lastTyped?.ok ? "Looks correct — grade 3/4 (or swipe right/up)" : "Grade yourself (1–4)";
      }
      if (settings.autoSpeak && currentCard?.japanese) speakText(currentCard.japanese, "ja-JP");
    } else {
      cardEl.classList.remove("is-revealed");
      gradesEl.classList.remove("is-enabled");
      revealBtn.disabled = false;
      if (quiz.active) {
        cardHintEl.textContent =
          quiz.mode === "mcq"
            ? "Quiz (MCQ): press 1–4 to answer • Next to skip"
            : "Quiz (Typing): type your answer, then Enter to check • Next to skip";
      } else {
        cardHintEl.textContent = settings.typingMode ? "Type your answer, then Enter" : "Click to reveal (or Space)";
      }
    }

    updateThumbUi();
  };

  const renderCard = () => {
    if (!currentCard) {
      if (quiz.finishedSummary) {
        cardMetaEl.textContent = "Quiz finished";
        cardFrontEl.innerHTML = `
          <div style="font-size:26px;font-weight:850">Quiz complete</div>
          <div class="muted" style="margin-top:10px">${escapeHtml(quiz.finishedSummary)}</div>
        `;
        cardBackEl.textContent = "";
        cardHintEl.textContent = "Start a new quiz from the right panel.";
      } else {
        cardMetaEl.textContent = "No cards found for this deck.";
        cardFrontEl.textContent = "Add cards, or disable 'Only due'.";
        cardHintEl.textContent = "";
      }
      if (!quiz.finishedSummary) cardBackEl.textContent = "";
      typingArea.classList.remove("is-enabled");
      setRevealed(false);
      nextBtn.disabled = true;
      return;
    }

    const now = Date.now();
    const state = getCardState(progress, currentCard.id, now);
    const dueText = state.dueAt <= now ? "due now" : `due in ${formatShortTime(state.dueAt - now)}`;
    const quizText = quiz.active ? ` • QUIZ ${quiz.index + 1}/${quiz.ids.length}` : "";
    cardMetaEl.textContent = `${currentCard.deckTitle} • ${state.status} • ${dueText}${quizText}`;

    if (quiz.active) {
      revealBtn.disabled = true;
      revealBtn.textContent = "Show answer (disabled in quiz)";
    } else {
      revealBtn.disabled = false;
      revealBtn.textContent = "Show answer (Space)";
    }

    cardFrontEl.innerHTML = cardFrontHtml(currentCard, settings.direction, settings);
    cardBackEl.innerHTML = cardBackHtml(currentCard, settings.direction, settings);

    const isMcqQuiz = quiz.active && quiz.mode === "mcq";
    typingArea.classList.toggle("is-enabled", !!settings.typingMode && !isMcqQuiz);
    mcqArea.classList.toggle("is-enabled", isMcqQuiz);
    answerInput.placeholder = settings.direction === "jp_to_en" ? "Type the English meaning…" : "Type the Japanese (kanji or ひらがな)…";
    typingFeedback.textContent = "";
    typingFeedback.classList.remove("is-correct", "is-wrong");
    answerInput.value = "";
    lastTyped = { ok: false, message: "" };
    quiz.currentRecorded = false;
    nextBtn.disabled = false;
    if (quiz.active) {
      nextBtn.textContent = "Skip";
    } else {
      nextBtn.textContent = "Next";
    }
    mcqFeedback.textContent = "";
    mcqFeedback.classList.remove("is-correct", "is-wrong");
    mcqOptions.innerHTML = "";

    setRevealed(false);

    // Mobile: don't auto-focus the input when moving between cards (prevents keyboard popping up).
    if (settings.typingMode && !isMobile()) setTimeout(() => answerInput.focus(), 0);

    if (quiz.active && quiz.mode === "mcq") renderMcq();
  };

  const nextCard = () => {
    const now = Date.now();
    updateStreak(progress, now);
    saveAll();

    let tries = 0;
    while (tries < 20) {
      const pick = chooseNextCard(allCards, progress, now, settings);
      if (!pick) {
        currentCard = null;
        renderCard();
        refreshSideLists();
        return;
      }
      if (!sessionSeenIds.has(pick.id) || sessionSeenIds.size >= 20) {
        currentCard = pick;
        sessionSeenIds.add(pick.id);
        renderCard();
        refreshSideLists();
        return;
      }
      tries += 1;
    }
    currentCard = chooseNextCard(allCards, progress, now, settings);
    renderCard();
    refreshSideLists();
  };

  const updateQuizUi = () => {
    document.body.classList.toggle("is-quiz", !!quiz.active);
    if (!quiz.active) {
      const summary = quiz.finishedSummary;
      quizStatus.innerHTML = summary
        ? `<div><b>Quiz finished</b></div><div style="margin-top:6px">${escapeHtml(summary)}</div>`
        : "<div>Not running.</div>";
      stopQuizBtn.disabled = true;
      startQuizBtn.disabled = false;
      return;
    }
    const n = quiz.ids.length;
    const i = Math.min(quiz.index + 1, n);
    const pct = n > 0 ? Math.round(((i - 1) / n) * 100) : 0;
    quizStatus.innerHTML = `
      <div><b>Quiz running</b></div>
      <div style="margin-top:6px">Mode: ${escapeHtml(quiz.mode.toUpperCase())} • Q ${i}/${n}</div>
      <div style="margin-top:6px">${quiz.correct}✓ / ${quiz.wrong}✗ • skipped ${quiz.skipped}</div>
      <div class="quizBar" aria-label="Quiz progress"><div class="quizBar__fill" style="width:${pct}%"></div></div>
    `;
    stopQuizBtn.disabled = false;
    startQuizBtn.disabled = true;
  };

  const nextQuizCard = () => {
    if (!quiz.active) return nextCard();
    quiz.index += 1;
    updateQuizUi();
    if (quiz.index >= quiz.ids.length) {
      const total = quiz.ids.length || 0;
      const acc = total > 0 ? Math.round((quiz.correct / total) * 100) : 0;
      quiz.finishedSummary = `${quiz.correct} correct, ${quiz.wrong} wrong (${acc}% accuracy). Skipped: ${quiz.skipped}.`;
      quiz.active = false;
      document.body.classList.remove("is-quiz");
      updateQuizUi();
      currentCard = null;
      renderCard();
      refreshSideLists();
      return;
    }
    const id = quiz.ids[quiz.index];
    const card = cardById.get(id);
    currentCard = card ?? null;
    renderCard();
    refreshSideLists();
  };

  const applyQuizResult = (ok, { skipped } = { skipped: false }) => {
    if (!currentCard) return;
    const now = Date.now();

    bumpTodayReviewed(progress, now);
    if (skipped) bumpTodaySkipped(progress, now);

    if (!skipped) {
      if (ok) bumpTodayCorrect(progress, now);
      else bumpTodayWrong(progress, now);
    }

    if (quiz.active) {
      if (skipped) {
        quiz.skipped += 1;
      } else if (ok) {
        quiz.correct += 1;
      } else {
        quiz.wrong += 1;
      }
      updateQuizUi();
    }

    if (quiz.affectsSrs && !skipped) {
      const state = getCardState(progress, currentCard.id, now);
      progress.cards[currentCard.id] = gradeCard(state, ok ? "good" : "again", now);
    }

    updateStreak(progress, now);
    saveAll();
    refreshSideLists();
  };

  const optionLabelForCard = (card) => {
    if (settings.direction === "jp_to_en") {
      return { main: card.english || "", sub: "", speakText: "", speakLang: "" };
    }
    const main = card.japanese || card.front || "";
    const sub = settings.showReading && card.hiragana ? card.hiragana : "";
    return { main, sub, speakText: main, speakLang: "ja-JP" };
  };

  const buildMcq = (card) => {
    const correctId = card.id;
    const label = optionLabelForCard(card);
    const key = `${label.main}||${label.sub}`.trim();
    if (!key) return null;

    const pool = (quiz.poolIds && quiz.poolIds.length ? quiz.poolIds : quiz.ids).filter((id) => id !== correctId);
    const seen = new Set([key]);
    const distractors = [];
    const shuffled = shuffleInPlace([...pool]);
    for (const id of shuffled) {
      const c = cardById.get(id);
      if (!c) continue;
      const l = optionLabelForCard(c);
      const k = `${l.main}||${l.sub}`.trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      distractors.push(id);
      if (distractors.length >= 3) break;
    }
    if (distractors.length < 3) return null;

    const choiceIds = shuffleInPlace([correctId, ...distractors]);
    const correctIndex = choiceIds.indexOf(correctId);
    return { choiceIds, correctIndex };
  };

  const renderMcq = () => {
    if (!quiz.active || quiz.mode !== "mcq" || !currentCard) return;
    quiz.mcq = buildMcq(currentCard);
    if (!quiz.mcq) {
      mcqOptions.innerHTML = `<div class="muted">Not enough unique options for MCQ in this deck. Switch Quiz Mode to Typing.</div>`;
      return;
    }
    const keys = ["1", "2", "3", "4"];
    mcqOptions.innerHTML = quiz.mcq.choiceIds
      .map((id, idx) => {
        const c = cardById.get(id);
        if (!c) return "";
        const l = optionLabelForCard(c);
        const speak =
          l.speakText && canSpeak() ? speakButtonHtml(l.speakText, l.speakLang, `Speak option ${idx + 1}`) : "";
        const main = escapeHtml(l.main);
        const sub = l.sub ? `<div class="muted" style="margin-top:2px;font-size:12px">${escapeHtml(l.sub)}</div>` : "";
        return `
          <button class="mcqOpt" type="button" data-opt-index="${idx}" role="listitem">
            <div class="mcqOpt__key">${keys[idx]}</div>
            <div class="mcqOpt__main">
              <div class="termRow">${speak}<div>${main}</div></div>
              ${sub}
            </div>
          </button>
        `;
      })
      .join("");
  };

  const selectMcq = (idx) => {
    if (!quiz.active || quiz.mode !== "mcq") return;
    if (!currentCard) return;
    if (quiz.currentRecorded) return;
    if (!quiz.mcq) return;
    const correct = idx === quiz.mcq.correctIndex;
    applyQuizResult(correct, { skipped: false });
    quiz.currentRecorded = true;
    setRevealed(true);
    nextBtn.textContent = "Next question";

    const buttons = Array.from(mcqOptions.querySelectorAll(".mcqOpt"));
    for (const [i, btn] of buttons.entries()) {
      btn.disabled = true;
      btn.classList.toggle("is-correct", i === quiz.mcq.correctIndex);
      btn.classList.toggle("is-wrong", i === idx && idx !== quiz.mcq.correctIndex);
    }
    mcqFeedback.textContent = correct ? "Correct." : "Wrong.";
    mcqFeedback.classList.toggle("is-correct", correct);
    mcqFeedback.classList.toggle("is-wrong", !correct);
    if (quiz.autoAdvance && correct) {
      setTimeout(() => {
        if (quiz.active && quiz.currentRecorded) nextQuizCard();
      }, 450);
    }
  };

  const skipCurrent = () => {
    if (!currentCard) return;
    if (quiz.active && !quiz.currentRecorded) {
      applyQuizResult(false, { skipped: true });
      quiz.currentRecorded = true;
      nextQuizCard();
      return;
    }

    const now = Date.now();
    bumpTodayReviewed(progress, now);
    bumpTodaySkipped(progress, now);
    updateStreak(progress, now);
    saveAll();
    refreshSideLists();
    nextCard();
  };

  const gradeCurrent = (grade) => {
    if (!currentCard) return;
    if (quiz.active) {
      if (quiz.currentRecorded) return;
      const ok = grade !== "again";
      applyQuizResult(ok, { skipped: false });
      quiz.currentRecorded = true;
      nextQuizCard();
      return;
    }
    const now = Date.now();
    const state = getCardState(progress, currentCard.id, now);
    progress.cards[currentCard.id] = gradeCard(state, grade, now);
    bumpTodayReviewed(progress, now);
    if (grade === "again") bumpTodayWrong(progress, now);
    else bumpTodayCorrect(progress, now);
    saveAll();
    refreshSideLists();
    nextCard();
  };

  const runTypedCheck = () => {
    if (!settings.typingMode) return;
    if (!currentCard) return;
    const res = checkTypedAnswer(currentCard, settings, answerInput.value);
    lastTyped = res;
    typingFeedback.textContent = res.message;
    typingFeedback.classList.toggle("is-correct", res.ok);
    typingFeedback.classList.toggle("is-wrong", !res.ok);
    setRevealed(true);
    cardHintEl.textContent = res.ok ? "Looks correct — grade 3/4 (or swipe right/up)" : "Wrong — grade 1 (Again)";
    if (quiz.active) {
      if (!quiz.currentRecorded) {
        applyQuizResult(res.ok, { skipped: false });
        quiz.currentRecorded = true;
        cardHintEl.textContent = res.ok ? "Correct — tap Next for the next question" : "Wrong — tap Next to continue";
        nextBtn.textContent = "Next question";
        if (quiz.autoAdvance && res.ok) {
          setTimeout(() => {
            if (quiz.active && quiz.currentRecorded) nextQuizCard();
          }, 350);
        }
      } else {
        cardHintEl.textContent = "Tap Next for the next question";
      }
    }
    answerInput.focus();
    answerInput.select();
  };

  const setDeckOptions = () => {
    deckSelect.innerHTML = "";
    for (const d of deckConfig.decks) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.title;
      deckSelect.appendChild(opt);
    }
    deckSelect.value = settings.deckId;
    deckSelectMobile.innerHTML = deckSelect.innerHTML;
    deckSelectMobile.value = settings.deckId;
  };

  const reloadCards = async () => {
    refreshSideLists();
    nextCard();
  };

  try {
    deckConfig = await loadDecks();
    const deckTitleById = Object.fromEntries(deckConfig.decks.map((d) => [d.id, d.title]));
    allCards = await loadCardsFromMasterCsv(deckConfig.sourceFile, deckTitleById);
    cardById = new Map(allCards.map((c) => [c.id, c]));
    setDeckOptions();
  } catch (e) {
    alert(`Failed to load decks. If you're opening via file://, run a local server.\n\n${e}`);
    throw e;
  }

  directionSelect.value = settings.direction;
  onlyDueToggle.checked = settings.onlyDue;
  showReadingToggle.checked = settings.showReading !== false;
  showExamplesToggle.checked = settings.showExamples !== false;
  typingModeToggle.checked = settings.typingMode !== false;
  singleHandToggle.checked = !!settings.singleHand;
  autoSpeakToggle.checked = !!settings.autoSpeak;
  dailyGoalInput.value = String(settings.dailyGoal ?? 30);
  fileSyncToggle.checked = !!settings.fileSyncEnabled;
  quizCountInput.value = "20";
  quizSourceSelect.value = "due";
  quizModeSelect.value = "mcq";
  quizAffectsSrsToggle.checked = true;
  quizAutoAdvanceToggle.checked = true;
  updateFileUi();
  updateQuizUi();

  // Mobile tab initialization
  document.body.dataset.mobileTab = settings.mobileTab || "review";
  if (isMobile()) setMobileTab(settings.mobileTab || "review");
  window.addEventListener("scroll", onMobileScroll, { passive: true });
  cardEl.querySelectorAll(".card__face").forEach((el) => el.addEventListener("scroll", onMobileScroll, { passive: true }));

  deckSelect.addEventListener("change", async () => {
    settings.deckId = deckSelect.value;
    deckSelectMobile.value = settings.deckId;
    saveAll();
    sessionSeenIds = new Set();
    await reloadCards();
  });

  directionSelect.addEventListener("change", () => {
    settings.direction = directionSelect.value;
    directionSelectMobile.value = settings.direction;
    saveAll();
    renderCard();
  });

  onlyDueToggle.addEventListener("change", async () => {
    settings.onlyDue = onlyDueToggle.checked;
    onlyDueToggleMobile.checked = settings.onlyDue;
    saveAll();
    sessionSeenIds = new Set();
    await reloadCards();
  });

  listFilterInput.addEventListener("input", () => {
    listFilter = listFilterInput.value.trim();
    refreshSideLists();
  });

  showReadingToggle.addEventListener("change", () => {
    settings.showReading = showReadingToggle.checked;
    saveAll();
    renderCard();
  });

  showExamplesToggle.addEventListener("change", () => {
    settings.showExamples = showExamplesToggle.checked;
    saveAll();
    renderCard();
  });

  typingModeToggle.addEventListener("change", () => {
    settings.typingMode = typingModeToggle.checked;
    saveAll();
    renderCard();
  });

  singleHandToggle.addEventListener("change", () => {
    settings.singleHand = singleHandToggle.checked;
    saveAll();
    // Re-apply mobile classes and thumb UI
    if (isMobile()) setMobileTab(settings.mobileTab || "review");
    else document.body.classList.remove("is-singleHand");
  });

  autoSpeakToggle.addEventListener("change", () => {
    settings.autoSpeak = autoSpeakToggle.checked;
    saveAll();
  });

  fileSyncToggle.addEventListener("change", () => {
    settings.fileSyncEnabled = fileSyncToggle.checked;
    saveAll();
    updateFileUi();
  });

  pickProgressFileBtn.addEventListener("click", async () => {
    if (!supportsFileSystemAccess()) {
      setFileStatus("Not supported in this browser.");
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "jp_vocab_progress.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      progressFileHandle = handle;
      try {
        await idbSet("progressFileHandle", handle);
      } catch {
        // ignore
      }
      settings.fileSyncEnabled = true;
      saveAll();
      updateFileUi();
      await writeProgressToFile({ requestPermission: true });
    } catch (e) {
      setFileStatus(`Pick file canceled: ${e?.name || e}`);
    }
  });

  writeProgressFileBtn.addEventListener("click", async () => {
    if (!supportsFileSystemAccess()) {
      setFileStatus("Not supported in this browser.");
      return;
    }
    if (!progressFileHandle) {
      setFileStatus("No file selected.");
      return;
    }
    settings.fileSyncEnabled = true;
    saveAll();
    updateFileUi();
    await writeProgressToFile({ requestPermission: true });
  });

  forgetProgressFileBtn.addEventListener("click", async () => {
    progressFileHandle = null;
    settings.fileSyncEnabled = false;
    try {
      await idbDel("progressFileHandle");
    } catch {
      // ignore
    }
    saveAll();
    updateFileUi();
  });

  dailyGoalInput.addEventListener("change", () => {
    const parsed = Number(dailyGoalInput.value);
    settings.dailyGoal = Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 500) : 30;
    dailyGoalInput.value = String(settings.dailyGoal);
    saveAll();
    refreshSideLists();
  });

  resetSessionBtn.addEventListener("click", () => {
    sessionSeenIds = new Set();
    nextCard();
  });

  tabbar.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-tab]");
    if (!btn) return;
    const tab = btn.getAttribute("data-tab");
    setMobileTab(tab);
  });

  // Mobile session controls (in side sheet)
  directionSelectMobile.value = settings.direction;
  onlyDueToggleMobile.checked = settings.onlyDue;

  deckSelectMobile.addEventListener("change", async () => {
    settings.deckId = deckSelectMobile.value;
    deckSelect.value = settings.deckId;
    saveAll();
    sessionSeenIds = new Set();
    await reloadCards();
  });

  directionSelectMobile.addEventListener("change", () => {
    settings.direction = directionSelectMobile.value;
    directionSelect.value = settings.direction;
    saveAll();
    renderCard();
  });

  onlyDueToggleMobile.addEventListener("change", async () => {
    settings.onlyDue = onlyDueToggleMobile.checked;
    onlyDueToggle.checked = settings.onlyDue;
    saveAll();
    sessionSeenIds = new Set();
    await reloadCards();
  });

  resetSessionBtnMobile.addEventListener("click", () => {
    sessionSeenIds = new Set();
    setMobileTab("review");
    nextCard();
  });

  revealBtn.addEventListener("click", () => setRevealed(true));
  nextBtn.addEventListener("click", () => {
    if (quiz.active && quiz.currentRecorded) {
      nextQuizCard();
      return;
    }
    skipCurrent();
  });

  const bindLongPress = (button, { onTap, onLongPress, longMs = 520 }) => {
    let timer = null;
    let didLong = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    button.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return; // long-press is for touch
      didLong = false;
      clear();
      timer = setTimeout(() => {
        didLong = true;
        onLongPress?.();
      }, longMs);
    });
    button.addEventListener("pointerup", () => {
      clear();
      if (!didLong) onTap?.();
      didLong = false;
    });
    button.addEventListener("pointercancel", () => {
      clear();
      didLong = false;
    });
  };

  thumbRevealBtn.addEventListener("click", () => {
    if (!isMobile()) return;
    if (settings.mobileTab !== "review") return;
    if (!settings.singleHand) return;
    if (!currentCard) return;
    if (quiz.active) return;
    if (revealed) {
      skipCurrent();
    } else {
      setRevealed(true);
    }
  });

  bindLongPress(thumbAgainBtn, {
    onTap: () => {
      if (!currentCard || quiz.active) return;
      if (!revealed) return setRevealed(true);
      gradeCurrent("again");
    },
    onLongPress: () => {
      if (!currentCard || quiz.active) return;
      if (!revealed) setRevealed(true);
      cardHintEl.textContent = "Hard (long-press Again)";
      gradeCurrent("hard");
    },
  });

  bindLongPress(thumbGoodBtn, {
    onTap: () => {
      if (!currentCard || quiz.active) return;
      if (!revealed) return setRevealed(true);
      gradeCurrent("good");
    },
    onLongPress: () => {
      if (!currentCard || quiz.active) return;
      if (!revealed) setRevealed(true);
      cardHintEl.textContent = "Easy (long-press Good)";
      gradeCurrent("easy");
    },
  });

  if (hintToastCloseBtn) hintToastCloseBtn.addEventListener("click", dismissQuickControls);

  const ttsAvailable = canSpeak();
  if (!ttsAvailable) {
    document.body.classList.add("no-tts");
    if (speakJpBtn) {
      speakJpBtn.disabled = true;
      speakJpBtn.title = "Speech synthesis is not available in this browser.";
    }
    if (speakEnBtn) {
      speakEnBtn.disabled = true;
      speakEnBtn.title = "Speech synthesis is not available in this browser.";
    }
  } else {
    // Trigger voice loading early for better language selection.
    speechSynthesis.getVoices?.();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices?.();
  }

  if (speakJpBtn) {
    speakJpBtn.addEventListener("click", () => {
      if (!currentCard) return;
      const ok = speakText(currentCard.japanese || currentCard.front, "ja-JP");
      if (!ok) {
        typingFeedback.textContent = "Speech synthesis is not available in this browser.";
        typingFeedback.classList.remove("is-correct");
        typingFeedback.classList.add("is-wrong");
      }
    });
  }

  if (speakEnBtn) {
    speakEnBtn.addEventListener("click", () => {
      if (!currentCard) return;
      const ok = speakText(currentCard.english, "en-US");
      if (!ok) {
        typingFeedback.textContent = "Speech synthesis is not available in this browser.";
        typingFeedback.classList.remove("is-correct");
        typingFeedback.classList.add("is-wrong");
      }
    });
  }

  checkBtn.addEventListener("click", () => {
    if (isMobile() && settings.typingMode && !String(answerInput.value || "").trim()) {
      answerInput.focus();
      return;
    }
    runTypedCheck();
  });
  clearBtn.addEventListener("click", () => {
    answerInput.value = "";
    typingFeedback.textContent = "";
    typingFeedback.classList.remove("is-correct", "is-wrong");
    answerInput.focus();
  });
  answerInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    runTypedCheck();
  });

  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target?.closest?.(".speakBtn[data-speak-text][data-speak-lang]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const text = btn.getAttribute("data-speak-text");
      const lang = btn.getAttribute("data-speak-lang");
      const ok = speakText(text, lang);
      if (!ok) cardHintEl.textContent = "Speech synthesis is not available in this browser.";
    },
    true,
  );

  cardEl.addEventListener("click", () => {
    if (!currentCard) return;
    if (quiz.active) return;
    setRevealed(!revealed);
  });
  cardEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const isButton = String(e.target?.tagName || "").toLowerCase() === "button";
    if (isButton) return;
    if (quiz.active) return;
    setRevealed(!revealed);
  });

  // Swipe gestures (mobile)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;
  let touchScrollEl = null;
  let touchStartScrollTop = 0;
  let touchStartScrollLeft = 0;

  cardEl.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      touchActive = true;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchScrollEl = e.target?.closest?.(".card__face") ?? null;
      touchStartScrollTop = touchScrollEl?.scrollTop ?? 0;
      touchStartScrollLeft = touchScrollEl?.scrollLeft ?? 0;
    },
    { passive: true },
  );

  cardEl.addEventListener(
    "touchend",
    (e) => {
      if (!touchActive) return;
      touchActive = false;
      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const threshold = 50;
      if (ax < threshold && ay < threshold) return;

      const scrolled =
        touchScrollEl &&
        (Math.abs((touchScrollEl.scrollTop ?? 0) - touchStartScrollTop) > 8 ||
          Math.abs((touchScrollEl.scrollLeft ?? 0) - touchStartScrollLeft) > 8);
      touchScrollEl = null;
      if (scrolled) return;

      if (!hints.quickControlsDismissed) dismissQuickControls();

      if (!revealed) {
        if (dy < -threshold) setRevealed(true); // swipe up reveals
        return;
      }

      if (ax > ay) {
        if (dx < -threshold) gradeCurrent("again"); // left
        else if (dx > threshold) gradeCurrent("good"); // right
      } else {
        if (dy > threshold) gradeCurrent("hard"); // down
        else if (dy < -threshold) gradeCurrent("easy"); // up
      }
    },
    { passive: true },
  );

  gradesEl.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-grade]");
    if (!btn) return;
    gradeCurrent(btn.getAttribute("data-grade"));
  });

  mcqOptions.addEventListener("click", (e) => {
    const opt = e.target?.closest?.(".mcqOpt");
    if (!opt) return;
    const idx = Number(opt.getAttribute("data-opt-index"));
    if (!Number.isFinite(idx)) return;
    selectMcq(idx);
  });

  startQuizBtn.addEventListener("click", () => {
    const now = Date.now();
    const eligible = allCards.filter((c) => settings.deckId === "all" || c.deckId === settings.deckId);
    const source = quizSourceSelect.value;
    const picked = [];
    for (const card of eligible) {
      const state = getCardState(progress, card.id, now);
      if (source === "due" && state.dueAt > now) continue;
      if (source === "unknown" && state.status !== "unknown") continue;
      picked.push(card.id);
    }
    const n = clamp(Number(quizCountInput.value || 20), 1, 200);
    shuffleInPlace(picked);
    const mode = quizModeSelect.value === "typing" ? "typing" : "mcq";
    quiz = {
      active: picked.length > 0,
      ids: picked.slice(0, Math.min(n, picked.length)),
      poolIds: eligible.map((c) => c.id),
      index: 0,
      correct: 0,
      wrong: 0,
      skipped: 0,
      affectsSrs: !!quizAffectsSrsToggle.checked,
      autoAdvance: !!quizAutoAdvanceToggle.checked,
      currentRecorded: false,
      finishedSummary: "",
      mode,
      mcq: null,
    };
    document.body.classList.toggle("is-quiz", !!quiz.active);
    updateQuizUi();
    if (!quiz.active) {
      quizStatus.textContent = "No cards available for this quiz source.";
      return;
    }
    const first = cardById.get(quiz.ids[0]);
    currentCard = first ?? null;
    if (currentCard) {
      settings.typingMode = mode === "typing";
      typingModeToggle.checked = settings.typingMode;
      saveAll();
    }
    renderCard();
  });

  stopQuizBtn.addEventListener("click", () => {
    quiz.active = false;
    quiz.ids = [];
    quiz.index = 0;
    quiz.finishedSummary = "";
    document.body.classList.remove("is-quiz");
    updateQuizUi();
    nextCard();
  });

  menuBtn.addEventListener("click", () => {
    if (isMobile()) {
      setMobileTab("settings");
      return;
    }
    setSideOpen(!settings.sideOpen);
  });
  sideOverlay.addEventListener("click", () => setSideOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (settings.sideOpen) setSideOpen(false);
  });

  // Initialize mobile side sheet state
  document.body.classList.toggle("is-sideOpen", !!settings.sideOpen);
  sideOverlay.hidden = !settings.sideOpen;

  // PWA install prompt (Android/Chrome)
  let deferredInstallPrompt = null;
  const showInstall = (show) => {
    installAppBtn.hidden = !show;
  };
  showInstall(false);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstall(true);
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    showInstall(false);
  });
  installAppBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      alert("Install prompt is not available. Make sure you're using Chrome on Android and the site is served over HTTPS.");
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome !== "accepted") {
        // keep it available
        return;
      }
      deferredInstallPrompt = null;
      showInstall(false);
    } catch {
      // ignore
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = String(e.target?.tagName || "").toLowerCase();
    const isTyping = tag === "input" || tag === "textarea";
    if (isTyping) return;

    if (quiz.active && quiz.mode === "mcq") {
      const key = String(e.key || "");
      const map = { "1": 0, "2": 1, "3": 2, "4": 3, a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3 };
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        e.preventDefault();
        selectMcq(map[key]);
        return;
      }
    }

    if (settings.typingMode && e.key === "Enter" && !revealed) {
      e.preventDefault();
      runTypedCheck();
      return;
    }

    if (e.key === "j" || e.key === "J") {
      if (currentCard) speakText(currentCard.japanese || currentCard.front, "ja-JP");
      return;
    }
    if (e.key === "e" || e.key === "E") {
      if (currentCard) speakText(currentCard.english, "en-US");
      return;
    }

    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (!currentCard) return;
      if (!quiz.active) setRevealed(!revealed);
      return;
    }

    if (!revealed) return;
    if (e.key === "1") gradeCurrent("again");
    if (e.key === "2") gradeCurrent("hard");
    if (e.key === "3") gradeCurrent("good");
    if (e.key === "4") gradeCurrent("easy");
  });

  exportBtn.addEventListener("click", () => {
    downloadJson("jp_vocab_progress.json", {
      progress,
      settings,
      exportedAt: new Date().toISOString(),
    });
  });

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!data?.progress?.cards) throw new Error("Invalid file (missing progress.cards)");
      const imported = ensureProgressShape(data.progress);
      saveJson(STORAGE_PROGRESS_KEY, imported);
      alert("Imported progress. Reloading…");
      location.reload();
    } catch (err) {
      alert(`Import failed: ${err}`);
    }
  });

  const onPillActivate = (event) => {
    const pill = event.target?.closest?.("[data-card-id]");
    if (!pill) return;
    const id = pill.getAttribute("data-card-id");
    const card = cardById.get(id);
    if (!card) return;
    currentCard = card;
    renderCard();
  };

  unknownListEl.addEventListener("click", onPillActivate);
  dueListEl.addEventListener("click", onPillActivate);
  analyticsEl.addEventListener("click", onPillActivate);
  unknownListEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    onPillActivate(e);
  });
  dueListEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    onPillActivate(e);
  });
  analyticsEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    onPillActivate(e);
  });

  maybeShowQuickControls();
  await reloadCards();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
});
