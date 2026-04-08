const fs = require("fs/promises");
const path = require("path");
const { isAuthenticated, setCors } = require("./_lib/session");
const { readJsonState, writeJsonState } = require("./_lib/persistence");

const KV_KEY = "signage:playlist";
const CLOUDINARY_STATE_KEY = "playlist";
const DEFAULT_IMAGE_MS = 10000;
const DEFAULT_MAX_ITEMS = 80;
const CLOUDINARY_LIST_CACHE_MS = 10 * 60 * 1000;
const CLOUDINARY_IMAGE_DELIVERY_TRANSFORM = "f_auto,q_auto:eco,w_1600,h_1600,c_limit";
const CLOUDINARY_VIDEO_DELIVERY_TRANSFORM = "f_auto,q_auto:eco,w_1280,h_1280,c_limit";
const RUNTIME_CONFIG_PATH = path.join(process.cwd(), "runtime-config.json");

let inMemoryPlaylist = [];
let cachedCloudinaryPlaylist = [];
let cachedCloudinaryPlaylistAt = 0;

function inferMediaType(src) {
  const value = String(src || "").toLowerCase();
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(value)) {
    return "video";
  }
  return "image";
}

function encodeCloudinaryPublicId(publicId) {
  return String(publicId || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseCloudinaryAssetInfo(src, fallbackType = "image") {
  const value = String(src || "").trim();
  if (!value.includes("/upload/")) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const hostParts = parsed.hostname.split(".");
    if (hostParts.length < 3 || hostParts[0] !== "res" || hostParts[1] !== "cloudinary") {
      return null;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = pathParts.findIndex((segment) => segment === "upload");
    if (uploadIndex < 2 || uploadIndex >= pathParts.length - 1) {
      return null;
    }

    const resourceType = pathParts[uploadIndex - 1] === "video" ? "video" : "image";
    const versionIndex = pathParts.findIndex((segment, index) => index > uploadIndex && /^v\d+$/.test(segment));
    if (versionIndex < 0 || versionIndex >= pathParts.length - 1) {
      return null;
    }

    const publicSegments = pathParts.slice(versionIndex + 1).map((segment) => decodeURIComponent(segment));
    if (!publicSegments.length) {
      return null;
    }

    const lastPart = publicSegments[publicSegments.length - 1];
    const extensionMatch = lastPart.match(/\.([a-z0-9]+)$/i);
    if (extensionMatch) {
      publicSegments[publicSegments.length - 1] = lastPart.slice(0, -extensionMatch[0].length);
    }

    return {
      cloudName: pathParts[0] || "",
      resourceType: fallbackType === "video" ? "video" : resourceType,
      publicId: publicSegments.join("/"),
      format: extensionMatch ? extensionMatch[1].toLowerCase() : "",
      version: pathParts[versionIndex]
    };
  } catch {
    return null;
  }
}

function buildCloudinaryDeliveryUrl({ cloudName, resourceType, publicId, format, version }) {
  const normalizedCloudName = String(cloudName || "").trim();
  const normalizedPublicId = encodeCloudinaryPublicId(publicId);
  if (!normalizedCloudName || !normalizedPublicId) {
    return "";
  }

  const normalizedType = resourceType === "video" ? "video" : "image";
  const transformation = normalizedType === "video"
    ? CLOUDINARY_VIDEO_DELIVERY_TRANSFORM
    : CLOUDINARY_IMAGE_DELIVERY_TRANSFORM;
  const versionPart = String(version || "").trim();
  const extension = String(format || "").trim() ? `.${encodeURIComponent(String(format).trim())}` : "";

  return `https://res.cloudinary.com/${encodeURIComponent(normalizedCloudName)}/${normalizedType}/upload/${transformation}/${versionPart ? `${versionPart}/` : ""}${normalizedPublicId}${extension}`;
}

function getOptimizedCloudinarySrc({ src, type, publicId, format, version, cloudName }) {
  const normalizedType = type === "video" ? "video" : "image";
  const directInfo = parseCloudinaryAssetInfo(src, normalizedType);
  const assetInfo = directInfo || {
    cloudName: String(cloudName || "").trim(),
    resourceType: normalizedType,
    publicId: String(publicId || "").trim(),
    format: String(format || "").trim(),
    version: String(version || "").trim()
  };

  if (!assetInfo.publicId || !assetInfo.cloudName) {
    return "";
  }

  return buildCloudinaryDeliveryUrl({
    cloudName: assetInfo.cloudName,
    resourceType: assetInfo.resourceType,
    publicId: assetInfo.publicId,
    format: assetInfo.format || format,
    version: assetInfo.version || version
  });
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
      const publicId = String(item?.publicId || "").trim();
      const optimizedSrc = getOptimizedCloudinarySrc({
        src,
        type,
        publicId,
        format: item?.format,
        version: item?.version
      });
      const normalized = {
        src: optimizedSrc || src,
        type
      };

      if (type === "image") {
        normalized.duration = Math.max(1000, Number(item?.duration) || DEFAULT_IMAGE_MS);
        const title = String(item?.title || "").trim();
        if (title) {
          normalized.title = title.slice(0, 120);
        }
      }

      if (publicId) {
        normalized.publicId = publicId;
      }
      if (item?.version) {
        normalized.version = String(item.version).trim();
      }

      return normalized;
    })
    .filter(Boolean)
    .slice(0, 500);
}

