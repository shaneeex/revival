const PLAYLIST_URL = "media/playlist.json";
const PLAYLIST_API_URL = "/api/playlist";
const SETTINGS_API_URL = "/api/settings";
const RUNTIME_CONFIG_URL = "runtime-config.json";
const API_BASE_STORAGE_KEY = "signageApiBaseUrl";
const DEFAULT_IMAGE_MS = 10000;
const DEFAULT_VIDEO_MAX_MS = 90000;
const MEDIA_SLIDES_PER_NEWS = 3;
const NEWS_SLIDE_MS = 30000;
const NEWS_REFRESH_MS = 5 * 60 * 1000;
const PLAYLIST_REFRESH_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const NEWS_TITLE_MIN_FONT_PX = 16;
const NEWS_TITLE_FONT_STEP_PX = 0.5;
const TICKER_SEP = " \u2022 ";
const SETTINGS_REFRESH_MS = 5 * 1000;
const ALERT_INTERVAL_MS = 60 * 60 * 1000;
const ALERT_DURATION_MS = 60 * 1000;
const ALERT_BEEP_INTERVAL_MS = 850;
const ALERT_BEEP_MS = 260;
const ALERT_BEEP_FREQ = 940;
const ALERT_BEEP_GAIN = 0.23;
const IMAGE_MOTION_CLASSES = [
  "motion-pan-left",
  "motion-pan-right",
  "motion-pan-up",
  "motion-pan-down"
];
const NEWS_IMAGE_MOTION_CLASSES = [
  "news-motion-pan-left",
  "news-motion-pan-right"
];
const CLOUDINARY_DEFAULT_TAG = "signage";
const CLOUDINARY_DEFAULT_MAX_ITEMS = 80;

const mediaContainer = document.getElementById("media-container");
const mediaFrameEl = document.querySelector(".media-frame");
const clockEl = document.getElementById("screen-clock");
const marqueeTrackEl = document.getElementById("marquee-track");
const timeupOverlayEl = document.getElementById("timeup-overlay");
const timeupCountdownEl = document.getElementById("timeup-countdown");
const timeupProgressEl = document.getElementById("timeup-progress-bar");
const IS_ANDROID = /Android/i.test(navigator.userAgent || "");

let mediaFiles = [];
let mediaIndex = 0;
let mediaSlidesSinceNews = 0;
let mediaTimeoutId = null;
let imageMotionIndex = 0;
let newsImageMotionIndex = 0;
let mediaRefreshInFlight = false;

let newsItems = [];
let newsIndex = 0;

let alertHideTimeoutId = null;
let alertIntervalId = null;
let alertAlignedTimeoutId = null;
let alertBeepIntervalId = null;
let alertAudioCtx = null;
let alertCountdownIntervalId = null;
let alertEndAtMs = 0;
let alertBeepTick = 0;
let overlayEnabled = true;
let overlayListenersBound = false;
let apiBaseUrl = "";
let cloudinaryConfig = {
  enabled: false,
  cloudName: "",
  uploadPreset: "",
  tag: CLOUDINARY_DEFAULT_TAG,
  folder: "",
  defaultImageDurationMs: DEFAULT_IMAGE_MS,
  maxItems: CLOUDINARY_DEFAULT_MAX_ITEMS
};

if (IS_ANDROID) {
  document.documentElement.classList.add("perf-mode");
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
  const defaultImageDurationMs = Math.max(1000, Number(raw.defaultImageDurationMs) || DEFAULT_IMAGE_MS);
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
  } catch (error) {
    // Optional config; keep empty apiBaseUrl.
  }
}

function updateClock() {
  if (!clockEl) {
    return;
  }

  const now = new Date();
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);

  // Keep one clear space before AM/PM and normalize any locale spaces.
  clockEl.textContent = formatted
    .replace(/\u202F/g, " ")
    .replace(/\s*(AM|PM)$/i, " $1")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  fitClockText();
}

