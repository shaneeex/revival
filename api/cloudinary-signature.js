const crypto = require("crypto");
const { isAuthenticated, setCors } = require("./_lib/session");

function createCloudinarySignature(params, apiSecret) {
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

  if (!isAuthenticated(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  const uploadPreset = String(process.env.CLOUDINARY_UPLOAD_PRESET || "").trim();
  const defaultFolder = String(process.env.CLOUDINARY_UPLOAD_FOLDER || "revival").trim().replace(/^\/+|\/+$/g, "");
  const defaultTag = String(process.env.CLOUDINARY_UPLOAD_TAG || "signage").trim();

  const requestedType = String(req.body?.resourceType || "").toLowerCase();
  const resourceType = requestedType === "video" ? "video" : "image";

  if (!cloudName) {
    res.status(500).json({ ok: false, error: "Cloudinary is not configured (missing CLOUDINARY_CLOUD_NAME)" });
    return;
  }

  if (!apiKey || !apiSecret) {
    if (uploadPreset) {
      res.status(200).json({
        ok: true,
        mode: "unsigned",
        cloudName,
        uploadPreset,
        folder: defaultFolder,
        tags: defaultTag,
        resourceType
      });
      return;
    }

    res.status(500).json({
      ok: false,
      error: "Cloudinary signed env vars missing. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or set CLOUDINARY_UPLOAD_PRESET for unsigned fallback."
    });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    folder: defaultFolder || undefined,
    tags: defaultTag || undefined,
    timestamp
  };
  const signature = createCloudinarySignature(paramsToSign, apiSecret);

  res.status(200).json({
    ok: true,
    mode: "signed",
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder: defaultFolder,
    tags: defaultTag,
    resourceType
  });
};
