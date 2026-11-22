// Acceso al panel: contraseña + clave especial verificadas en el servidor.
const { cfg, missingAuth, same, makeToken, delay, readBody, send } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const missing = missingAuth();
  if (missing.length) return send(res, 503, { error: "not_configured", missing });

  let body;
  try {
    body = await readBody(req, 64_000);
  } catch (e) {
    return send(res, 400, { error: "bad_body" });
  }

  const password = String(body.password || "").trim();
  const key = String(body.key || "").trim();
  const c = cfg();
  if (!password || !key || !same(password, c.pass) || !same(key, c.key)) {
    await delay(600);
    return send(res, 401, { error: "invalid" });
  }
  return send(res, 200, { token: makeToken(), hours: 12 });
};
