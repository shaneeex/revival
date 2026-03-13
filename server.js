const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const multer = require("multer");

const app = express();

const ROOT_DIR = __dirname;
const MEDIA_DIR = path.join(ROOT_DIR, "media");
const CONFIG_DIR = path.join(ROOT_DIR, "config");
const PLAYLIST_FILE = path.join(MEDIA_DIR, "playlist.json");
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".ogg",
  ".mov",
  ".m4v",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp"
]);

function sanitizeFileName(rawName) {
  const decoded = decodeURIComponent(String(rawName || ""));
  const base = path.basename(decoded);
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe) {
    throw new Error("Invalid filename");
  }
  return safe;
}

function mediaTypeFromName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".webm", ".ogg", ".mov", ".m4v"].includes(ext)) {
    return "video";
  }
  return "image";
}

async function ensureDataFiles() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  try {
    await fs.access(PLAYLIST_FILE);
  } catch {
    await fs.writeFile(PLAYLIST_FILE, "[]\n", "utf8");
  }

  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await fs.writeFile(SETTINGS_FILE, `${JSON.stringify({ overlayEnabled: true }, null, 2)}\n`, "utf8");
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizePlaylistItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const file = sanitizeFileName(item?.file || item?.src || "");
      const type = (item?.type || mediaTypeFromName(file)).toLowerCase() === "video" ? "video" : "image";
      const normalized = { file, type };

      if (type === "image") {
        normalized.duration = Math.max(1000, Number(item?.duration) || 10000);
      }

      return normalized;
    })
    .filter((item) => item.file);
}

async function readPlaylist() {
  const payload = await readJson(PLAYLIST_FILE, []);
  const rawItems = Array.isArray(payload) ? payload : payload.items;
  return normalizePlaylistItems(rawItems);
}

async function writePlaylist(items) {
  await writeJson(PLAYLIST_FILE, normalizePlaylistItems(items));
}

async function readSettings() {
  const payload = await readJson(SETTINGS_FILE, {});
  return {
    overlayEnabled: payload?.overlayEnabled !== false
  };
}

async function writeSettings(next) {
  const settings = {
    overlayEnabled: parseBoolean(next?.overlayEnabled, true)
  };
  await writeJson(SETTINGS_FILE, settings);
  return settings;
}

function parseBoolean(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(v)) {
      return false;
    }
    if (["true", "1", "on", "yes"].includes(v)) {
      return true;
    }
  }
  return fallback;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function uniqueTargetName(initialName) {
  const ext = path.extname(initialName);
  const stem = path.basename(initialName, ext);
  let candidate = initialName;
  let counter = 1;

  while (await fileExists(path.join(MEDIA_DIR, candidate))) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }

  return candidate;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MEDIA_DIR);
  },
  filename: async (req, file, cb) => {
    try {
      const safeOriginal = sanitizeFileName(file.originalname || "upload.bin");
      const ext = path.extname(safeOriginal).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        cb(new Error(`Unsupported file extension: ${ext}`));
        return;
      }

      const finalName = await uniqueTargetName(safeOriginal);
      cb(null, finalName);
    } catch (error) {
      cb(error);
    }
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const allowOrigin = process.env.CORS_ORIGIN || "*";
  res.header("Access-Control-Allow-Origin", allowOrigin);
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/playlist", async (req, res) => {
  const items = await readPlaylist();
  res.json({ items });
});

app.put("/api/playlist", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
    const normalized = normalizePlaylistItems(incoming);
    await writePlaylist(normalized);
    res.json({ ok: true, items: normalized });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Invalid playlist payload" });
  }
});

app.get("/api/media", async (req, res) => {
  const playlist = await readPlaylist();
  const files = await fs.readdir(MEDIA_DIR);
  const fileSet = new Set(files);

  const items = playlist.map((item) => ({
    ...item,
    exists: fileSet.has(item.file)
  }));

  res.json({ items });
});

app.post("/api/media/upload", upload.array("files", 100), async (req, res) => {
  const current = await readPlaylist();
  const imageDuration = Math.max(1000, Number(req.body?.imageDuration) || 10000);
  const uploaded = [];

  for (const file of req.files || []) {
    const fileName = sanitizeFileName(file.filename);
    const type = mediaTypeFromName(fileName);
    const item = { file: fileName, type };
    if (type === "image") {
      item.duration = imageDuration;
    }
    current.push(item);
    uploaded.push(item);
  }

  await writePlaylist(current);
  res.json({ ok: true, uploaded, items: current });
});

app.delete("/api/media/:name", async (req, res) => {
  try {
    const fileName = sanitizeFileName(req.params.name);
    const filePath = path.join(MEDIA_DIR, fileName);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const playlist = await readPlaylist();
    const next = playlist.filter((item) => item.file !== fileName);
    await writePlaylist(next);
    res.json({ ok: true, items: next });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Delete failed" });
  }
});

app.get("/api/settings", async (req, res) => {
  const settings = await readSettings();
  res.json(settings);
});

app.put("/api/settings", async (req, res) => {
  const settings = await writeSettings({
    overlayEnabled: parseBoolean(req.body?.overlayEnabled, true)
  });
  res.json({ ok: true, ...settings });
});

app.use("/media", express.static(MEDIA_DIR));
app.use(express.static(ROOT_DIR));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "admin.html"));
});

app.use((err, req, res, next) => {
  if (!err) {
    next();
    return;
  }

  const status = err.message && err.message.includes("Unsupported file extension") ? 400 : 500;
  res.status(status).json({ ok: false, error: err.message || "Server error" });
});

async function boot() {
  await ensureDataFiles();
  app.listen(PORT, HOST, () => {
    console.log(`Revival signage server running at http://${HOST}:${PORT}`);
  });
}

boot().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
