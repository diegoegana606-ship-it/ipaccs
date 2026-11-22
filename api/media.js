// Entrega las fotos guardadas en GitHub con caché permanente (nombres únicos).
const { cfg, ghGetRaw, send } = require("./_lib");

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method" });
  if (!cfg().token || !cfg().repo) return send(res, 503, { error: "not_configured" });

  const path = String((req.query && req.query.p) || "");
  const match = /^img\/uploads\/[a-z0-9._-]+\.(jpe?g|png|webp)$/i.exec(path);
  if (!match) return send(res, 404, { error: "not_found" });

  try {
    const buffer = await ghGetRaw(path);
    if (!buffer) return send(res, 404, { error: "not_found" });
    res.statusCode = 200;
    res.setHeader("Content-Type", TYPES[match[1].toLowerCase()] || "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(buffer);
  } catch (e) {
    return send(res, 502, { error: "storage" });
  }
};
