// Publicación del catálogo en GitHub (sin base de datos aparte).
const { guard, readJson, writeJson, readBody, send } = require("./_lib");

const MAX_BYTES = 3_000_000;
const MAX_PRODUCTS = 800;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  if (!guard(req, res)) return;

  let body;
  try {
    body = await readBody(req, 4_500_000);
  } catch (e) {
    return send(res, e.message === "too_large" ? 413 : 400, { error: "bad_body" });
  }

  const catalog = body && body.catalog;
  if (!catalog || !Array.isArray(catalog.products)) return send(res, 422, { error: "invalid_catalog" });
  if (catalog.products.length > MAX_PRODUCTS) return send(res, 422, { error: "too_many_products" });
  const text = JSON.stringify({
    settings: catalog.settings || {},
    products: catalog.products
  });
  if (text.length > MAX_BYTES) return send(res, 413, { error: "too_large" });
  if (text.includes("data:image")) return send(res, 422, { error: "images_not_uploaded" });

  const baseVersion = Number(body.baseVersion) || 0;
  try {
    const current = await readJson("data/catalog.json");
    const currentState = (current && current.value) || {};
    const version = Number(currentState.version) || 0;
    if (baseVersion !== version) return send(res, 409, { error: "conflict", version });

    const next = {
      version: version + 1,
      updatedAt: new Date().toISOString(),
      settings: catalog.settings || {},
      products: catalog.products
    };
    await writeJson("data/catalog.json", next, "Actualizar catálogo de la tienda");
    return send(res, 200, { version: next.version, updatedAt: next.updatedAt });
  } catch (e) {
    return send(res, 502, { error: "storage" });
  }
};
