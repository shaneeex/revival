const { clearSessionCookie, setCors } = require("./_lib/session");

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

  clearSessionCookie(req, res);
  res.status(200).json({ ok: true });
};
