const SETTINGS_API_URL = "/api/settings";
const PLAYLIST_API_URL = "/api/playlist";
const SESSION_API_URL = "/api/session";
const LOGOUT_API_URL = "/api/logout";
const SIGNATURE_API_URL = "/api/cloudinary-signature";
const RUNTIME_CONFIG_URL = "runtime-config.json";
const OVERLAY_STATE_STORAGE_KEY = "revivalOverlayEnabled";
const FETCH_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_IMAGE_MS = 10000;
const CLOUDINARY_DEFAULT_TAG = "signage";
const CLOUDINARY_DEFAULT_MAX_ITEMS = 80;
const MAX_CUSTOM_TICKER_ITEMS = 40;
const MAX_CUSTOM_TICKER_ITEM_LENGTH = 160;

const statusEl = document.getElementById("status");
const overlayToggleBtnEl = document.getElementById("overlay-toggle-btn");
const customTickerInputEl = document.getElementById("custom-ticker-input");
const addCustomTickerBtnEl = document.getElementById("add-custom-ticker-btn");
const customTickerEmptyEl = document.getElementById("custom-ticker-empty");
const customTickerListEl = document.getElementById("custom-ticker-list");
const logoutBtn = document.getElementById("logout-btn");
const cloudinaryConfigEl = document.getElementById("cloudinary-config");
const cloudinaryFilesEl = document.getElementById("cloudinary-files");
const uploadImageTitleEl = document.getElementById("upload-image-title");
const uploadCloudinaryBtn = document.getElementById("upload-cloudinary-btn");
const refreshCloudinaryBtn = document.getElementById("refresh-cloudinary-btn");
const cloudinaryListEl = document.getElementById("cloudinary-list");
const cloudinaryEmptyEl = document.getElementById("cloudinary-empty");
const persistenceWarningEl = document.getElementById("persistence-warning");

let apiBaseUrl = "";
let playlist = [];
let overlayEnabledState = true;
let customTickerItems = [];
let playlistPersistence = { persistent: true, writable: true, storage: "unknown" };
let settingsPersistence = { persistent: true, writable: true, storage: "unknown" };
let cloudinaryConfig = {
  enabled: false,
  cloudName: "",
  uploadMode: "unsigned",
  uploadPreset: "",
  tag: CLOUDINARY_DEFAULT_TAG,
  folder: "",
  defaultImageDurationMs: DEFAULT_IMAGE_MS,
  maxItems: CLOUDINARY_DEFAULT_MAX_ITEMS
};

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ffb3b3" : "#9ff3c5";
}

function renderPersistenceWarning() {
  if (!persistenceWarningEl) {
    return;
  }

  const messages = [];
  if (playlistPersistence.writable === false) {
    messages.push("Content list is read-only (Cloudinary auto list). Configure KV or Cloudinary API key/secret to save edits.");
  } else if (playlistPersistence.persistent === false) {
    messages.push("Content list is temporary, may reset after deployment, and can differ across devices. Configure KV or Cloudinary API key/secret for persistence.");
  }

  if (settingsPersistence.persistent === false) {
    messages.push("Overlay and bottom bar custom text are temporary and can reset after deployment.");
  }

  if (!messages.length) {
    persistenceWarningEl.textContent = "";
    persistenceWarningEl.classList.add("hidden");
    return;
  }

  persistenceWarningEl.textContent = messages.join(" ");
  persistenceWarningEl.classList.remove("hidden");
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
}

function normalizeCloudinaryConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const cloudName = String(raw.cloudName || "").trim();
  const uploadModeRaw = String(raw.uploadMode || "").trim().toLowerCase();
  const uploadMode = uploadModeRaw === "signed" ? "signed" : "unsigned";
  const uploadPreset = String(raw.uploadPreset || "").trim();
  const tag = String(raw.tag || CLOUDINARY_DEFAULT_TAG).trim() || CLOUDINARY_DEFAULT_TAG;
  const folder = String(raw.folder || "").trim().replace(/^\/+|\/+$/g, "");
  const defaultImageDurationMs = Math.max(1000, Number(raw.defaultImageDurationMs) || DEFAULT_IMAGE_MS);
  const maxItems = Math.max(1, Math.min(300, Number(raw.maxItems) || CLOUDINARY_DEFAULT_MAX_ITEMS));

  return {
    enabled: Boolean(raw.enabled) && Boolean(cloudName) && Boolean(tag),
    cloudName,
    uploadMode,
    uploadPreset,
    tag,
    folder,
    defaultImageDurationMs,
    maxItems
  };
}