function fitClockText() {
  if (!clockEl) {
    return;
  }

  // Reset to stylesheet size first; only reduce if capped width overflows.
  clockEl.style.fontSize = "";

  const styles = window.getComputedStyle(clockEl);
  const padLeft = parseFloat(styles.paddingLeft) || 0;
  const padRight = parseFloat(styles.paddingRight) || 0;
  const availableWidth = Math.max(0, clockEl.clientWidth - padLeft - padRight);
  if (!availableWidth) {
    return;
  }

  const baseFontPx = parseFloat(window.getComputedStyle(clockEl).fontSize) || 26;
  const minFontPx = 20;
  const measuredWidth = clockEl.scrollWidth;
  if (!measuredWidth || measuredWidth <= availableWidth) {
    return;
  }

  const widthScale = availableWidth / measuredWidth;
  const fittedPx = Math.max(minFontPx, Math.floor(baseFontPx * widthScale));
  clockEl.style.fontSize = `${fittedPx}px`;
}

function ensureAlertAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!alertAudioCtx) {
    alertAudioCtx = new AudioContextCtor();
  }

  if (alertAudioCtx.state === "suspended") {
    alertAudioCtx.resume().catch(() => {});
  }

  return alertAudioCtx;
}

function playTone(ctx, startAt, frequency, durationMs, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationMs / 1000 + 0.04);
}

function playAlertBeep() {
  const ctx = ensureAlertAudioContext();
  if (!ctx || ctx.state !== "running") {
    return;
  }

  alertBeepTick += 1;
  const now = ctx.currentTime + 0.005;
  const primary = alertBeepTick % 2 === 0 ? ALERT_BEEP_FREQ : ALERT_BEEP_FREQ + 120;
  const secondary = primary + 170;

  playTone(ctx, now, primary, ALERT_BEEP_MS, ALERT_BEEP_GAIN);
  playTone(ctx, now + 0.17, secondary, ALERT_BEEP_MS * 0.72, ALERT_BEEP_GAIN * 0.92);
}

function startAlertBeeping() {
  stopAlertBeeping();
  playAlertBeep();
  alertBeepIntervalId = setInterval(playAlertBeep, ALERT_BEEP_INTERVAL_MS);
}

function stopAlertBeeping() {
  if (alertBeepIntervalId) {
    clearInterval(alertBeepIntervalId);
    alertBeepIntervalId = null;
  }
}

function formatAlertCountdown(msRemaining) {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function updateAlertVisuals() {
  const remainingMs = Math.max(0, alertEndAtMs - Date.now());
  const ratio = ALERT_DURATION_MS > 0 ? remainingMs / ALERT_DURATION_MS : 0;

  if (timeupCountdownEl) {
    timeupCountdownEl.textContent = formatAlertCountdown(remainingMs);
  }

  if (timeupProgressEl) {
    timeupProgressEl.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  }
}

function startAlertVisuals() {
  if (alertCountdownIntervalId) {
    clearInterval(alertCountdownIntervalId);
  }

  alertEndAtMs = Date.now() + ALERT_DURATION_MS;
  updateAlertVisuals();
  alertCountdownIntervalId = setInterval(updateAlertVisuals, 100);
}

function stopAlertVisuals() {
  if (alertCountdownIntervalId) {
    clearInterval(alertCountdownIntervalId);
    alertCountdownIntervalId = null;
  }

  if (timeupProgressEl) {
    timeupProgressEl.style.transform = "scaleX(0)";
  }
}

function hideTimeupOverlay() {
  if (!timeupOverlayEl) {
    return;
  }

  timeupOverlayEl.classList.remove("active");
  timeupOverlayEl.setAttribute("aria-hidden", "true");
  stopAlertBeeping();
  stopAlertVisuals();

  if (alertHideTimeoutId) {
    clearTimeout(alertHideTimeoutId);
    alertHideTimeoutId = null;
  }
}

function showTimeupOverlay() {
  if (!timeupOverlayEl || !overlayEnabled) {
    return;
  }

  timeupOverlayEl.classList.remove("active");
  void timeupOverlayEl.offsetWidth;
  timeupOverlayEl.classList.add("active");
  timeupOverlayEl.setAttribute("aria-hidden", "false");
  startAlertBeeping();
  startAlertVisuals();

  if (alertHideTimeoutId) {
    clearTimeout(alertHideTimeoutId);
  }

  alertHideTimeoutId = setTimeout(hideTimeupOverlay, ALERT_DURATION_MS);
}

function clearAlertSchedule() {
  if (alertIntervalId) {
    clearInterval(alertIntervalId);
    alertIntervalId = null;
  }

  if (alertAlignedTimeoutId) {
    clearTimeout(alertAlignedTimeoutId);
    alertAlignedTimeoutId = null;
  }
}

function getMsUntilNextAlignedAlert() {
  if (ALERT_INTERVAL_MS <= 0) {
    return 0;
  }

  const intervalMinutes = ALERT_INTERVAL_MS / 60000;
  if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
    const nowMs = Date.now();
    const remainder = nowMs % ALERT_INTERVAL_MS;
    return remainder === 0 ? ALERT_INTERVAL_MS : ALERT_INTERVAL_MS - remainder;
  }

  const now = new Date();
  const elapsedThisMinuteMs = (now.getSeconds() * 1000) + now.getMilliseconds();
  const minuteRemainder = now.getMinutes() % intervalMinutes;
  const minutesUntilNextBoundary =
    minuteRemainder === 0 ? intervalMinutes : intervalMinutes - minuteRemainder;

  return (minutesUntilNextBoundary * 60000) - elapsedThisMinuteMs;
}

