const playlistListEl = document.getElementById("playlist-list");
const playlistEmptyEl = document.getElementById("playlist-empty");
const statusEl = document.getElementById("status");
const reloadBtn = document.getElementById("reload-btn");
const savePlaylistBtn = document.getElementById("save-playlist-btn");
const uploadForm = document.getElementById("upload-form");
const uploadFilesEl = document.getElementById("upload-files");
const uploadImageDurationEl = document.getElementById("upload-image-duration");
const overlayToggleEl = document.getElementById("overlay-toggle");
const saveSettingsBtn = document.getElementById("save-settings-btn");

let playlist = [];

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ffb3b3" : "#9ff3c5";
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
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

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!uploadFilesEl.files?.length) {
    showStatus("Choose one or more files first.", true);
    return;
  }

  const formData = new FormData();
  for (const file of uploadFilesEl.files) {
    formData.append("files", file);
  }
  formData.append("imageDuration", String(Math.max(1000, Number(uploadImageDurationEl.value) || 10000)));

  try {
    await requestJson("/api/media/upload", {
      method: "POST",
      body: formData
    });
    uploadForm.reset();
    uploadImageDurationEl.value = "10000";
    await loadPlaylist();
    showStatus("Upload complete and playlist updated.");
  } catch (error) {
    showStatus(error.message || "Upload failed", true);
  }
});

async function initAdmin() {
  try {
    await Promise.all([loadPlaylist(), loadSettings()]);
    showStatus("Admin loaded.");
  } catch (error) {
    showStatus(error.message || "Failed to load admin", true);
  }
}

initAdmin();