function normalizePlaylistItem(item) {
  const src = String(item?.src || item?.file || "").trim();
  if (!src) {
    return null;
  }

  const type = String(item?.type || "").toLowerCase() === "video" ? "video" : "image";
  const normalized = { src, type };
  if (type === "image") {
    normalized.duration = Math.max(1000, Number(item?.duration) || cloudinaryConfig.defaultImageDurationMs);
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
}

async function fetchCloudinaryResourceList(resourceType) {
  const cloudName = String(cloudinaryConfig.cloudName || "").trim();
  const tag = String(cloudinaryConfig.tag || "").trim();
  const maxItems = Math.max(1, Number(cloudinaryConfig.maxItems) || CLOUDINARY_DEFAULT_MAX_ITEMS);
  if (!cloudName || !tag) {
    return [];
  }

  const url = `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resourceType}/list/${encodeURIComponent(tag)}.json?max_results=${maxItems}&_=${Date.now()}`;
  const response = await fetchWithTimeout(url, { cache: "no-store" });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Cloudinary ${resourceType} list HTTP ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.resources) ? payload.resources : [];
}

function mapCloudinaryResourceToPlaylistItem(resource) {
  const type = String(resource?.resource_type || "").toLowerCase() === "video" ? "video" : "image";
  const publicId = String(resource?.public_id || "").trim();
  if (!publicId) {
    return null;
  }

  const secureUrl = String(resource?.secure_url || "").trim();
  if (!secureUrl) {
    return null;
  }

  const item = {
    src: secureUrl,
    type,
    publicId,
    createdAtMs: Date.parse(resource?.created_at || "") || 0
  };

  if (type === "image") {
    item.duration = cloudinaryConfig.defaultImageDurationMs;
  }

  return item;
}

async function loadCloudinaryFallbackPlaylist() {
  if (!cloudinaryConfig.enabled) {
    return [];
  }

  const [imagesResult, videosResult] = await Promise.allSettled([
    fetchCloudinaryResourceList("image"),
    fetchCloudinaryResourceList("video")
  ]);

  const images = imagesResult.status === "fulfilled" ? imagesResult.value : [];
  const videos = videosResult.status === "fulfilled" ? videosResult.value : [];
  if (imagesResult.status === "rejected" && videosResult.status === "rejected") {
    throw imagesResult.reason || videosResult.reason || new Error("Cloudinary fallback list unavailable");
  }

  return [...images, ...videos]
    .map(mapCloudinaryResourceToPlaylistItem)
    .filter(Boolean)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, cloudinaryConfig.maxItems)
    .map(({ createdAtMs, ...item }) => item);
}

function parseBooleanValue(value) {
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
  return null;
}

function normalizeCustomTickerItemText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CUSTOM_TICKER_ITEM_LENGTH);
}

function normalizeCustomTickerItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const text = normalizeCustomTickerItemText(item);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= MAX_CUSTOM_TICKER_ITEMS) {
      break;
    }
  }

  return normalized;
}