function scheduleAlignedOverlay() {
  if (!overlayEnabled) {
    clearAlertSchedule();
    return;
  }

  clearAlertSchedule();

  const delay = getMsUntilNextAlignedAlert();
  alertAlignedTimeoutId = setTimeout(() => {
    void maybeShowTimeupOverlay();

    alertIntervalId = setInterval(() => {
      void maybeShowTimeupOverlay();
    }, ALERT_INTERVAL_MS);
  }, delay);
}

function parseOverlayEnabledValue(value) {
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
  return true;
}

function applyOverlayEnabled(value) {
  const next = value !== false;
  if (overlayEnabled === next) {
    return;
  }

  overlayEnabled = next;
  if (!overlayEnabled) {
    clearAlertSchedule();
    hideTimeupOverlay();
    return;
  }

  scheduleAlignedOverlay();
}

async function refreshRuntimeSettings() {
  try {
    const response = await fetchWithTimeout(buildApiUrl(SETTINGS_API_URL), { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return;
    }

    const payload = await response.json();
    if (payload && Object.prototype.hasOwnProperty.call(payload, "overlayEnabled")) {
      applyOverlayEnabled(parseOverlayEnabledValue(payload.overlayEnabled));
    }
  } catch (error) {
    // Backend can be temporarily unavailable during restarts; keep existing setting.
  }
}

async function maybeShowTimeupOverlay() {
  await refreshRuntimeSettings();
  showTimeupOverlay();
}

function setupTimeupOverlay() {
  if (!overlayListenersBound) {
    const unlockAudio = () => {
      ensureAlertAudioContext();
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && overlayEnabled) {
        scheduleAlignedOverlay();
      }
    });
    overlayListenersBound = true;
  }

  if (overlayEnabled) {
    scheduleAlignedOverlay();
  } else {
    clearAlertSchedule();
    hideTimeupOverlay();
  }
}

function buildMarqueeMessage() {
  const titles = newsItems
    .map((item) => (item?.title || "").trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!titles.length) {
    return `REVIVAL SPORTS${TICKER_SEP}Latest updates coming soon${TICKER_SEP}Stay tuned`;
  }

  return `REVIVAL SPORTS${TICKER_SEP}${titles.join(TICKER_SEP)}`;
}