async function readRuntimeCloudinaryConfig() {
  try {
    const raw = await fs.readFile(RUNTIME_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const cloudinary = parsed?.cloudinary && typeof parsed.cloudinary === "object"
      ? parsed.cloudinary
      : {};

    return {
      cloudName: String(cloudinary.cloudName || "").trim(),
      tag: String(cloudinary.tag || "").trim(),
      maxItems: Number(cloudinary.maxItems) || DEFAULT_MAX_ITEMS,
      defaultImageDurationMs: Math.max(1000, Number(cloudinary.defaultImageDurationMs) || DEFAULT_IMAGE_MS)
    };
  } catch {
    return {
      cloudName: "",
      tag: "",
      maxItems: DEFAULT_MAX_ITEMS,
      defaultImageDurationMs: DEFAULT_IMAGE_MS
    };
  }
}

async function getCloudinaryListConfig() {
  const runtime = await readRuntimeCloudinaryConfig();
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || runtime.cloudName || "").trim();
  const tag = String(process.env.CLOUDINARY_UPLOAD_TAG || runtime.tag || "signage").trim();
  const maxItems = Math.max(
    1,
    Math.min(
      300,
      Number(process.env.CLOUDINARY_UPLOAD_MAX_ITEMS) || Number(runtime.maxItems) || DEFAULT_MAX_ITEMS
    )
  );
  const defaultImageDurationMs = Math.max(
    1000,
    Number(runtime.defaultImageDurationMs) || DEFAULT_IMAGE_MS
  );

  if (!cloudName || !tag) {
    return null;
  }

  return {
    cloudName,
    tag,
    maxItems,
    defaultImageDurationMs
  };
}

async function fetchCloudinaryResourceList(config, resourceType) {
  const url = `https://res.cloudinary.com/${encodeURIComponent(config.cloudName)}/${resourceType}/list/${encodeURIComponent(config.tag)}.json?max_results=${config.maxItems}&_=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Cloudinary ${resourceType} list HTTP ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.resources) ? payload.resources : [];
}

function mapCloudinaryResource(resource, defaultImageDurationMs, cloudName) {
  const resourceType = String(resource?.resource_type || "").toLowerCase() === "video" ? "video" : "image";
  const publicId = String(resource?.public_id || "").trim();
  if (!publicId) {
    return null;
  }

  const format = String(resource?.format || "").trim();
  const version = resource?.version ? `v${resource.version}` : "";
  const secureUrl = String(resource?.secure_url || "").trim();
  const optimizedSrc = buildCloudinaryDeliveryUrl({
    cloudName,
    resourceType,
    publicId,
    format,
    version
  });
  const normalized = {
    src: optimizedSrc || secureUrl || "",
    type: resourceType,
    publicId,
    version,
    createdAtMs: Date.parse(resource?.created_at || "") || 0
  };

  if (!normalized.src && format) {
    normalized.src = buildCloudinaryDeliveryUrl({
      cloudName,
      resourceType,
      publicId,
      format,
      version
    });
  }
  if (!normalized.src) {
    normalized.src = secureUrl;
  }
  if (!normalized.src) {
    return null;
  }

  if (resourceType === "image") {
    normalized.duration = defaultImageDurationMs;
    const title = String(resource?.context?.custom?.title || "").trim();
    if (title) {
      normalized.title = title.slice(0, 120);
    }
  }

  return normalized;
}

async function loadCloudinaryTaggedPlaylist() {
  const config = await getCloudinaryListConfig();
  if (!config) {
    return [];
  }

  const cacheAgeMs = Date.now() - cachedCloudinaryPlaylistAt;
  if (cachedCloudinaryPlaylist.length && cacheAgeMs < CLOUDINARY_LIST_CACHE_MS) {
    return cachedCloudinaryPlaylist.map((item) => ({ ...item }));
  }

  const [imagesResult, videosResult] = await Promise.allSettled([
    fetchCloudinaryResourceList(config, "image"),
    fetchCloudinaryResourceList(config, "video")
  ]);
  const images = imagesResult.status === "fulfilled" ? imagesResult.value : [];
  const videos = videosResult.status === "fulfilled" ? videosResult.value : [];

  if (imagesResult.status === "rejected" && videosResult.status === "rejected") {
    if (cachedCloudinaryPlaylist.length) {
      return cachedCloudinaryPlaylist.map((item) => ({ ...item }));
    }
    throw imagesResult.reason || videosResult.reason || new Error("Cloudinary list unavailable");
  }

  const items = [...images, ...videos]
    .map((item) => mapCloudinaryResource(item, config.defaultImageDurationMs, config.cloudName))
    .filter(Boolean)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, config.maxItems)
    .map(({ createdAtMs, ...item }) => item);

  cachedCloudinaryPlaylist = items.map((item) => ({ ...item }));
  cachedCloudinaryPlaylistAt = Date.now();
  return items;
}

async function readPlaylist() {
  const state = await readJsonState({
    kvKey: KV_KEY,
    cloudinaryKey: CLOUDINARY_STATE_KEY,
    memoryValue: inMemoryPlaylist
  });

  const rawItems = Array.isArray(state.value) ? state.value : state.value?.items;
  let items = normalizePlaylistItems(rawItems);
  let persistent = state.persistent;
  let writable = state.writable;
  let storage = state.storage;

  // If durable state is unavailable and no in-memory items exist, build from Cloudinary tag list.
  if (!persistent && !items.length) {
    try {
      const cloudinaryItems = normalizePlaylistItems(await loadCloudinaryTaggedPlaylist());
      if (cloudinaryItems.length) {
        items = cloudinaryItems;
        persistent = true;
        writable = false;
        storage = "cloudinary-list";
      }
    } catch {
      // Keep temporary in-memory fallback.
    }
  }

  return { items, persistent, writable, storage };
}

async function writePlaylist(items) {
  const normalized = normalizePlaylistItems(items);
  inMemoryPlaylist = normalized;

  const state = await writeJsonState({
    kvKey: KV_KEY,
    cloudinaryKey: CLOUDINARY_STATE_KEY,
    value: normalized
  });

  return {
    items: normalized,
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