function readOverlayStateFromStorage() {
  try {
    return parseBooleanValue(window.localStorage.getItem(OVERLAY_STATE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeOverlayStateToStorage(value) {
  try {
    window.localStorage.setItem(OVERLAY_STATE_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Ignore storage failures.
  }
}

function renderOverlayToggleButton() {
  if (!overlayToggleBtnEl) {
    return;
  }
  overlayToggleBtnEl.textContent = overlayEnabledState ? "Overlay: ON" : "Overlay: OFF";
  overlayToggleBtnEl.classList.toggle("is-on", overlayEnabledState);
  overlayToggleBtnEl.classList.toggle("is-off", !overlayEnabledState);
}

async function persistCustomTickerItems(successMessage) {
  customTickerItems = normalizeCustomTickerItems(customTickerItems);
  await saveSettingsPatch({ customTickerItems }, successMessage);
}

function renderCustomTickerList() {
  if (!customTickerListEl || !customTickerEmptyEl) {
    return;
  }

  customTickerListEl.innerHTML = "";
  customTickerEmptyEl.classList.toggle("hidden", customTickerItems.length > 0);

  customTickerItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "ticker-item";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = MAX_CUSTOM_TICKER_ITEM_LENGTH;
    input.value = item;
    input.placeholder = "Ticker text";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "secondary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const value = normalizeCustomTickerItemText(input.value);
      if (!value) {
        showStatus("Ticker text cannot be empty.", true);
        input.focus();
        return;
      }

      customTickerItems[index] = value;
      try {
        await persistCustomTickerItems("Ticker text updated.");
      } catch (error) {
        showStatus(error.message || "Unable to save ticker text", true);
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "secondary";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      customTickerItems = customTickerItems.filter((_, i) => i !== index);
      try {
        await persistCustomTickerItems("Ticker text deleted.");
      } catch (error) {
        showStatus(error.message || "Unable to delete ticker text", true);
      }
    });

    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      saveBtn.click();
    });

    row.append(input, saveBtn, deleteBtn);
    customTickerListEl.appendChild(row);
  });
}

