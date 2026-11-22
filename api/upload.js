// Subida de fotos de producto (se guardan en el repositorio de GitHub).
const crypto = require("crypto");
const { guard, ghWrite, readBody, send } = require("./_lib");

const MAX_CHARS = 4_000_000;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  if (!guard(req, res)) return;

  let body;
  try {
    body = await readBody(req, 4_500_000);
  } catch (e) {
    return send(res, e.message === "too_large" ? 413 : 400, { error: "bad_body" });
  }

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
  if (!match) return send(res, 422, { error: "invalid_image" });
  const base64 = match[2];
  if (base64.length > MAX_CHARS) return send(res, 413, { error: "too_large" });

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const name = `img/uploads/${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  try {
    await ghWrite(name, Buffer.from(base64, "base64"), "Subir foto de producto");
    return send(res, 200, { url: `/api/media?p=${encodeURIComponent(name)}` });
  } catch (e) {
    return send(res, 502, { error: "storage" });
  }
};
