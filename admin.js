const SETTINGS_API_URL = "/api/settings";
const RUNTIME_CONFIG_URL = "runtime-config.json";
const API_BASE_STORAGE_KEY = "signageApiBaseUrl";
const FETCH_TIMEOUT_MS = 15000;
const CLOUDINARY_DEFAULT_TAG = "signage";
const CLOUDINARY_DEFAULT_MAX_ITEMS = 80;

const statusEl = document.getElementById("status");
const overlayToggleEl = document.getElementById("overlay-toggle");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const cloudinaryConfigEl = document.getElementById("cloudinary-config");
const cloudinaryFilesEl = document.getElementById("cloudinary-files");
const uploadCloudinaryBtn = document.getElementById("upload-cloudinary-btn");
const refreshCloudinaryBtn = document.getElementById("refresh-cloudinary-btn");
const cloudinaryListEl = document.getElementById("cloudinary-list");
const cloudinaryEmptyEl = document.getElementById("cloudinary-empty");

let apiBaseUrl = "";
let cloudinaryConfig = {
  enabled: false,
  cloudName: "",
  uploadPreset: "",
  tag: CLOUDINARY_DEFAULT_TAG,
  folder: "",
  defaultImageDurationMs: 10000,
  maxItems: CLOUDINARY_DEFAULT_MAX_ITEMS
};

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ffb3b3" : "#9ff3c5";
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
  const uploadPreset = String(raw.uploadPreset || "").trim();
  const tag = String(raw.tag || CLOUDINARY_DEFAULT_TAG).trim() || CLOUDINARY_DEFAULT_TAG;
  const folder = String(raw.folder || "").trim().replace(/^\/+|\/+$/g, "");
  const defaultImageDurationMs = Math.max(1000, Number(raw.defaultImageDurationMs) || 10000);
  const maxItems = Math.max(1, Math.min(300, Number(raw.maxItems) || CLOUDINARY_DEFAULT_MAX_ITEMS));

  return {
    enabled: Boolean(raw.enabled) && Boolean(cloudName) && Boolean(tag),
    cloudName,
    uploadPreset,
    tag,
    folder,
    defaultImageDurationMs,
    maxItems
  };
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

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestJson(url, options) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("API not found (404).");
    }
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

async function loadRuntimeConfig() {
  const fromStorage = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
  if (fromStorage) {
    apiBaseUrl = fromStorage;
  }

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
    if (!fromStorage) {
      apiBaseUrl = normalizeApiBaseUrl(payload?.apiBaseUrl || "");
    }
    cloudinaryConfig = normalizeCloudinaryConfig(payload?.cloudinary);
  } catch {
    // Optional config file.
  }
}

function renderCloudinaryConfigStatus() {
  const ready = cloudinaryConfig.enabled && cloudinaryConfig.uploadPreset;
  if (ready) {
    cloudinaryConfigEl.textContent = `Connected: ${cloudinaryConfig.cloudName} | tag: ${cloudinaryConfig.tag} | folder: ${cloudinaryConfig.folder || "(root)"}`;
    cloudinaryConfigEl.classList.remove("error-text");
    return;
  }

  cloudinaryConfigEl.textContent = "Cloudinary is not ready. Set runtime-config.json cloudinary.enabled=true plus cloudName and uploadPreset.";
  cloudinaryConfigEl.classList.add("error-text");
}

async function loadSettings() {
  const payload = await requestJson(buildApiUrl(SETTINGS_API_URL), { cache: "no-store" });
  overlayToggleEl.checked = payload.overlayEnabled !== false;
}

async function saveSettings() {
  await requestJson(buildApiUrl(SETTINGS_API_URL), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overlayEnabled: overlayToggleEl.checked })
  });
}

function getCloudinaryUploadUrl(file) {
  const resourceType = file.type.startsWith("video/") ? "video" : "image";
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryConfig.cloudName)}/${resourceType}/upload`;
}

async function uploadSingleFile(file) {
  const url = getCloudinaryUploadUrl(file);
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", cloudinaryConfig.uploadPreset);
  if (cloudinaryConfig.folder) {
    body.append("folder", cloudinaryConfig.folder);
  }
  if (cloudinaryConfig.tag) {
    body.append("tags", cloudinaryConfig.tag);
  }

  const response = await fetchWithTimeout(url, { method: "POST", body });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed for ${file.name}: ${response.status} ${errorText}`.slice(0, 240));
  }
}

