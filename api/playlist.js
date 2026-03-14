const { isAuthenticated, setCors } = require("./_lib/session");

const KV_KEY = "signage:playlist";
const DEFAULT_IMAGE_MS = 10000;
let inMemoryPlaylist = [];

function getKvConfig() {
  const baseUrl = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!baseUrl || !token) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

async function kvGetJson(key) {
  const kv = getKvConfig();
  if (!kv) {
    return null;
  }

  const response = await fetch(`${kv.baseUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kv.token}` }
  });
  if (!response.ok) {
    throw new Error(`KV GET failed (${response.status})`);
  }

  const payload = await response.json();
  const raw = payload?.result;
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvSetJson(key, value) {
  const kv = getKvConfig();
  if (!kv) {
    return false;
  }

  const response = await fetch(`${kv.baseUrl}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kv.token}`,
      "Content-Type": "text/plain; charset=utf-8"
    },
    body: JSON.stringify(value)
  });

  if (!response.ok) {
    throw new Error(`KV SET failed (${response.status})`);
  }
  return true;
}

function inferMediaType(src) {
  const value = String(src || "").toLowerCase();
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(value)) {
    return "video";
  }
  return "image";
}

function normalizePlaylistItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const src = String(item?.src || item?.file || "").trim();
      if (!src) {
        return null;
      }

      const type = String(item?.type || inferMediaType(src)).toLowerCase() === "video" ? "video" : "image";
      const normalized = {
        src,
        type
      };

      if (type === "image") {
        normalized.duration = Math.max(1000, Number(item?.duration) || DEFAULT_IMAGE_MS);
        const title = String(item?.title || "").trim();
        if (title) {
          normalized.title = title.slice(0, 120);
        }
      }

      const publicId = String(item?.publicId || "").trim();
      if (publicId) {
        normalized.publicId = publicId;
      }

      return normalized;
    })
    .filter(Boolean)
    .slice(0, 500);
}

async function readPlaylist() {
  try {
    const kvValue = await kvGetJson(KV_KEY);
    if (kvValue) {
      return {
        items: normalizePlaylistItems(Array.isArray(kvValue) ? kvValue : kvValue.items),
        persistent: true
      };
    }
  } catch {
    // Fall back to in-memory.
  }

  return {
    items: normalizePlaylistItems(inMemoryPlaylist),
    persistent: false
  };
}

async function writePlaylist(items) {
  const normalized = normalizePlaylistItems(items);
  inMemoryPlaylist = normalized;

  try {
    const persisted = await kvSetJson(KV_KEY, normalized);
    return { items: normalized, persistent: persisted };
  } catch {
    return { items: normalized, persistent: false };
  }
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    const payload = await readPlaylist();
    res.status(200).json(payload);
    return;
  }

  if (req.method === "PUT") {
    if (!isAuthenticated(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    const payload = await writePlaylist(incoming);
    res.status(200).json({ ok: true, ...payload });
    return;
  }

  res.status(405).json({ ok: false, error: "Method not allowed" });
};
