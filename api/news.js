function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadWpNews() {
  const endpoints = [
    "https://revivalsports.mv/wp-json/wp/v2/posts?per_page=10&_embed",
    "https://revivalsports.mv/wp-json/wp/v2/posts?per_page=10&_fields=title,content,excerpt"
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithTimeout(endpoint);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const posts = await response.json();
      const items = (Array.isArray(posts) ? posts : [])
        .map((post) => {
          const title = stripHtml(post?.title?.rendered || "");
          const details = stripHtml(post?.content?.rendered || post?.excerpt?.rendered || "");
          const featured = post?._embedded?.["wp:featuredmedia"]?.[0];
          const imageUrl = String(featured?.source_url || "").trim();
          return { title, details, imageUrl };
        })
        .filter((item) => item.title)
        .slice(0, 10);

      if (items.length) {
        return items;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to load WordPress news");
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

  try {
    const items = await loadWpNews();
    res.status(200).json({ ok: true, items, source: "revivalsports.mv/wp-json" });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error?.message || "News fetch failed",
      items: []
    });
  }
};