async function fetchCloudinaryResourceList(resourceType) {
  const stamp = Date.now();
  const url = `https://res.cloudinary.com/${encodeURIComponent(cloudinaryConfig.cloudName)}/${resourceType}/list/${encodeURIComponent(cloudinaryConfig.tag)}.json?max_results=${cloudinaryConfig.maxItems}&_=${stamp}`;
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

function renderCloudinaryList(items) {
  cloudinaryListEl.innerHTML = "";
  cloudinaryEmptyEl.classList.toggle("hidden", items.length > 0);

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "playlist-item";

    const top = document.createElement("div");
    top.className = "item-top";

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.public_id || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const createdAt = item.created_at ? new Date(item.created_at).toLocaleString() : "";
    meta.textContent = `${(item.resource_type || "image").toUpperCase()}${createdAt ? ` | ${createdAt}` : ""}`;

    top.append(name, meta);
    card.appendChild(top);

    if (item.resource_type === "image" && item.secure_url) {
      const preview = document.createElement("img");
      preview.className = "cloudinary-preview";
      preview.src = item.secure_url;
      preview.alt = item.public_id || "Cloudinary image";
      card.appendChild(preview);
    }

    cloudinaryListEl.appendChild(card);
  }
}

async function refreshCloudinaryList() {
  if (!cloudinaryConfig.enabled) {
    renderCloudinaryList([]);
    return;
  }

  const [imagesResult, videosResult] = await Promise.allSettled([
    fetchCloudinaryResourceList("image"),
    fetchCloudinaryResourceList("video")
  ]);
  const images = imagesResult.status === "fulfilled" ? imagesResult.value : [];
  const videos = videosResult.status === "fulfilled" ? videosResult.value : [];

  if (imagesResult.status === "rejected" && videosResult.status === "rejected") {
    throw imagesResult.reason || videosResult.reason || new Error("Cloudinary list failed");
  }

  const items = [...images, ...videos]
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))
    .slice(0, cloudinaryConfig.maxItems);

  renderCloudinaryList(items);
}

async function handleUploadClick() {
  const files = Array.from(cloudinaryFilesEl.files || []);
  if (!files.length) {
    showStatus("Select at least one file to upload.", true);
    return;
  }
  if (!cloudinaryConfig.enabled || !cloudinaryConfig.uploadPreset) {
    showStatus("Cloudinary is not configured. Update runtime-config.json first.", true);
    return;
  }

  uploadCloudinaryBtn.disabled = true;
  refreshCloudinaryBtn.disabled = true;

  try {
    let uploaded = 0;
    for (const file of files) {
      showStatus(`Uploading ${uploaded + 1}/${files.length}: ${file.name}`);
      await uploadSingleFile(file);
      uploaded += 1;
    }

    cloudinaryFilesEl.value = "";
    await refreshCloudinaryList();
    showStatus(`Uploaded ${uploaded} file(s). Signage will auto-pull from Cloudinary.`);
  } catch (error) {
    showStatus(error.message || "Cloudinary upload failed", true);
  } finally {
    uploadCloudinaryBtn.disabled = false;
    refreshCloudinaryBtn.disabled = false;
  }
}

saveSettingsBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    showStatus("Overlay setting updated.");
  } catch (error) {
    showStatus(error.message || "Save settings failed", true);
  }
});

overlayToggleEl.addEventListener("change", async () => {
  try {
    await saveSettings();
    showStatus("Overlay setting updated.");
  } catch (error) {
    showStatus(error.message || "Save settings failed", true);
  }
});

uploadCloudinaryBtn.addEventListener("click", handleUploadClick);
refreshCloudinaryBtn.addEventListener("click", async () => {
  try {
    await refreshCloudinaryList();
    showStatus("Cloudinary list refreshed.");
  } catch (error) {
    showStatus(error.message || "Unable to refresh Cloudinary list", true);
  }
});

async function initAdmin() {
  await loadRuntimeConfig();
  renderCloudinaryConfigStatus();

  try {
    await loadSettings();
  } catch (error) {
    showStatus(error.message || "Failed to load overlay settings", true);
  }

  try {
    await refreshCloudinaryList();
    if (!statusEl.textContent) {
      showStatus("Admin loaded.");
    }
  } catch (error) {
    showStatus(
      `${error.message || "Cloudinary list failed"} Enable Cloudinary 'Resource list' for tagged media.`,
      true
    );
  }
}

initAdmin();
