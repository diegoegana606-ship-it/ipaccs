// Catálogo público publicado. La tienda consulta este endpoint para actualizarse.
const { cfg, readJson, send } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "GET") return send(res, 405, { error: "method" });
  if (!cfg().token || !cfg().repo) return send(res, 503, { error: "not_configured" });
  try {
    const doc = await readJson("data/catalog.json");
    const state = (doc && doc.value) || {};
    const version = Number(state.version) || 0;
    const since = String((req.query && req.query.v) || "");
    if (since && since === String(version)) return send(res, 200, { unchanged: true, version });
    return send(res, 200, {
      version,
      updatedAt: state.updatedAt || "",
      settings: state.settings && typeof state.settings === "object" ? state.settings : {},
      products: Array.isArray(state.products) ? state.products : []
    });
  } catch (e) {
    return send(res, 502, { error: "storage" });
  }
};
