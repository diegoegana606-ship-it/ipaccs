// Utilidades compartidas: sesión firmada y almacenamiento en GitHub.
const crypto = require("crypto");

const env = (k) => (process.env[k] || "").trim();
const cfg = () => ({
  pass: env("ADMIN_PASSWORD"),
  key: env("ADMIN_KEY"),
  token: env("GITHUB_TOKEN"),
  repo: env("GITHUB_REPO"),
  branch: env("GITHUB_BRANCH") || "main",
  secret: env("SESSION_SECRET")
});

function missingAuth() {
  return ["ADMIN_PASSWORD", "ADMIN_KEY"].filter((k) => !env(k));
}
function missingStorage() {
  return ["GITHUB_TOKEN", "GITHUB_REPO"].filter((k) => !env(k));
}
function secret() {
  const c = cfg();
  return c.secret || crypto.createHash("sha256").update([c.pass, c.key, c.token].join("|")).digest("hex");
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}
function makeToken(hours = 12) {
  return sign({ exp: Date.now() + hours * 60 * 60 * 1000 });
}
function verify(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return false;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return Number(data.exp) > Date.now();
  } catch (e) {
    return false;
  }
}
function same(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const GH = "https://api.github.com";
const ghPath = (path) => path.split("/").map(encodeURIComponent).join("/");
const ghHeaders = (extra) => ({
  Authorization: "Bearer " + env("GITHUB_TOKEN"),
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "iphones-accesorios",
  ...extra
});
const contentsUrl = (path) =>
  `${GH}/repos/${env("GITHUB_REPO")}/contents/${ghPath(path)}?ref=${encodeURIComponent(cfg().branch)}`;

async function ghGet(path) {
  const res = await fetch(contentsUrl(path), { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("github_" + res.status);
  const meta = await res.json();
  let content = meta.content ? Buffer.from(meta.content, "base64") : null;
  if (!content && meta.size) {
    const raw = await fetch(contentsUrl(path), { headers: ghHeaders({ Accept: "application/vnd.github.raw" }) });
    if (!raw.ok) throw new Error("github_" + raw.status);
    content = Buffer.from(await raw.arrayBuffer());
  }
  return { sha: meta.sha, content: content || Buffer.alloc(0) };
}
async function ghGetRaw(path) {
  const res = await fetch(contentsUrl(path), { headers: ghHeaders({ Accept: "application/vnd.github.raw" }) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("github_" + res.status);
  return Buffer.from(await res.arrayBuffer());
}
async function ghPut(path, buffer, message, sha) {
  const res = await fetch(`${GH}/repos/${env("GITHUB_REPO")}/contents/${ghPath(path)}`, {
    method: "PUT",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message,
      content: Buffer.from(buffer).toString("base64"),
      branch: cfg().branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!res.ok) {
    const err = new Error("github_" + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
async function ghWrite(path, buffer, message) {
  for (let i = 0; i < 3; i += 1) {
    const current = await ghGet(path);
    try {
      return await ghPut(path, buffer, message, current && current.sha);
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      await delay(120 + i * 180);
    }
  }
  throw new Error("github_conflict");
}
async function readJson(path) {
  const file = await ghGet(path);
  if (!file) return null;
  const text = file.content.toString("utf8");
  if (!text.trim()) return { value: null, sha: file.sha };
  return { value: JSON.parse(text), sha: file.sha };
}
const writeJson = (path, value, message) =>
  ghWrite(path, Buffer.from(JSON.stringify(value), "utf8"), message);

async function readBody(req, limit = 4_500_000) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return req.body.trim() ? JSON.parse(req.body) : {};
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8");
    return text.trim() ? JSON.parse(text) : {};
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("too_large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(data));
}
function guard(req, res) {
  if (missingAuth().length || missingStorage().length) {
    send(res, 503, {
      error: "not_configured",
      missing: [...missingAuth(), ...missingStorage()]
    });
    return false;
  }
  if (!verify(req)) {
    send(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

module.exports = {
  env,
  cfg,
  missingAuth,
  missingStorage,
  makeToken,
  same,
  delay,
  ghGet,
  ghGetRaw,
  ghWrite,
  readJson,
  writeJson,
  readBody,
  send,
  guard
};
