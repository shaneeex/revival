const {
  DEFAULT_TTL_SECONDS,
  createSessionToken,
  setCors,
  setSessionCookie,
  timingSafeEqualText
} = require("./_lib/session");

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "Revival@123";

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const adminUser = String(process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD).trim();
  const sessionTtl = Math.max(300, Number(process.env.ADMIN_SESSION_TTL_SECONDS) || DEFAULT_TTL_SECONDS);

  const inputUser = String(req.body?.username || "").trim();
  const inputPassword = String(req.body?.password || "");
  const userOk = timingSafeEqualText(inputUser, adminUser);
  const passOk = timingSafeEqualText(inputPassword, adminPassword);

  if (!userOk || !passOk) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  try {
    const token = createSessionToken(adminUser, sessionTtl);
    setSessionCookie(req, res, token, sessionTtl);
    res.status(200).json({ ok: true, username: adminUser });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Unable to create session" });
  }
};