function updateMarqueeContent(message) {
  if (!marqueeTrackEl) {
    return;
  }

  const text = (message || "").trim() || `REVIVAL SPORTS${TICKER_SEP}Latest updates coming soon`;
  marqueeTrackEl.innerHTML = "";

  const first = document.createElement("span");
  first.className = "marquee-text";
  first.textContent = text;

  const spacer = document.createElement("span");
  spacer.className = "marquee-text";
  spacer.textContent = " \u2022 \u2022 \u2022 ";

  const second = document.createElement("span");
  second.className = "marquee-text";
  second.textContent = text;

  marqueeTrackEl.append(first, spacer, second);

  requestAnimationFrame(() => {
    const travelPx = first.scrollWidth + spacer.scrollWidth;
    const pxPerSecond = 90;
    const durationSec = Math.max(14, travelPx / pxPerSecond);
    marqueeTrackEl.style.setProperty("--marquee-distance", `${travelPx}px`);
    marqueeTrackEl.style.setProperty("--marquee-duration", `${durationSec}s`);
  });
}

function triggerSlideTransition() {
  if (!mediaFrameEl) {
    return;
  }

  mediaFrameEl.classList.remove("is-switching");
  void mediaFrameEl.offsetWidth;
  mediaFrameEl.classList.add("is-switching");
}

function getNextImageMotionClass() {
  const klass = IMAGE_MOTION_CLASSES[imageMotionIndex % IMAGE_MOTION_CLASSES.length];
  imageMotionIndex += 1;
  return klass;
}

function getNextNewsImageMotionClass() {
  const klass = NEWS_IMAGE_MOTION_CLASSES[newsImageMotionIndex % NEWS_IMAGE_MOTION_CLASSES.length];
  newsImageMotionIndex += 1;
  return klass;
}

function decodeHtml(value) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  return (doc.documentElement.textContent || "").trim();
}

function normalizeInlineText(value) {
  return decodeHtml(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToReadableText(value) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value || "", "text/html");
  const body = doc.body || doc.documentElement;

  body.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
  body.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  body.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,blockquote").forEach((node) => {
    if (node.textContent && !node.textContent.endsWith("\n")) {
      node.append("\n");
    }
  });

  return (body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function getMediaType(itemSrc) {
  const source = (itemSrc || "").toLowerCase();
  if (source.endsWith(".mp4") || source.endsWith(".webm") || source.endsWith(".ogg")) {
    return "video";
  }
  return "image";
}

function normalizeMediaItem(item) {
  const srcInput = (item.src || item.file || "").trim();
  if (!srcInput) {
    return null;
  }

  const type = (item.type || getMediaType(srcInput)).toLowerCase();
  const src = srcInput.startsWith("http") || srcInput.startsWith("media/")
    ? srcInput
    : `media/${srcInput}`;

  const normalized = {
    src,
    type,
    duration: Number(item.duration) || (type === "video" ? 0 : DEFAULT_IMAGE_MS)
  };

  if (type === "image") {
    const title = normalizeInlineText(item?.title || "");
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

function titleFromMediaPath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const asUrl = /^https?:\/\//i.test(raw) ? new URL(raw) : null;
    const path = asUrl ? asUrl.pathname : raw;
    const part = decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
    const withoutExt = part.replace(/\.[a-z0-9]+$/i, "");
    return withoutExt
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return raw.replace(/[_-]+/g, " ").trim();
  }
}

function getImageSlideTitle(item) {
  const explicit = normalizeInlineText(item?.title || "");
  if (explicit) {
    return explicit;
  }

  const fromPublicId = titleFromMediaPath(item?.publicId || "");
  if (fromPublicId) {
    return fromPublicId.toUpperCase();
  }

  const fromSource = titleFromMediaPath(item?.src || "");
  if (fromSource) {
    return fromSource.toUpperCase();
  }

  return "";
}

async function fetchCloudinaryResourceList(resourceType) {
  const { cloudName, tag, maxItems } = cloudinaryConfig;
  const bust = Date.now();
  const url = `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resourceType}/list/${encodeURIComponent(tag)}.json?max_results=${maxItems}&_=${bust}`;
  const response = await fetchWithTimeout(url, { cache: "no-store" });

  if (response.status === 401) {
    throw new Error("Cloudinary list blocked (HTTP 401). Enable Resource list in Cloudinary settings.");
  }
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Cloudinary ${resourceType} list HTTP ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.resources) ? payload.resources : [];
}

