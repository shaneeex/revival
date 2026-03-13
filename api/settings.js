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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getKvConfig() {
  const baseUrl = process.env.KV_REST_API_URL || "";
  const token = process.env.KV_REST_API_TOKEN || "";
  if (!baseUrl || !token) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

async function kvGetOverlayEnabled() {
  const kv = getKvConfig();
  if (!kv) {
    return null;
  }

  const response = await fetch(`${kv.baseUrl}/get/signage:overlayEnabled`, {
    headers: { Authorization: `Bearer ${kv.token}` }
  });
  if (!response.ok) {
    throw new Error(`KV GET failed (${response.status})`);
  }
  const payload = await response.json();
  return payload?.result;
}

async function kvSetOverlayEnabled(value) {
  const kv = getKvConfig();
  if (!kv) {
    return false;
  }

  const response = await fetch(
    `${kv.baseUrl}/set/signage:overlayEnabled/${encodeURIComponent(value ? "true" : "false")}`,
    { method: "POST", headers: { Authorization: `Bearer ${kv.token}` } }
  );
  if (!response.ok) {
    throw new Error(`KV SET failed (${response.status})`);
  }
  return true;
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    try {
      const kvValue = await kvGetOverlayEnabled();
      const overlayEnabled = kvValue === null
        ? inMemoryOverlayEnabled
        : parseBoolean(kvValue, true);
      res.status(200).json({
        overlayEnabled,
        persistent: kvValue !== null
      });
      return;
    } catch (error) {
      res.status(200).json({
        overlayEnabled: inMemoryOverlayEnabled,
        persistent: false
      });
      return;
    }
  }

  if (req.method === "PUT") {
    const next = parseBoolean(req.body?.overlayEnabled, true);
    inMemoryOverlayEnabled = next;

    try {
      const persisted = await kvSetOverlayEnabled(next);
      res.status(200).json({ ok: true, overlayEnabled: next, persistent: persisted });
      return;
    } catch {
      res.status(200).json({ ok: true, overlayEnabled: next, persistent: false });
      return;
    }
  }

  res.status(405).json({ ok: false, error: "Method not allowed" });
};