function buildApiUrl(pathname) {
  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }
  if (!apiBaseUrl) {
    return pathname;
  }
  return `${apiBaseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function buildNoCacheApiUrl(pathname) {
  const url = buildApiUrl(pathname);
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function requestJson(url, options) {
  const response = await fetchWithTimeout(url, {
    credentials: "same-origin",
    ...options
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Unauthorized. Please login again.");
    }
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

async function loadRuntimeConfig() {
  try {
    const response = await fetchWithTimeout(RUNTIME_CONFIG_URL, { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return;
    }

    const payload = await response.json();
    apiBaseUrl = normalizeApiBaseUrl(payload?.apiBaseUrl || "");
    cloudinaryConfig = normalizeCloudinaryConfig(payload?.cloudinary);
  } catch {
    // Optional config file.
  }
}

function renderCloudinaryConfigStatus() {
  if (!cloudinaryConfigEl) {
    return;
  }

  if (cloudinaryConfig.enabled) {
    cloudinaryConfigEl.textContent = "";
    cloudinaryConfigEl.classList.remove("error-text");
    return;
  }

  cloudinaryConfigEl.textContent = "Upload service is not enabled.";
  cloudinaryConfigEl.classList.add("error-text");
}

async function ensureAuthenticated() {
  const payload = await requestJson(buildApiUrl(SESSION_API_URL), { cache: "no-store" });
  if (!payload?.authenticated) {
    window.location.replace("/admin-login.html");
    throw new Error("Unauthorized");
  }
}

async function loadSettings() {
  const payload = await requestJson(buildNoCacheApiUrl(SETTINGS_API_URL), { cache: "no-store" });
  const apiValue = payload.overlayEnabled !== false;
  const storedValue = readOverlayStateFromStorage();
  settingsPersistence = {
    persistent: payload.persistent !== false,
    writable: payload.writable !== false,
    storage: String(payload.storage || "")
  };
  overlayEnabledState = payload.persistent === false && storedValue !== null ? storedValue : apiValue;
  customTickerItems = normalizeCustomTickerItems(payload?.customTickerItems || []);
  renderOverlayToggleButton();
  renderCustomTickerList();
  writeOverlayStateToStorage(overlayEnabledState);
  renderPersistenceWarning();

  // If server state reset but browser remembers user's last selection, push it back.
  if (overlayEnabledState !== apiValue) {
    await saveSettingsPatch({ overlayEnabled: overlayEnabledState }, false);
  }
}

async function saveSettingsPatch(patch, successMessage = "") {
  const payload = await requestJson(buildApiUrl(SETTINGS_API_URL), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {})
  });

  overlayEnabledState = payload.overlayEnabled !== false;
  customTickerItems = normalizeCustomTickerItems(payload?.customTickerItems || customTickerItems);
  renderOverlayToggleButton();
  renderCustomTickerList();
  writeOverlayStateToStorage(overlayEnabledState);

  settingsPersistence = {
    persistent: payload.persistent !== false,
    writable: payload.writable !== false,
    storage: String(payload.storage || "")
  };
  renderPersistenceWarning();

  if (successMessage) {
    showStatus(successMessage);
  }
}

async function loadPlaylist() {
  let payload = null;
  try {
    payload = await requestJson(buildNoCacheApiUrl(PLAYLIST_API_URL), { cache: "no-store" });
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    playlist = rawItems.map(normalizePlaylistItem).filter(Boolean);
    playlistPersistence = {
      persistent: payload.persistent !== false,
      writable: payload.writable !== false,
      storage: String(payload.storage || "")
    };
  } catch (error) {
    playlist = [];
    playlistPersistence = {
      persistent: false,
      writable: false,
      storage: "unavailable"
    };
  }

  if (!playlist.length) {
    try {
      const cloudinaryItems = await loadCloudinaryFallbackPlaylist();
      if (cloudinaryItems.length) {
        playlist = cloudinaryItems.map(normalizePlaylistItem).filter(Boolean);
        playlistPersistence = {
          persistent: true,
          writable: false,
          storage: "cloudinary-list"
        };
      }
    } catch {
      // Keep API result/failure state.
    }
  }

  renderPersistenceWarning();
}

async function savePlaylist() {
  const normalized = playlist.map(normalizePlaylistItem).filter(Boolean);
  playlist = normalized;
  const payload = await requestJson(buildApiUrl(PLAYLIST_API_URL), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: normalized })
  });
  playlistPersistence = {
    persistent: payload.persistent !== false,
    writable: payload.writable !== false,
    storage: String(payload.storage || "")
  };
  renderPersistenceWarning();
}

async function savePlaylistWithStatus(message = "Content list saved.") {
  await savePlaylist();
  await loadPlaylist();
  renderPlaylist();
  showStatus(message);
}

function swapItems(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= playlist.length) {
    return;
  }
  const next = [...playlist];
  const temp = next[fromIndex];
  next[fromIndex] = next[toIndex];
  next[toIndex] = temp;
  playlist = next;
  renderPlaylist();
}

function inferPublicIdFromCloudinaryVideoUrl(src) {
  const value = String(src || "").trim();
  if (!value.includes("/video/upload/")) {
    return "";
  }
  try {
    const parsed = new URL(value);
    const marker = "/video/upload/";
    const markerIdx = parsed.pathname.indexOf(marker);
    if (markerIdx < 0) {
      return "";
    }

    const tail = parsed.pathname.slice(markerIdx + marker.length);
    const segments = tail.split("/").filter(Boolean);
    if (!segments.length) {
      return "";
    }

    const versionIndex = segments.findIndex((part) => /^v\d+$/.test(part));
    const publicSegments = versionIndex >= 0 ? segments.slice(versionIndex + 1) : segments;
    if (!publicSegments.length) {
      return "";
    }

    const filePart = publicSegments[publicSegments.length - 1];
    publicSegments[publicSegments.length - 1] = filePart.replace(/\.[a-z0-9]+$/i, "");
    return publicSegments.join("/");
  } catch {
    return "";
  }
}

function getVideoThumbnailUrl(item) {
  const publicId = String(item?.publicId || "").trim() || inferPublicIdFromCloudinaryVideoUrl(item?.src);
  if (!publicId || !cloudinaryConfig.cloudName) {
    return "";
  }
  return `https://res.cloudinary.com/${encodeURIComponent(cloudinaryConfig.cloudName)}/video/upload/so_0,f_jpg,w_640,c_fill/${publicId}.jpg`;
}