function mapCloudinaryResource(resource, resourceType) {
  const format = String(resource?.format || "").toLowerCase();
  const version = resource?.version ? `v${resource.version}/` : "";
  const publicId = String(resource?.public_id || "").trim();
  if (!publicId) {
    return null;
  }

  const source = resource?.secure_url
    || `https://res.cloudinary.com/${encodeURIComponent(cloudinaryConfig.cloudName)}/${resourceType}/upload/${version}${publicId}.${format}`;

  const isVideo = resourceType === "video";
  const createdAtMs = Date.parse(resource?.created_at || "") || 0;

  return {
    src: source,
    type: isVideo ? "video" : "image",
    duration: isVideo ? 0 : cloudinaryConfig.defaultImageDurationMs,
    createdAtMs
  };
}

async function loadCloudinaryPlaylist() {
  if (!cloudinaryConfig.enabled) {
    return false;
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

  const combined = [...images, ...videos]
    .map((item) => mapCloudinaryResource(item, item?.resource_type === "video" ? "video" : "image"))
    .filter(Boolean)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, cloudinaryConfig.maxItems)
    .map(({ createdAtMs, ...item }) => item);

  mediaFiles = combined;
  return true;
}

async function loadPlaylist() {
  // 1) Prefer managed playlist from backend (admin content list).
  try {
    const response = await fetchWithTimeout(buildApiUrl(PLAYLIST_API_URL), { cache: "no-store" });
    if (response.ok) {
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const rawItems = Array.isArray(payload) ? payload : payload.items;
        const managedItems = (rawItems || []).map(normalizeMediaItem).filter(Boolean);
        mediaFiles = managedItems;
        if (!mediaFiles.length) {
          mediaContainer.innerHTML = '<div class="panel-message">No media in admin content list</div>';
        }
        return;
      }
    }
  } catch (error) {
    console.warn("Managed playlist load failed:", error);
  }

  // 2) Fallback to Cloudinary tag list.
  try {
    const usedCloudinary = await loadCloudinaryPlaylist();
    if (usedCloudinary) {
      if (!mediaFiles.length) {
        mediaContainer.innerHTML = '<div class="panel-message">No Cloudinary media found for configured tag</div>';
      }
      return;
    }
  } catch (error) {
    console.warn("Cloudinary playlist load failed:", error);
  }

  // 3) Final fallback to static local playlist file.
  const sources = [PLAYLIST_URL];
  let lastError = null;

  for (const source of sources) {
    try {
      const response = await fetchWithTimeout(source, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Playlist HTTP ${response.status}`);
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("application/json")) {
        throw new Error(`Playlist response from ${source} is not JSON`);
      }

      const payload = await response.json();
      const rawItems = Array.isArray(payload) ? payload : payload.items;
      mediaFiles = (rawItems || []).map(normalizeMediaItem).filter(Boolean);

      if (!mediaFiles.length) {
        mediaContainer.innerHTML = '<div class="panel-message">No media found in playlist</div>';
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }

  console.error("Playlist load failed:", lastError);
  mediaContainer.innerHTML = '<div class="panel-message">Unable to load media playlist</div>';
}

async function refreshMediaSources() {
  if (mediaRefreshInFlight) {
    return;
  }

  mediaRefreshInFlight = true;
  try {
    await loadPlaylist();
    if (!mediaFiles.length || mediaIndex >= mediaFiles.length) {
      mediaIndex = 0;
    }
  } finally {
    mediaRefreshInFlight = false;
  }
}

function scheduleNextSlide(ms) {
  clearTimeout(mediaTimeoutId);
  mediaTimeoutId = setTimeout(showNextSlide, ms);
}

function shouldShowNewsSlide() {
  return newsItems.length > 0 && mediaSlidesSinceNews >= MEDIA_SLIDES_PER_NEWS;
}

function buildNewsBackground(imageUrl) {
  if (imageUrl) {
    return `url("${imageUrl}")`;
  }

  return "linear-gradient(135deg, #7d1525 0%, #400b13 55%, #24050a 100%)";
}

function fitNewsTitleToBox(titleEl, headlineEl, kickerEl) {
  if (!titleEl || !headlineEl) {
    return;
  }

  titleEl.style.removeProperty("font-size");

  const headlineStyles = getComputedStyle(headlineEl);
  const gapPx = parseFloat(headlineStyles.rowGap || headlineStyles.gap) || 0;
  const kickerHeight = kickerEl ? kickerEl.offsetHeight : 0;
  const availableHeight = Math.max(0, headlineEl.clientHeight - kickerHeight - gapPx);
  if (!availableHeight) {
    return;
  }

  let currentFontPx = parseFloat(getComputedStyle(titleEl).fontSize) || 24;
  while (titleEl.scrollHeight > availableHeight && currentFontPx > NEWS_TITLE_MIN_FONT_PX) {
    currentFontPx -= NEWS_TITLE_FONT_STEP_PX;
    titleEl.style.fontSize = `${currentFontPx}px`;
  }
}

function getNewsTitleLineClamp(titleText) {
  const len = (titleText || "").trim().length;
  if (len > 110) {
    return 4;
  }
  if (len > 65) {
    return 3;
  }
  return 2;
}

function adjustNewsSlideLayout(newsSlideEl, headlineEl) {
  if (!newsSlideEl || !headlineEl) {
    return;
  }

  newsSlideEl.style.removeProperty("grid-template-rows");

  const slideHeight = newsSlideEl.clientHeight;
  if (!slideHeight) {
    return;
  }

  const minImageHeight = Math.round(slideHeight * 0.44);
  const minHeadlineHeight = Math.round(slideHeight * 0.22);
  const maxHeadlineHeight = Math.round(slideHeight * 0.56);
  const desiredHeadlineHeight = Math.round(headlineEl.scrollHeight);
  const headlineHeight = Math.max(
    minHeadlineHeight,
    Math.min(maxHeadlineHeight, desiredHeadlineHeight)
  );

  newsSlideEl.style.gridTemplateRows = `minmax(${minImageHeight}px, 1fr) ${headlineHeight}px`;
}

function fitVisibleNewsTitle() {
  const newsSlideEl = mediaContainer?.querySelector(".news-slide");
  const headlineEl = mediaContainer?.querySelector(".news-slide-headline");
  const titleEl = headlineEl?.querySelector(".news-slide-title");
  const kickerEl = headlineEl?.querySelector(".news-slide-kicker");
  if (newsSlideEl && headlineEl && titleEl) {
    adjustNewsSlideLayout(newsSlideEl, headlineEl);
    fitNewsTitleToBox(titleEl, headlineEl, kickerEl);
    adjustNewsSlideLayout(newsSlideEl, headlineEl);
  }
}

function showNewsSlide() {
  triggerSlideTransition();
  const item = newsItems[newsIndex];
  newsIndex = (newsIndex + 1) % newsItems.length;
  mediaSlidesSinceNews = 0;

  const newsSlide = document.createElement("article");
  newsSlide.className = "news-slide";

  const imageBox = document.createElement("div");
  imageBox.className = "news-slide-image-box";
  if (item.imageUrl) {
    const newsImage = document.createElement("img");
    newsImage.className = `news-slide-image-item ${getNextNewsImageMotionClass()}`;
    newsImage.src = item.imageUrl;
    newsImage.alt = item.title || "News image";
    newsImage.decoding = "async";
    newsImage.loading = "eager";
    newsImage.style.setProperty("--news-img-motion-ms", `${Math.max(18000, NEWS_SLIDE_MS)}ms`);
    newsImage.addEventListener("error", () => {
      newsImage.remove();
      imageBox.style.backgroundImage = buildNewsBackground("");
    }, { once: true });
    imageBox.appendChild(newsImage);
  } else {
    imageBox.style.backgroundImage = buildNewsBackground("");
  }
  newsSlide.appendChild(imageBox);

  const headline = document.createElement("div");
  headline.className = "news-slide-headline";

  const kicker = document.createElement("div");
  kicker.className = "news-slide-kicker";
  kicker.textContent = "NEWS";

  const title = document.createElement("h2");
  title.className = "news-slide-title";
  title.textContent = item.title || "Latest News";
  title.style.setProperty("--news-title-lines", `${getNewsTitleLineClamp(title.textContent)}`);
  headline.appendChild(kicker);
  headline.appendChild(title);
  newsSlide.appendChild(headline);

  mediaContainer.innerHTML = "";
  mediaContainer.appendChild(newsSlide);
  requestAnimationFrame(() => {
    adjustNewsSlideLayout(newsSlide, headline);
    fitNewsTitleToBox(title, headline, kicker);
    adjustNewsSlideLayout(newsSlide, headline);
  });
  scheduleNextSlide(NEWS_SLIDE_MS);
}

function showMediaSlide() {
  if (!mediaFiles.length) {
    if (newsItems.length) {
      showNewsSlide();
    }
    return;
  }

  triggerSlideTransition();

  const item = mediaFiles[mediaIndex];
  mediaIndex = (mediaIndex + 1) % mediaFiles.length;
  mediaSlidesSinceNews += 1;

  mediaContainer.innerHTML = "";

  if (item.type === "video") {
    const video = document.createElement("video");
    video.className = "slide-item video-item";
    video.src = item.src;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.disablePictureInPicture = true;

    const maxDuration = item.duration > 0 ? item.duration : DEFAULT_VIDEO_MAX_MS;

    video.addEventListener("ended", () => scheduleNextSlide(400), { once: true });
    video.addEventListener("error", () => scheduleNextSlide(400), { once: true });

    mediaContainer.appendChild(video);
    scheduleNextSlide(maxDuration);
    return;
  }

  const imageDurationMs = item.duration || DEFAULT_IMAGE_MS;
  const slide = document.createElement("article");
  slide.className = "news-slide image-media-slide";

  const imageBox = document.createElement("div");
  imageBox.className = "news-slide-image-box";

  const img = document.createElement("img");
  img.className = `news-slide-image-item ${getNextNewsImageMotionClass()}`;
  img.src = item.src;
  img.alt = "Signage image";
  img.style.setProperty("--news-img-motion-ms", `${Math.max(12000, imageDurationMs)}ms`);
  img.addEventListener("error", () => scheduleNextSlide(400), { once: true });
  imageBox.appendChild(img);

  const headline = document.createElement("div");
  headline.className = "news-slide-headline";

  const kicker = document.createElement("div");
  kicker.className = "news-slide-kicker";
  kicker.textContent = "GALLERY";

  const heading = document.createElement("h2");
  heading.className = "news-slide-title";
  heading.textContent = getImageSlideTitle(item) || "REVIVAL SPORTS";
  heading.style.setProperty("--news-title-lines", `${getNewsTitleLineClamp(heading.textContent)}`);

  headline.append(kicker, heading);
  slide.append(imageBox, headline);
  mediaContainer.appendChild(slide);

  requestAnimationFrame(() => {
    adjustNewsSlideLayout(slide, headline);
    fitNewsTitleToBox(heading, headline, kicker);
    adjustNewsSlideLayout(slide, headline);
  });

  scheduleNextSlide(imageDurationMs);
}

function showNextSlide() {
  if (!mediaFiles.length && !newsItems.length) {
    mediaContainer.innerHTML = '<div class="panel-message">No media or news available.</div>';
    return;
  }

  if (shouldShowNewsSlide()) {
    showNewsSlide();
    return;
  }

  showMediaSlide();
}

async function fetchNewsFromWpApi() {
  const response = await fetchWithTimeout(
    "https://revivalsports.mv/wp-json/wp/v2/posts?per_page=10&_embed",
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`WP API HTTP ${response.status}`);
  }

  const posts = await response.json();
  return posts
    .map((post) => {
      const title = normalizeInlineText(post?.title?.rendered || "");
      const details = htmlToReadableText(post?.content?.rendered || post?.excerpt?.rendered || "");
      const featured = post?._embedded?.["wp:featuredmedia"]?.[0];
      const imageUrl = featured?.source_url || "";

      return { title, details, imageUrl };
    })
    .filter((item) => item.title);
}

async function fetchNewsFromWpApiSimple() {
  const response = await fetchWithTimeout(
    "https://revivalsports.mv/wp-json/wp/v2/posts?per_page=10&_fields=title,content,excerpt",
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`WP API simple HTTP ${response.status}`);
  }

  const posts = await response.json();
  return posts
    .map((post) => {
      const title = normalizeInlineText(post?.title?.rendered || "");
      const details = htmlToReadableText(post?.content?.rendered || post?.excerpt?.rendered || "");
      return { title, details, imageUrl: "" };
    })
    .filter((item) => item.title);
}

async function fetchNewsFromFeedProxy() {
  const feedUrl = encodeURIComponent("https://revivalsports.mv/feed/");
  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${feedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${feedUrl}`,
    `https://r.jina.ai/http://revivalsports.mv/feed/`
  ];

  let lastError = null;
  for (const proxyUrl of proxyUrls) {
    try {
      const response = await fetchWithTimeout(proxyUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Feed proxy HTTP ${response.status}`);
      }

      const xmlText = await response.text();
      const items = parseRssItems(xmlText);
      if (items.length) {
        return items;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No feed proxy returned usable data");
}

async function fetchNewsFromRss2Json() {
  const feedUrl = encodeURIComponent("https://revivalsports.mv/feed/");
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${feedUrl}&count=10`;
  const response = await fetchWithTimeout(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`rss2json HTTP ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return items
    .map((item) => {
      const title = normalizeInlineText(item?.title || "");
      const details = htmlToReadableText(item?.content || item?.description || "");
      const imageUrl = item?.thumbnail || item?.enclosure?.link || "";
      return { title, details, imageUrl };
    })
    .filter((item) => item.title);
}

function parseRssItems(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const nodes = Array.from(xml.getElementsByTagName("item"));

  return nodes
    .map((itemNode) => {
      const title = normalizeInlineText(itemNode.getElementsByTagName("title")[0]?.textContent || "");
      const details = htmlToReadableText(itemNode.getElementsByTagName("description")[0]?.textContent || "");
      const enclosure = itemNode.getElementsByTagName("enclosure")[0];
      const media = itemNode.getElementsByTagName("media:content")[0];
      const imageUrl = enclosure?.getAttribute("url") || media?.getAttribute("url") || "";
      return { title, details, imageUrl };
    })
    .filter((item) => item.title)
    .slice(0, 10);
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

async function refreshNews() {
  const loaders = [
    fetchNewsFromWpApi,
    fetchNewsFromWpApiSimple,
    fetchNewsFromFeedProxy,
    fetchNewsFromRss2Json
  ];

  for (const loader of loaders) {
    try {
      const items = await loader();
      if (items.length) {
        newsItems = items;
        updateMarqueeContent(buildMarqueeMessage());
        return;
      }
    } catch (error) {
      console.warn("News loader failed:", loader.name, error);
    }
  }

  newsItems = [
    {
      title: "NEWS TEMPORARILY UNAVAILABLE",
      details: "Unable to fetch live articles. Check internet or CORS settings for revivalsports.mv.",
      imageUrl: ""
    }
  ];
  updateMarqueeContent(buildMarqueeMessage());
}

async function init() {
  await loadRuntimeConfig();
  await refreshRuntimeSettings();
  await refreshMediaSources();
  updateMarqueeContent(buildMarqueeMessage());
  refreshNews();
  showNextSlide();
  updateClock();
  window.addEventListener("resize", fitClockText);
  window.addEventListener("resize", fitVisibleNewsTitle);
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      fitClockText();
      fitVisibleNewsTitle();
    });
  }
  setupTimeupOverlay();
  setInterval(updateClock, 1000);
  setInterval(refreshRuntimeSettings, SETTINGS_REFRESH_MS);
  setInterval(() => {
    refreshMediaSources().catch((error) => {
      console.warn("Media refresh failed:", error);
    });
  }, PLAYLIST_REFRESH_MS);
  setInterval(refreshNews, NEWS_REFRESH_MS);
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
