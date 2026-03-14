const crypto = require("crypto");

const SESSION_COOKIE_NAME = "revival_admin_session";
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const pairs = header.split(";").map((part) => part.trim()).filter(Boolean);
  const map = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    map[key] = decodeURIComponent(value);
  }
  return map;
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = normalized + (padding ? "=".repeat(4 - padding) : "");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getSessionSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || "").trim();
}

function makeSignature(payloadPart, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadPart)
    .digest("hex");
}

function timingSafeEqualText(a, b) {
  const ab = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function createSessionToken(username, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is required");
  }

  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);
  const payload = {
    usr: String(username || "admin"),
    exp
  };

  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const sig = makeSignature(payloadPart, secret);
  return `v1.${payloadPart}.${sig}`;
}

function verifySessionToken(token) {
  const secret = getSessionSecret();
  if (!secret) {
    return null;
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return null;
  }

  const payloadPart = parts[1];
  const receivedSig = parts[2];
  const expectedSig = makeSignature(payloadPart, secret);
  if (!timingSafeEqualText(receivedSig, expectedSig)) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart));
  } catch {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload || Number(payload.exp) <= nowSec) {
    return null;
  }
  return payload;
}

function isSecureCookieRequest(req) {
  const proto = String(req.headers?.["x-forwarded-proto"] || "").toLowerCase();
  if (proto === "https") {
    return true;
  }
  if (String(process.env.VERCEL || "") === "1") {
    return true;
  }
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function setSessionCookie(req, res, token, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS)}`
  ];
  if (isSecureCookieRequest(req)) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req, res) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isSecureCookieRequest(req)) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  return verifySessionToken(token);
}

function isAuthenticated(req) {
  return Boolean(getSession(req));
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  createSessionToken,
  clearSessionCookie,
  getSession,
  isAuthenticated,
  setCors,
  setSessionCookie,
  timingSafeEqualText
};