function renderPlaylist() {
  const isReadOnly = playlistPersistence.writable === false;
  cloudinaryListEl.innerHTML = "";
  cloudinaryEmptyEl.classList.toggle("hidden", playlist.length > 0);
  cloudinaryEmptyEl.textContent = isReadOnly
    ? "No managed playlist items. Showing Cloudinary list fallback."
    : "No content items configured yet.";

  playlist.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "playlist-item";

    const top = document.createElement("div");
    top.className = "item-top";

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.publicId || item.src;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.type.toUpperCase()} | Position ${index + 1}`;

    top.append(name, meta);
    card.appendChild(top);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "secondary";
    upBtn.textContent = "Move Up";
    upBtn.disabled = isReadOnly;
    upBtn.addEventListener("click", async () => {
      swapItems(index, index - 1);
      try {
        await savePlaylistWithStatus("Content list updated.");
      } catch (error) {
        showStatus(error.message || "Unable to save content list", true);
      }
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "secondary";
    downBtn.textContent = "Move Down";
    downBtn.disabled = isReadOnly;
    downBtn.addEventListener("click", async () => {
      swapItems(index, index + 1);
      try {
        await savePlaylistWithStatus("Content list updated.");
      } catch (error) {
        showStatus(error.message || "Unable to save content list", true);
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary";
    removeBtn.textContent = "Remove";
    removeBtn.disabled = isReadOnly;
    removeBtn.addEventListener("click", async () => {
      playlist = playlist.filter((_, i) => i !== index);
      try {
        await savePlaylistWithStatus("Item removed from content list.");
      } catch (error) {
        showStatus(error.message || "Unable to save content list", true);
      }
    });

    actions.append(upBtn, downBtn, removeBtn);

    if (item.type === "image") {
      const titleLabel = document.createElement("label");
      titleLabel.textContent = "Heading";

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.maxLength = 120;
      titleInput.value = String(item.title || "");
      titleInput.placeholder = "Image heading";
      titleInput.disabled = isReadOnly;
      titleInput.addEventListener("input", () => {
        item.title = String(titleInput.value || "").trim().slice(0, 120);
      });
      titleInput.addEventListener("change", async () => {
        try {
          await savePlaylistWithStatus("Image heading updated.");
        } catch (error) {
          showStatus(error.message || "Unable to save content list", true);
        }
      });
      titleLabel.appendChild(titleInput);
      actions.appendChild(titleLabel);

      const durationLabel = document.createElement("label");
      durationLabel.textContent = "Duration (ms)";

      const durationInput = document.createElement("input");
      durationInput.type = "number";
      durationInput.min = "1000";
      durationInput.step = "500";
      durationInput.value = String(item.duration || cloudinaryConfig.defaultImageDurationMs);
      durationInput.disabled = isReadOnly;
      durationInput.addEventListener("input", () => {
        item.duration = Math.max(1000, Number(durationInput.value) || cloudinaryConfig.defaultImageDurationMs);
      });
      durationInput.addEventListener("change", async () => {
        try {
          await savePlaylistWithStatus("Image duration updated.");
        } catch (error) {
          showStatus(error.message || "Unable to save content list", true);
        }
      });

      durationLabel.appendChild(durationInput);
      actions.appendChild(durationLabel);
    }

    card.appendChild(actions);

    const preview = document.createElement("img");
    preview.className = "cloudinary-preview";
    preview.src = item.type === "video" ? getVideoThumbnailUrl(item) : item.src;
    preview.alt = item.publicId || (item.type === "video" ? "Cloudinary video thumbnail" : "Cloudinary image");
    preview.addEventListener("error", () => preview.remove(), { once: true });
    card.appendChild(preview);

    cloudinaryListEl.appendChild(card);
  });
}

async function getUploadSignature(resourceType) {
  return requestJson(buildApiUrl(SIGNATURE_API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resourceType })
  });
}

function mapCloudinaryUploadToPlaylistItem(payload, fallbackType, imageTitle) {
  const type = String(payload?.resource_type || fallbackType || "").toLowerCase() === "video" ? "video" : "image";
  const src = String(payload?.secure_url || "").trim();
  const publicId = String(payload?.public_id || "").trim();
  if (!src) {
    return null;
  }

  const item = { src, type };
  if (publicId) {
    item.publicId = publicId;
  }
  if (type === "image") {
    item.duration = cloudinaryConfig.defaultImageDurationMs;
    const title = String(imageTitle || "").trim();
    if (title) {
      item.title = title.slice(0, 120);
    }
  }
  return item;
}

async function uploadUnsignedFile(file, resourceType, uploadPreset, imageTitle) {
  const uploadUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryConfig.cloudName)}/${resourceType}/upload`;
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", uploadPreset);
  if (cloudinaryConfig.folder) {
    body.append("folder", cloudinaryConfig.folder);
  }
  if (cloudinaryConfig.tag) {
    body.append("tags", cloudinaryConfig.tag);
  }

  const response = await fetchWithTimeout(uploadUrl, { method: "POST", body }, UPLOAD_TIMEOUT_MS);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Upload failed for ${file.name}: ${response.status} ${raw}`.slice(0, 260));
  }
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  return mapCloudinaryUploadToPlaylistItem(payload, resourceType, imageTitle);
}

async function uploadSingleFile(file, imageTitle) {
  const resourceType = file.type.startsWith("video/") ? "video" : "image";

  if (cloudinaryConfig.uploadMode !== "signed") {
    const preset = String(cloudinaryConfig.uploadPreset || "").trim();
    if (!preset) {
      throw new Error("Unsigned mode requires cloudinary.uploadPreset in runtime-config.json");
    }
    return uploadUnsignedFile(file, resourceType, preset, imageTitle);
  }

  let signed = null;
  try {
    signed = await getUploadSignature(resourceType);
  } catch (error) {
    const canFallbackUnsigned = Boolean(cloudinaryConfig.uploadPreset);
    if (!canFallbackUnsigned) {
      throw error;
    }
    return uploadUnsignedFile(file, resourceType, cloudinaryConfig.uploadPreset, imageTitle);
  }

  if (signed?.mode === "unsigned" || signed?.uploadPreset) {
    const preset = String(signed.uploadPreset || cloudinaryConfig.uploadPreset || "").trim();
    if (!preset) {
      throw new Error("Cloudinary upload preset is missing for unsigned mode.");
    }
    return uploadUnsignedFile(file, resourceType, preset, imageTitle);
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/${resourceType}/upload`;
  const body = new FormData();
  body.append("file", file);
  body.append("api_key", signed.apiKey);
  body.append("timestamp", String(signed.timestamp));
  body.append("signature", signed.signature);
  if (signed.folder) {
    body.append("folder", signed.folder);
  }
  if (signed.tags) {
    body.append("tags", signed.tags);
  }

  const response = await fetchWithTimeout(uploadUrl, { method: "POST", body }, UPLOAD_TIMEOUT_MS);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Upload failed for ${file.name}: ${response.status} ${raw}`.slice(0, 260));
  }
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  return mapCloudinaryUploadToPlaylistItem(payload, resourceType, imageTitle);
}

async function handleUploadClick() {
  const files = Array.from(cloudinaryFilesEl.files || []);
  if (!files.length) {
    showStatus("Select at least one file to upload.", true);
    return;
  }
  if (!cloudinaryConfig.enabled) {
    showStatus("Upload service is not enabled.", true);
    return;
  }

  const imageTitle = String(uploadImageTitleEl?.value || "").trim().slice(0, 120);

  uploadCloudinaryBtn.disabled = true;
  if (refreshCloudinaryBtn) {
    refreshCloudinaryBtn.disabled = true;
  }

  try {
    let uploaded = 0;
    const failed = [];
    let saveFailedCount = 0;
    for (const file of files) {
      showStatus(`Uploading ${uploaded + 1}/${files.length}: ${file.name}`);
      try {
        const uploadedItem = await uploadSingleFile(file, imageTitle);
        if (uploadedItem) {
          playlist.unshift(uploadedItem);
          try {
            await savePlaylist();
          } catch {
            saveFailedCount += 1;
          }
          uploaded += 1;
        }
      } catch (error) {
        if ((error.message || "").includes("Unauthorized")) {
          window.location.replace("/admin-login.html");
          return;
        }
        if (error?.name === "AbortError") {
          failed.push(`${file.name}: upload timed out`);
          continue;
        }
        failed.push(`${file.name}: ${error.message || "upload failed"}`);
      }
    }

    cloudinaryFilesEl.value = "";
    if (uploadImageTitleEl) {
      uploadImageTitleEl.value = "";
    }
    await loadPlaylist();
    renderPlaylist();

    if (failed.length || saveFailedCount > 0) {
      const suffix = failed.length > 2 ? ` (+${failed.length - 2} more)` : "";
      const failedMsg = failed.slice(0, 2).join(" | ");
      const saveMsg = saveFailedCount > 0 ? ` Playlist save unavailable for ${saveFailedCount} item(s); using fallback list.` : "";
      showStatus(`Uploaded ${uploaded}/${files.length}. ${failedMsg}${suffix}${saveMsg}`.trim(), true);
    } else {
      showStatus(`Uploaded ${uploaded} file(s) and added to content list.`);
    }
  } catch (error) {
    showStatus(error.message || "Upload failed", true);
  } finally {
    uploadCloudinaryBtn.disabled = false;
    if (refreshCloudinaryBtn) {
      refreshCloudinaryBtn.disabled = false;
    }
  }
}

overlayToggleBtnEl.addEventListener("click", async () => {
  const nextValue = !overlayEnabledState;
  overlayToggleBtnEl.disabled = true;
  try {
    await saveSettingsPatch({ overlayEnabled: nextValue }, "Overlay setting updated.");
  } catch (error) {
    if ((error.message || "").includes("Unauthorized")) {
      window.location.replace("/admin-login.html");
      return;
    }
    showStatus(error.message || "Save settings failed", true);
    overlayEnabledState = !nextValue;
    renderOverlayToggleButton();
  } finally {
    overlayToggleBtnEl.disabled = false;
  }
});

if (addCustomTickerBtnEl) {
  addCustomTickerBtnEl.addEventListener("click", async () => {
    const value = normalizeCustomTickerItemText(customTickerInputEl?.value || "");
    if (!value) {
      showStatus("Type a ticker text before adding.", true);
      return;
    }

    customTickerItems = normalizeCustomTickerItems([value, ...customTickerItems]);
    addCustomTickerBtnEl.disabled = true;
    try {
      await persistCustomTickerItems("Ticker text added.");
      if (customTickerInputEl) {
        customTickerInputEl.value = "";
      }
    } catch (error) {
      showStatus(error.message || "Unable to add ticker text", true);
    } finally {
      addCustomTickerBtnEl.disabled = false;
    }
  });
}

if (customTickerInputEl) {
  customTickerInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTickerBtnEl?.click();
    }
  });
}

uploadCloudinaryBtn.addEventListener("click", handleUploadClick);
if (refreshCloudinaryBtn) {
  refreshCloudinaryBtn.addEventListener("click", async () => {
    try {
      await loadPlaylist();
      renderPlaylist();
      showStatus("Content list reloaded.");
    } catch (error) {
      showStatus(error.message || "Unable to reload content list", true);
    }
  });
}

logoutBtn.addEventListener("click", async () => {
  try {
    await requestJson(buildApiUrl(LOGOUT_API_URL), { method: "POST" });
  } catch {
    // Force logout redirect regardless of API status.
  }
  window.location.replace("/admin-login.html");
});

async function initAdmin() {
  await loadRuntimeConfig();
  await ensureAuthenticated();
  renderCloudinaryConfigStatus();
  renderOverlayToggleButton();
  renderCustomTickerList();

  try {
    await loadSettings();
  } catch (error) {
    const storedValue = readOverlayStateFromStorage();
    if (storedValue !== null) {
      overlayEnabledState = storedValue;
      renderOverlayToggleButton();
    }
    showStatus(error.message || "Failed to load settings", true);
  }

  try {
    await loadPlaylist();
    renderPlaylist();
    if (!statusEl.textContent) {
      showStatus("Admin loaded.");
    }
  } catch (error) {
    showStatus(error.message || "Unable to load content list", true);
  }
}

initAdmin().catch((error) => {
  if ((error.message || "").includes("Unauthorized")) {
    return;
  }
  showStatus(error.message || "Failed to initialize admin", true);
});
