const playlistListEl = document.getElementById("playlist-list");
const playlistEmptyEl = document.getElementById("playlist-empty");
const statusEl = document.getElementById("status");
const reloadBtn = document.getElementById("reload-btn");
const savePlaylistBtn = document.getElementById("save-playlist-btn");
const overlayToggleEl = document.getElementById("overlay-toggle");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const apiBaseUrlEl = document.getElementById("api-base-url");
const saveApiBaseBtn = document.getElementById("save-api-base-btn");

const API_BASE_STORAGE_KEY = "signageApiBaseUrl";
const RUNTIME_CONFIG_URL = "runtime-config.json";

let playlist = [];
let apiBaseUrl = "";

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ffb3b3" : "#9ff3c5";
}

async function requestJson(url, options) {
  const response = await fetch(buildApiUrl(url), options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("API not found (404). Set Backend API URL correctly.");
    }
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
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

async function loadRuntimeConfigApiBase() {
  try {
    const response = await fetch(RUNTIME_CONFIG_URL, { cache: "no-store" });
    if (!response.ok) {
      return "";
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return "";
    }
    const payload = await response.json();
    return normalizeApiBaseUrl(payload?.apiBaseUrl || "");
  } catch {
    return "";
  }
}

async function initializeApiBase() {
  const fromStorage = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
  const fromConfig = await loadRuntimeConfigApiBase();
  apiBaseUrl = fromStorage || fromConfig || "";
  if (apiBaseUrlEl) {
    apiBaseUrlEl.value = apiBaseUrl;
  }
}

function swapItems(from, to) {
  if (to < 0 || to >= playlist.length) {
    return;
  }
  const next = [...playlist];
  const temp = next[from];
  next[from] = next[to];
  next[to] = temp;
  playlist = next;
  renderPlaylist();
}

function renderPlaylist() {
  playlistListEl.innerHTML = "";
  playlistEmptyEl.classList.toggle("hidden", playlist.length > 0);

  playlist.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "playlist-item";

    const top = document.createElement("div");
    top.className = "item-top";

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.file;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.type.toUpperCase()} - Position ${index + 1}`;

    top.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "secondary";
    upBtn.textContent = "Move Up";
    upBtn.addEventListener("click", () => swapItems(index, index - 1));

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "secondary";
    downBtn.textContent = "Move Down";
    downBtn.addEventListener("click", () => swapItems(index, index + 1));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      playlist = playlist.filter((_, i) => i !== index);
      renderPlaylist();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "secondary";
    deleteBtn.textContent = "Delete File";
    deleteBtn.addEventListener("click", async () => {
      const ok = window.confirm(`Delete file "${item.file}" from disk and playlist?`);
      if (!ok) {
        return;
      }
      try {
        await requestJson(`/api/media/${encodeURIComponent(item.file)}`, { method: "DELETE" });
        await loadPlaylist();
        showStatus(`Deleted ${item.file}`);
      } catch (error) {
        showStatus(error.message || "Delete failed", true);
      }
    });

    actions.append(upBtn, downBtn, removeBtn, deleteBtn);

    if (item.type === "image") {
      const durationLabel = document.createElement("label");
      durationLabel.textContent = "Duration (ms)";

      const durationInput = document.createElement("input");
      durationInput.type = "number";
      durationInput.min = "1000";
      durationInput.step = "500";
      durationInput.value = String(item.duration || 10000);
      durationInput.addEventListener("input", () => {
        item.duration = Math.max(1000, Number(durationInput.value) || 10000);
      });

      durationLabel.appendChild(durationInput);
      actions.appendChild(durationLabel);
    }

    card.append(top, actions);
    playlistListEl.appendChild(card);
  });
}

async function loadPlaylist() {
  const payload = await requestJson("/api/playlist");
  playlist = Array.isArray(payload?.items) ? payload.items : [];
  renderPlaylist();
}

async function savePlaylist() {
  await requestJson("/api/playlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: playlist })
  });
}

async function loadSettings() {
  const payload = await requestJson("/api/settings");
  overlayToggleEl.checked = payload.overlayEnabled !== false;
}

async function saveSettings() {
  await requestJson("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overlayEnabled: overlayToggleEl.checked })
  });
}

reloadBtn.addEventListener("click", async () => {
  try {
    await Promise.all([loadPlaylist(), loadSettings()]);
    showStatus("Data reloaded.");
  } catch (error) {
    showStatus(error.message || "Reload failed", true);
  }
});

savePlaylistBtn.addEventListener("click", async () => {
  try {
    await savePlaylist();
    showStatus("Playlist saved.");
  } catch (error) {
    showStatus(error.message || "Save failed", true);
  }
});

saveSettingsBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    showStatus("Overlay setting updated.");
  } catch (error) {
    showStatus(error.message || "Save settings failed", true);
  }
});

saveApiBaseBtn.addEventListener("click", async () => {
  apiBaseUrl = normalizeApiBaseUrl(apiBaseUrlEl.value);
  if (apiBaseUrl) {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, apiBaseUrl);
  } else {
    window.localStorage.removeItem(API_BASE_STORAGE_KEY);
  }

  try {
    await Promise.all([loadPlaylist(), loadSettings()]);
    showStatus("Backend API URL applied.");
  } catch (error) {
    showStatus(error.message || "Backend API URL applied, but API check failed.", true);
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

async function initAdmin() {
  await initializeApiBase();
  try {
    await Promise.all([loadPlaylist(), loadSettings()]);
    showStatus("Admin loaded.");
  } catch (error) {
    showStatus(error.message || "Failed to load admin", true);
  }
}

initAdmin();
