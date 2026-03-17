const { isAuthenticated, setCors } = require("./_lib/session");
const { readJsonState, writeJsonState } = require("./_lib/persistence");

const SETTINGS_KV_KEY = "signage:settings";
const SETTINGS_CLOUDINARY_STATE_KEY = "settings";
const LEGACY_OVERLAY_KV_KEY = "signage:overlayEnabled";
const LEGACY_OVERLAY_CLOUDINARY_KEY = "overlay-enabled";
const MAX_TICKER_ITEMS = 40;
const MAX_TICKER_ITEM_LENGTH = 160;

let inMemorySettings = {
  overlayEnabled: true,
  customTickerItems: []
};

function parseBoolean(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "on", "yes"].includes(normalized)) {
      return true;
    }
  }
  return fallback;
}

function normalizeTickerText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TICKER_ITEM_LENGTH);
}

function normalizeCustomTickerItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const text = normalizeTickerText(item);
    if (!text) {
      continue;
    }
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push(text);
    if (normalized.length >= MAX_TICKER_ITEMS) {
      break;
    }
  }

  return normalized;
}

function toNormalizedSettings(value, fallback = inMemorySettings) {
  const next = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const overlayEnabled = parseBoolean(next.overlayEnabled, parseBoolean(fallback?.overlayEnabled, true));

  const fallbackTicker = normalizeCustomTickerItems(fallback?.customTickerItems || []);
  const customTickerItems = Object.prototype.hasOwnProperty.call(next, "customTickerItems")
    ? normalizeCustomTickerItems(next.customTickerItems)
    : fallbackTicker;

  return {
    overlayEnabled,
    customTickerItems
  };
}

async function readSettings() {
  const state = await readJsonState({
    kvKey: SETTINGS_KV_KEY,
    cloudinaryKey: SETTINGS_CLOUDINARY_STATE_KEY,
    memoryValue: inMemorySettings
  });

  let settings = toNormalizedSettings(state.value, inMemorySettings);
  let persistent = state.persistent;
  let writable = state.writable;
  let storage = state.storage;

  // Backward compatibility: if new key not persisted yet, pull old overlay key.
  if (!persistent) {
    const legacyState = await readJsonState({
      kvKey: LEGACY_OVERLAY_KV_KEY,
      cloudinaryKey: LEGACY_OVERLAY_CLOUDINARY_KEY,
      memoryValue: null
    });

    if (legacyState.persistent) {
      settings = {
        ...settings,
        overlayEnabled: parseBoolean(legacyState.value, settings.overlayEnabled)
      };
      persistent = legacyState.persistent;
      writable = legacyState.writable;
      storage = legacyState.storage;
    }
  }

  inMemorySettings = settings;
  return { settings, persistent, writable, storage };
}

async function writeSettings(nextPartial) {
  const current = (await readSettings()).settings;
  const patch = nextPartial && typeof nextPartial === "object" ? nextPartial : {};

  const next = {
    overlayEnabled: Object.prototype.hasOwnProperty.call(patch, "overlayEnabled")
      ? parseBoolean(patch.overlayEnabled, current.overlayEnabled)
      : current.overlayEnabled,
    customTickerItems: Object.prototype.hasOwnProperty.call(patch, "customTickerItems")
      ? normalizeCustomTickerItems(patch.customTickerItems)
      : normalizeCustomTickerItems(current.customTickerItems)
  };

  inMemorySettings = next;

  const state = await writeJsonState({
    kvKey: SETTINGS_KV_KEY,
    cloudinaryKey: SETTINGS_CLOUDINARY_STATE_KEY,
    value: next
  });

  // Mirror overlay for older deployments reading legacy overlay-only key.
  try {
    await writeJsonState({
      kvKey: LEGACY_OVERLAY_KV_KEY,
      cloudinaryKey: LEGACY_OVERLAY_CLOUDINARY_KEY,
      value: next.overlayEnabled
    });
  } catch {
    // Non-fatal.
  }

  return {
    settings: next,
    persistent: state.persistent,
    writable: state.writable,
    storage: state.storage
  };
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    const state = await readSettings();
    res.status(200).json({
      overlayEnabled: state.settings.overlayEnabled,
      customTickerItems: state.settings.customTickerItems,
      persistent: state.persistent,
      writable: state.writable,
      storage: state.storage
    });
    return;
  }

  if (req.method === "PUT") {
    if (!isAuthenticated(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const state = await writeSettings(req.body || {});
    res.status(200).json({
      ok: true,
      overlayEnabled: state.settings.overlayEnabled,
      customTickerItems: state.settings.customTickerItems,
      persistent: state.persistent,
      writable: state.writable,
      storage: state.storage
    });
    return;
  }

  res.status(405).json({ ok: false, error: "Method not allowed" });
};
