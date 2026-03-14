const crypto = require("crypto");

const KV_URL_CANDIDATES = [
  "KV_REST_API_URL",
  "UPSTASH_REDIS_REST_URL"
];
const KV_READ_TOKEN_CANDIDATES = [
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN"
];
const KV_WRITE_TOKEN_CANDIDATES = [
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_TOKEN"
];

function readEnv(candidates) {
  for (const name of candidates) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function getKvConfig() {
  const baseUrl = readEnv(KV_URL_CANDIDATES);
  const readToken = readEnv(KV_READ_TOKEN_CANDIDATES);
  const writeToken = readEnv(KV_WRITE_TOKEN_CANDIDATES);
  if (!baseUrl || !readToken) {
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    readToken,
    writeToken: writeToken || ""
  };
}

async function kvGetJson(key) {
  const kv = getKvConfig();
  if (!kv) {
    return null;
  }

  const response = await fetch(`${kv.baseUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kv.readToken}` }
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
  if (!kv || !kv.writeToken) {
    return false;
  }

  const response = await fetch(`${kv.baseUrl}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kv.writeToken}`,
      "Content-Type": "text/plain; charset=utf-8"
    },
    body: JSON.stringify(value)
  });

  if (!response.ok) {
    throw new Error(`KV SET failed (${response.status})`);
  }
  return true;
}

function getCloudinaryStateConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  const statePrefix = String(process.env.CLOUDINARY_STATE_PREFIX || "revival/signage-state")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (!cloudName || !apiKey || !apiSecret || !statePrefix) {
    return null;
  }

  return { cloudName, apiKey, apiSecret, statePrefix };
}

function encodeCloudinaryPublicId(publicId) {
  return String(publicId || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function toStatePublicId(statePrefix, key) {
  const normalizedKey = String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/^\/+|\/+$/g, "");
  return `${statePrefix}/${normalizedKey}`.replace(/\/{2,}/g, "/");
}

function signCloudinaryParams(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${toSign}${apiSecret}`)
    .digest("hex");
}

async function cloudinaryGetJson(key) {
  const config = getCloudinaryStateConfig();
  if (!config) {
    return null;
  }

  const publicId = toStatePublicId(config.statePrefix, key);
  const resourcePath = encodeCloudinaryPublicId(publicId);
  const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");

  const resourceUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/resources/raw/upload/${resourcePath}`;
  const resourceResp = await fetch(resourceUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Cache-Control": "no-store"
    }
  });
  if (resourceResp.status === 404) {
    return null;
  }
  if (!resourceResp.ok) {
    throw new Error(`Cloudinary state GET failed (${resourceResp.status})`);
  }

  const resourcePayload = await resourceResp.json();
  const secureUrl = String(resourcePayload?.secure_url || "").trim();
  if (!secureUrl) {
    return null;
  }

  const dataResp = await fetch(`${secureUrl}${secureUrl.includes("?") ? "&" : "?"}_=${Date.now()}`, {
    cache: "no-store"
  });
  if (!dataResp.ok) {
    throw new Error(`Cloudinary state download failed (${dataResp.status})`);
  }

  const text = await dataResp.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function cloudinarySetJson(key, value) {
  const config = getCloudinaryStateConfig();
  if (!config) {
    return false;
  }

  const publicId = toStatePublicId(config.statePrefix, key);
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    invalidate: "true",
    overwrite: "true",
    public_id: publicId,
    timestamp
  };
  const signature = signCloudinaryParams(paramsToSign, config.apiSecret);

  const body = new FormData();
  body.append("file", `data:application/json;base64,${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`);
  body.append("api_key", config.apiKey);
  body.append("timestamp", String(timestamp));
  body.append("signature", signature);
  body.append("public_id", publicId);
  body.append("overwrite", "true");
  body.append("invalidate", "true");

  const uploadUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/raw/upload`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    body
  });
  if (!response.ok) {
    throw new Error(`Cloudinary state SET failed (${response.status})`);
  }
  return true;
}

async function readJsonState({ kvKey, cloudinaryKey, memoryValue }) {
  try {
    const kvValue = await kvGetJson(kvKey);
    if (kvValue !== null && kvValue !== undefined) {
      return {
        value: kvValue,
        persistent: true,
        writable: true,
        storage: "kv"
      };
    }
  } catch {
    // Fall through to next storage backend.
  }

  try {
    const cloudinaryValue = await cloudinaryGetJson(cloudinaryKey);
    if (cloudinaryValue !== null && cloudinaryValue !== undefined) {
      return {
        value: cloudinaryValue,
        persistent: true,
        writable: true,
        storage: "cloudinary-state"
      };
    }
  } catch {
    // Fall through to in-memory.
  }

  return {
    value: memoryValue,
    persistent: false,
    writable: true,
    storage: "memory"
  };
}

async function writeJsonState({ kvKey, cloudinaryKey, value }) {
  try {
    const persisted = await kvSetJson(kvKey, value);
    if (persisted) {
      return {
        persistent: true,
        writable: true,
        storage: "kv"
      };
    }
  } catch {
    // Fall through to next storage backend.
  }

  try {
    const persisted = await cloudinarySetJson(cloudinaryKey, value);
    if (persisted) {
      return {
        persistent: true,
        writable: true,
        storage: "cloudinary-state"
      };
    }
  } catch {
    // Fall through to in-memory.
  }

  return {
    persistent: false,
    writable: true,
    storage: "memory"
  };
}

module.exports = {
  readJsonState,
  writeJsonState
};
