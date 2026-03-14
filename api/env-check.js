const { setCors } = require("./_lib/session");

function hasValue(name) {
  return Boolean(String(process.env[name] || "").trim());
}

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

  const flags = {
    cloudinary: {
      CLOUDINARY_CLOUD_NAME: hasValue("CLOUDINARY_CLOUD_NAME"),
      CLOUDINARY_API_KEY: hasValue("CLOUDINARY_API_KEY"),
      CLOUDINARY_API_SECRET: hasValue("CLOUDINARY_API_SECRET"),
      CLOUDINARY_UPLOAD_TAG: hasValue("CLOUDINARY_UPLOAD_TAG"),
      CLOUDINARY_UPLOAD_FOLDER: hasValue("CLOUDINARY_UPLOAD_FOLDER"),
      CLOUDINARY_STATE_PREFIX: hasValue("CLOUDINARY_STATE_PREFIX")
    },
    kv: {
      KV_REST_API_URL: hasValue("KV_REST_API_URL"),
      KV_REST_API_TOKEN: hasValue("KV_REST_API_TOKEN"),
      UPSTASH_REDIS_REST_URL: hasValue("UPSTASH_REDIS_REST_URL"),
      UPSTASH_REDIS_REST_TOKEN: hasValue("UPSTASH_REDIS_REST_TOKEN")
    },
    adminAuth: {
      ADMIN_USERNAME: hasValue("ADMIN_USERNAME"),
      ADMIN_PASSWORD: hasValue("ADMIN_PASSWORD"),
      ADMIN_SESSION_SECRET: hasValue("ADMIN_SESSION_SECRET")
    }
  };

  const cloudinaryStateReady = flags.cloudinary.CLOUDINARY_CLOUD_NAME
    && flags.cloudinary.CLOUDINARY_API_KEY
    && flags.cloudinary.CLOUDINARY_API_SECRET;
  const kvReady = (flags.kv.KV_REST_API_URL && flags.kv.KV_REST_API_TOKEN)
    || (flags.kv.UPSTASH_REDIS_REST_URL && flags.kv.UPSTASH_REDIS_REST_TOKEN);

  res.status(200).json({
    ok: true,
    environment: String(process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown"),
    persistenceConfigured: kvReady || cloudinaryStateReady,
    persistenceMode: kvReady ? "kv" : (cloudinaryStateReady ? "cloudinary-state" : "memory"),
    flags
  });
};
