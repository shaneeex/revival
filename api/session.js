const { getSession, setCors } = require("./_lib/session");

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const session = getSession(req);
  if (!session) {
    res.status(200).json({ authenticated: false });
    return;
  }

  res.status(200).json({
    authenticated: true,
    username: session.usr || "admin"
  });
};
