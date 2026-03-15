const { isAuthenticated, setCors } = require("./_lib/session");
const { readJsonState, writeJsonState } = require("./_lib/persistence");

const KV_KEY = "signage:overlayEnabled";
const CLOUDINARY_STATE_KEY = "overlay-enabled";

let inMemoryOverlayEnabled = true;

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

async function readOverlaySettings() {
  const state = await readJsonState({
    kvKey: KV_KEY,
    cloudinaryKey: CLOUDINARY_STATE_KEY,
    memoryValue: inMemoryOverlayEnabled
  });

  const overlayEnabled = parseBoolean(state.value, true);
  inMemoryOverlayEnabled = overlayEnabled;

  return {
    overlayEnabled,
    persistent: state.persistent,
    writable: state.writable,
    storage: state.storage
  };
}

async function writeOverlaySettings(nextValue) {
  const overlayEnabled = parseBoolean(nextValue, true);
  inMemoryOverlayEnabled = overlayEnabled;

  const state = await writeJsonState({
    kvKey: KV_KEY,
    cloudinaryKey: CLOUDINARY_STATE_KEY,
    value: overlayEnabled
  });

  return {
    overlayEnabled,
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
    const payload = await readOverlaySettings();
    res.status(200).json(payload);
    return;
  }

  if (req.method === "PUT") {
    if (!isAuthenticated(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const payload = await writeOverlaySettings(req.body?.overlayEnabled);
    res.status(200).json({ ok: true, ...payload });
    return;
  }

  res.status(405).json({ ok: false, error: "Method not allowed" });
};
