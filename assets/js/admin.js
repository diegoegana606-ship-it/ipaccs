/* ============================================================
   Panel de administración
   ------------------------------------------------------------
   Seguridad : contraseña + clave especial (hash SHA-256)
   Catálogo  : IndexedDB (ia-admin / kv / catalog)
   Exportar  : descarga products.js para publicar el catálogo
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Constantes ---------- */
  const CREDS_KEY = "ia_admin_creds";
  const GUARD_KEY = "ia_admin_guard";
  const SESSION_KEY = "ia_admin_session";
  const THEME_KEY = "ia_theme";
  const DB_NAME = "ia-admin";
  const STORE = "kv";
  const CATALOG_KEY = "catalog";
  const SETTINGS_KEY = "settings";
  const TIERS = [3, 6, 12, 20, 50, 100];

  const DEFAULT_CREDS = {
    pass: "e03820189229e5d7f4a9cfe0a392eb562db84ef09cd2dda775c3f6e7d116f893",
    key: "62a454ab098cdff465e3144ddaebcc1281165078040c0ae15f62e903c934ea30"
  };
  const MAX_FAILS = 5;
  const LOCK_MS = 60 * 1000;
  const SESSION_MS = 12 * 60 * 60 * 1000;
  const IS_LOCAL = location.protocol === "file:" ||
    (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(location.hostname) &&
      !/[?&]api=1(?:&|$)/.test(location.search));
  const SERVER_MODE = !IS_LOCAL;
  const TOKEN_KEY = "ia_admin_token";
  const API = {
    login: "api/login",
    catalog: "api/catalog",
    save: "api/save",
    upload: "api/upload"
  };

  const MAX_IMAGES = 5;
  const MAX_DIM = 900;
  const JPEG_Q = 0.8;
  const PLACEHOLDER = "assets/products/placeholder.svg";

  const localAsset = (src, dir) => {
    const m = /^assets\/products\/([^/]+)\.jpg$/i.exec(src);
    return m ? `assets/${dir}/${m[1]}.jpg` : src;
  };
  const cardImg = (src) => localAsset(src, "cards");
  const thumbImg = (src) => localAsset(src, "thumbs");
  const originalImg = (src) => String(src).replace(/^assets\/(?:cards|thumbs)\//i, "assets/products/");
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!img || img.tagName !== "IMG") return;
    const src = img.getAttribute("src") || "";
    const fixed = originalImg(src);
    if (fixed !== src) img.src = fixed;
  }, true);

  /* ---------- Utilidades ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"></use></svg>`;
  const money = (n) => "$" + Number(n).toLocaleString("es-MX");
  const hasPrice = (p) => typeof p.price === "number" && p.price > 0;
  const priceLabel = (p) => hasPrice(p) ? money(p.price) : "Precio por confirmar";
  const wholesaleOf = (p) => (p && typeof p.wholesale === "object" && p.wholesale) || {};
  const stockOf = (p) => {
    const n = Number(p && p.stock);
    return p && p.stock !== null && p.stock !== "" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };
  const lowStockLimit = () => Math.max(1, Number(state.settings.lowStock) || 3);

  function normalizeSettings(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    const cats = Array.isArray(data.categories)
      ? data.categories.map((c) => String(c || "").trim()).filter(Boolean)
      : [];
    return {
      whatsapp: String(data.whatsapp || window.WHATSAPP_NUMBER || "584123897248").replace(/\D/g, ""),
      lowStock: Math.max(0, Math.floor(Number(data.lowStock)) || 3),
      instagram: String(data.instagram || "").trim(),
      tiktok: String(data.tiktok || "").trim(),
      categories: [...new Set(cats)]
    };
  }

  const toastEl = $("#toast");
  let toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  function slugify(text) {
    const base = String(text)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "producto";
  }

  /* ---------- Tema ---------- */
  const themeToggle = $("#themeToggle");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const currentTheme = () => document.documentElement.dataset.theme || "dark";

  function applyTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    if (themeMeta) themeMeta.setAttribute("content", theme === "light" ? "#f5f5f7" : "#08080a");
    themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    themeToggle.setAttribute(
      "aria-label",
      theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro"
    );
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    }
  }

  applyTheme(currentTheme(), false);
  themeToggle.addEventListener("click", () => {
    applyTheme(currentTheme() === "light" ? "dark" : "light");
  });

  /* ---------- Hash SHA-256 ---------- */
  const canHash = !!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest);

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function hasCustomCreds() {
    try {
      const raw = JSON.parse(localStorage.getItem(CREDS_KEY));
      return !!(raw && typeof raw.pass === "string" && raw.pass && typeof raw.key === "string" && raw.key);
    } catch (e) {
      return false;
    }
  }

  function readCreds() {
    try {
      const raw = JSON.parse(localStorage.getItem(CREDS_KEY));
      if (raw && typeof raw.pass === "string" && typeof raw.key === "string" && raw.pass && raw.key) {
        return raw;
      }
    } catch (e) {}
    return DEFAULT_CREDS;
  }

  /* ---------- Intentos fallidos ---------- */
  function readGuard() {
    try {
      const raw = JSON.parse(localStorage.getItem(GUARD_KEY));
      if (raw && typeof raw.fails === "number" && typeof raw.until === "number") return raw;
    } catch (e) {}
    return { fails: 0, until: 0 };
  }
  function writeGuard(guard) {
    try { localStorage.setItem(GUARD_KEY, JSON.stringify(guard)); } catch (e) {}
  }
  const lockLeft = () => Math.max(0, Math.ceil((readGuard().until - Date.now()) / 1000));

  /* ---------- Elementos ---------- */
  const loginView = $("#loginView");
  const loginForm = $("#loginForm");
  const passInput = $("#passInput");
  const keyInput = $("#keyInput");
  const loginError = $("#loginError");
  const loginBtn = $("#loginBtn");
  const resetAccessBtn = $("#resetAccessBtn");
  const setupView = $("#setupView");
  const setupForm = $("#setupForm");
  const setupPass = $("#setupPass");
  const setupPass2 = $("#setupPass2");
  const setupKey = $("#setupKey");
  const setupError = $("#setupError");
  const setupBtn = $("#setupBtn");
  const adminView = $("#adminView");
  const lockBtn = $("#lockBtn");
  const publishStatus = $("#publishStatus");
  const publishText = $(".publish-text", publishStatus);
  const catalogHint = $("#catalogHint");
  const credsSub = $("#credsSub");
  const serverCredsNote = $("#serverCredsNote");

  const productForm = $("#productForm");
  const formTitle = $("#formTitle");
  const nameInput = $("#nameInput");
  const subtitleInput = $("#subtitleInput");
  const categorySelect = $("#categorySelect");
  const newCatField = $("#newCatField");
  const newCatInput = $("#newCatInput");
  const priceInput = $("#priceInput");
  const stockInput = $("#stockInput");
  const tagInput = $("#tagInput");
  const descInput = $("#descInput");
  const saveBtn = $("#saveBtn");
  const cancelEditBtn = $("#cancelEditBtn");
  const formError = $("#formError");
  const tierInputs = {};
  TIERS.forEach((tier) => { tierInputs[tier] = $("#tier" + tier); });

  const dropzone = $("#dropzone");
  const imageInput = $("#imageInput");
  const dzEmpty = $("#dzEmpty");
  const dzPreviews = $("#dzPreviews");

  const searchInput = $("#searchInput");
  const listCount = $("#listCount");
  const adminProducts = $("#adminProducts");
  const adminStats = $("#adminStats");
  const adminAlert = $("#adminAlert");

  const tabsNav = $("#adminTabs");
  const tabs = $$(".admin-tab", tabsNav);
  const tabPanels = $$(".tab-panel");

  const priceSearch = $("#priceSearch");
  const priceRows = $("#priceRows");
  const priceHint = $("#priceHint");
  const savePricesBtn = $("#savePricesBtn");

  const stockRows = $("#stockRows");
  const stockSummary = $("#stockSummary");
  const saveStockBtn = $("#saveStockBtn");

  const catForm = $("#catForm");
  const catName = $("#catName");
  const catList = $("#catList");

  const settingsForm = $("#settingsForm");
  const setWa = $("#setWa");
  const setLow = $("#setLow");
  const setIg = $("#setIg");
  const setTt = $("#setTt");
  const saveSettings = $("#saveSettings");

  const exportBtn = $("#exportBtn");
  const importBtn = $("#importBtn");
  const importFile = $("#importFile");
  const resetBtn = $("#resetBtn");

  const credsForm = $("#credsForm");
  const newPass = $("#newPass");
  const newPass2 = $("#newPass2");
  const newKey = $("#newKey");
  const resetCredsBtn = $("#resetCredsBtn");

  /* ---------- Estado ---------- */
  const initialSettings = normalizeSettings(window.STORE_SETTINGS);
  const state = {
    products: [],
    images: [],
    editingId: null,
    editingCat: null,
    loaded: false,
    activeTab: "productos",
    settings: initialSettings,
    whatsapp: initialSettings.whatsapp,
    remoteVersion: 0,
    remoteUpdatedAt: ""
  };

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async function idbSet(key, value) {
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function idbDel(key) {
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  /* ---------- Catálogo ---------- */
  function normalize(p) {
    if (!p || typeof p !== "object") return null;
    const name = String(p.name || "").trim();
    if (!name) return null;
    const wholesale = {};
    TIERS.forEach((tier) => {
      const value = Number(wholesaleOf(p)[tier]);
      if (Number.isFinite(value) && value > 0) wholesale[tier] = Math.round(value);
    });
    return {
      id: String(p.id || slugify(name)),
      name,
      subtitle: String(p.subtitle || "").trim(),
      category: String(p.category || "Otros").trim() || "Otros",
      price: typeof p.price === "number" && p.price > 0 ? Math.round(p.price) : null,
      stock: stockOf(p),
      wholesale,
      tag: String(p.tag || "").trim(),
      desc: String(p.desc || "").trim(),
      images: Array.isArray(p.images)
        ? p.images.filter((src) => typeof src === "string" && src).slice(0, MAX_IMAGES)
        : []
    };
  }

  function sourceProducts() {
    const list = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
    return list.map(normalize).filter(Boolean);
  }

  async function ensureCatalog() {
    if (state.loaded) return;
    let stored = null;
    let storedSettings = null;
    try {
      [stored, storedSettings] = await Promise.all([idbGet(CATALOG_KEY), idbGet(SETTINGS_KEY)]);
    } catch (e) {}
    const base = Array.isArray(stored) ? stored : sourceProducts();
    state.products = base.map(normalize).filter(Boolean);
    if (storedSettings) state.settings = normalizeSettings(storedSettings);
    state.whatsapp = state.settings.whatsapp;
    state.loaded = true;
  }

  async function persist() {
    if (SERVER_MODE) return requestPublish();
    try {
      await idbSet(CATALOG_KEY, state.products);
      return true;
    } catch (e) {
      toast("No se pudo guardar en este navegador. Si subiste fotos, prueba con imágenes más ligeras.");
      return false;
    }
  }

  async function persistSettings() {
    if (SERVER_MODE) return requestPublish();
    try {
      await idbSet(SETTINGS_KEY, state.settings);
      return true;
    } catch (e) {
      toast("No se pudieron guardar los ajustes en este navegador.");
      return false;
    }
  }

  /* ---------- Publicación automática (servidor + GitHub) ---------- */
  let publishChain = null;
  let publishQueued = false;
  let publishBlocked = false;
  let publishRetry = null;

  const publishError = (code) => {
    const err = new Error(code);
    err.code = code;
    return err;
  };

  function setPublishStatus(kind, text) {
    if (!publishStatus) return;
    publishStatus.hidden = false;
    publishStatus.classList.remove("is-saving", "is-ok", "is-error");
    if (kind) publishStatus.classList.add("is-" + kind);
    publishText.textContent = text;
  }

  const clockLabel = (iso) => {
    const date = iso ? new Date(iso) : new Date();
    return date.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
  };

  function schedulePublishRetry() {
    setPublishStatus("error", "Sin conexión · reintentando");
    if (publishRetry) return;
    publishRetry = setTimeout(() => {
      publishRetry = null;
      if (!publishBlocked) requestPublish();
    }, 10000);
  }

  async function uploadPendingImages() {
    const pending = state.products.reduce(
      (sum, p) => sum + (p.images || []).filter((src) => String(src).startsWith("data:")).length,
      0
    );
    if (!pending) return;
    let done = 0;
    for (const product of state.products) {
      const images = Array.isArray(product.images) ? product.images : [];
      if (!images.some((src) => String(src).startsWith("data:"))) continue;
      const next = [];
      for (const src of images) {
        if (!String(src).startsWith("data:")) {
          next.push(src);
          continue;
        }
        done += 1;
        setPublishStatus("saving", `Subiendo fotos ${done}/${pending}…`);
        const res = await fetch(API.upload, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ data: src })
        });
        if (res.status === 401) throw publishError("auth");
        if (!res.ok) throw publishError("upload");
        const data = await res.json().catch(() => ({}));
        if (!data.url) throw publishError("upload");
        next.push(data.url);
      }
      product.images = next;
    }
  }

  async function publishNow() {
    if (!readToken()) {
      setPublishStatus("error", "Sesión expirada");
      return false;
    }
    setPublishStatus("saving", "Publicando…");
    try {
      await uploadPendingImages();
      const res = await fetch(API.save, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          baseVersion: state.remoteVersion,
          catalog: { products: state.products, settings: state.settings }
        })
      });
      if (res.status === 401) throw publishError("auth");
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        state.remoteVersion = Number(data.version) || state.remoteVersion;
        publishBlocked = true;
        setPublishStatus("error", "Cambios en otra sesión");
        toast("El catálogo cambió desde otro dispositivo. Recarga el panel.");
        return false;
      }
      if (res.status === 503) {
        setPublishStatus("error", "Servidor sin configurar");
        toast("Falta configurar GitHub y el acceso en Vercel.");
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "too_large") {
          setPublishStatus("error", "Catálogo muy grande");
          toast("El catálogo es muy grande. Reduce el número o el peso de las fotos.");
        } else if (data.error === "images_not_uploaded") {
          setPublishStatus("error", "Fotos sin subir");
          toast("No se pudieron subir todas las fotos. Intenta guardar de nuevo.");
        } else {
          setPublishStatus("error", "Error al publicar");
        }
        return false;
      }
      const data = await res.json();
      state.remoteVersion = Number(data.version) || state.remoteVersion + 1;
      state.remoteUpdatedAt = data.updatedAt || new Date().toISOString();
      setPublishStatus("ok", "Publicado · " + clockLabel(state.remoteUpdatedAt));
      return true;
    } catch (e) {
      if (e.code === "auth") {
        clearToken();
        clearSession();
        setPublishStatus("error", "Sesión expirada");
        toast("La sesión expiró. Vuelve a entrar al panel.");
        setTimeout(() => location.reload(), 1600);
        return false;
      }
      if (e.code === "upload") {
        setPublishStatus("error", "No se subieron las fotos");
        toast("No se pudieron subir las fotos. Revisa la conexión y guarda de nuevo.");
        return false;
      }
      schedulePublishRetry();
      return false;
    }
  }

  function requestPublish() {
    if (!SERVER_MODE || publishBlocked) return Promise.resolve(false);
    if (publishChain) {
      publishQueued = true;
      return publishChain;
    }
    publishChain = (async () => {
      let ok = false;
      try {
        do {
          publishQueued = false;
          ok = await publishNow();
        } while (publishQueued && ok);
      } finally {
        publishChain = null;
      }
      return ok;
    })();
    return publishChain;
  }

  async function loadRemoteCatalog() {
    setPublishStatus("saving", "Cargando catálogo…");
    try {
      const res = await fetch(`${API.catalog}?_=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error("http_" + res.status);
      const data = await res.json();
      if (!Array.isArray(data.products)) throw new Error("shape");
      state.products = data.products.map(normalize).filter(Boolean);
      state.settings = normalizeSettings(data.settings);
      state.whatsapp = state.settings.whatsapp;
      state.remoteVersion = Number(data.version) || 0;
      state.remoteUpdatedAt = data.updatedAt || "";
      state.loaded = true;
      setPublishStatus("ok", "Publicado · " + clockLabel(data.updatedAt));
      return true;
    } catch (e) {
      setPublishStatus("error", "Sin conexión");
      return false;
    }
  }

  const categories = () => [...new Set([
    ...state.settings.categories,
    ...state.products.map((p) => p.category)
  ].filter(Boolean))];

  /* ---------- Sesión ---------- */
  function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function writeToken(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
  }
  function clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function authHeaders(extra) {
    return { ...extra, Authorization: "Bearer " + readToken() };
  }

  function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() })); } catch (e) {}
  }
  function validSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      const timed = !!(s && typeof s.at === "number" && Date.now() - s.at < SESSION_MS);
      return timed && (!SERVER_MODE || !!readToken());
    } catch (e) {
      return false;
    }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* ---------- Bloqueo temporal ---------- */
  let lockTicker = null;

  function updateLockState() {
    const left = lockLeft();
    if (left > 0) {
      loginBtn.disabled = true;
      loginError.dataset.reason = "lock";
      loginError.textContent = `Demasiados intentos. Intenta de nuevo en ${left} s.`;
      return true;
    }
    if (loginError.dataset.reason === "lock") {
      loginError.textContent = "";
      delete loginError.dataset.reason;
    }
    loginBtn.disabled = false;
    return false;
  }

  function startLockTicker() {
    if (lockTicker) return;
    lockTicker = setInterval(() => {
      if (!updateLockState()) {
        clearInterval(lockTicker);
        lockTicker = null;
      }
    }, 1000);
  }

  /* ---------- Acceso ---------- */
  function showLoginError(message) {
    loginError.dataset.reason = "error";
    loginError.textContent = message;
  }

  function registerLoginFail() {
    const guard = readGuard();
    guard.fails += 1;
    if (guard.fails >= MAX_FAILS) {
      guard.fails = 0;
      guard.until = Date.now() + LOCK_MS;
      writeGuard(guard);
      passInput.value = "";
      keyInput.value = "";
      startLockTicker();
      updateLockState();
      return;
    }
    writeGuard(guard);
    showLoginError(`Contraseña o clave incorrecta. Intentos restantes: ${MAX_FAILS - guard.fails}.`);
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (updateLockState()) return;

    const pass = passInput.value.trim();
    const key = keyInput.value.trim();
    if (!pass || !key) {
      showLoginError("Escribe la contraseña y la clave especial.");
      return;
    }

    loginBtn.disabled = true;
    showLoginError("");

    if (SERVER_MODE) {
      try {
        const res = await fetch(API.login, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pass, key })
        });
        if (res.ok) {
          const data = await res.json();
          if (!data.token) throw new Error("no_token");
          writeToken(data.token);
          writeGuard({ fails: 0, until: 0 });
          loginForm.reset();
          await unlock();
          return;
        }
        if (res.status === 503) {
          showLoginError("El servidor todavía no está configurado. Revisa las variables en Vercel.");
          return;
        }
        if (res.status === 429) {
          showLoginError("Demasiados intentos. Espera un minuto y vuelve a probar.");
          return;
        }
        registerLoginFail();
      } catch (err) {
        showLoginError("No se pudo conectar con el servidor. Revisa la conexión.");
      } finally {
        if (!loginView.hidden) loginBtn.disabled = lockLeft() > 0;
      }
      return;
    }

    if (!canHash) {
      showLoginError("Este navegador no permite el acceso seguro. Abre la página de forma local o con HTTPS.");
      loginBtn.disabled = false;
      return;
    }

    try {
      const [passHash, keyHash] = await Promise.all([sha256(pass), sha256(key)]);
      const creds = readCreds();
      if (passHash === creds.pass && keyHash === creds.key) {
        writeGuard({ fails: 0, until: 0 });
        loginForm.reset();
        await unlock();
        return;
      }
      registerLoginFail();
    } catch (err) {
      showLoginError("No se pudo verificar el acceso. Intenta de nuevo.");
    } finally {
      if (!loginView.hidden) loginBtn.disabled = lockLeft() > 0;
    }
  });

  $$(".pass-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.toggle);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("is-visible", show);
      btn.setAttribute("aria-label", show ? "Ocultar" : "Mostrar");
    });
  });

  /* ---------- Primer acceso / restablecimiento local ---------- */
  function showSetup() {
    loginView.hidden = true;
    adminView.hidden = true;
    setupView.hidden = false;
    setupError.textContent = "";
    document.title = "Crear acceso · Iphone's Accesorios";
    setTimeout(() => setupPass.focus(), 50);
  }

  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = setupPass.value.trim();
    const pass2 = setupPass2.value.trim();
    const key = setupKey.value.trim();
    setupError.textContent = "";

    if (pass.length < 6 || key.length < 6) {
      setupError.textContent = "La contraseña y la clave deben tener al menos 6 caracteres.";
      return;
    }
    if (pass !== pass2) {
      setupError.textContent = "Las contraseñas no coinciden.";
      setupPass2.focus();
      return;
    }
    if (!canHash) {
      setupError.textContent = "Este navegador no permite guardar el acceso de forma segura. Abre la página en localhost o con HTTPS.";
      return;
    }

    setupBtn.disabled = true;
    try {
      const [passHash, keyHash] = await Promise.all([sha256(pass), sha256(key)]);
      localStorage.setItem(CREDS_KEY, JSON.stringify({ pass: passHash, key: keyHash }));
      writeGuard({ fails: 0, until: 0 });
      setupForm.reset();
      setupView.hidden = true;
      await unlock();
      toast("Acceso creado. Guarda tu contraseña y clave.");
    } catch (err) {
      setupError.textContent = "No se pudo guardar el acceso. Intenta de nuevo.";
    } finally {
      setupBtn.disabled = false;
    }
  });

  if (IS_LOCAL) {
    resetAccessBtn.hidden = false;
    resetCredsBtn.textContent = "Restablecer acceso";
    resetAccessBtn.addEventListener("click", () => {
      if (!window.confirm("Se borrarán la contraseña y la clave guardadas en este navegador para que crees unas nuevas. ¿Continuar?")) {
        return;
      }
      try { localStorage.removeItem(CREDS_KEY); } catch (e) {}
      try { localStorage.removeItem(GUARD_KEY); } catch (e) {}
      clearSession();
      showSetup();
    });
  }

  async function unlock() {
    loginView.hidden = true;
    adminView.hidden = false;
    if (lockTicker) {
      clearInterval(lockTicker);
      lockTicker = null;
    }
    saveSession();
    document.title = "Panel · Iphone's Accesorios";
    window.scrollTo(0, 0);
    if (SERVER_MODE) {
      const ok = await loadRemoteCatalog();
      if (!ok) toast("No se pudo cargar el catálogo publicado. Revisa la conexión.");
    } else {
      await ensureCatalog();
    }
    renderAll();
  }

  lockBtn.addEventListener("click", () => {
    clearToken();
    clearSession();
    location.reload();
  });

  /* ---------- Formulario ---------- */
  function renderCategorySelect(selected) {
    const cats = categories();
    if (selected && !cats.includes(selected)) cats.push(selected);
    const prev = categorySelect.value;

    categorySelect.innerHTML = cats
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("") + `<option value="__new">+ Nueva categoría…</option>`;

    const pick = selected != null
      ? selected
      : (cats.includes(prev) ? prev : cats[0] || "__new");
    categorySelect.value = pick;
    newCatField.hidden = categorySelect.value !== "__new";
  }

  categorySelect.addEventListener("change", () => {
    newCatField.hidden = categorySelect.value !== "__new";
    if (categorySelect.value === "__new") newCatInput.focus();
  });

  function renderPreviews() {
    dzEmpty.hidden = state.images.length > 0;
    dzPreviews.innerHTML = state.images.map((src, i) => `
      <div class="dz-thumb${i === 0 ? " is-cover" : ""}">
        <img src="${esc(i === 0 ? cardImg(src) : thumbImg(src))}" alt="">
        <span class="dz-cover-tag">Portada</span>
        <button class="dz-remove" type="button" data-i="${i}" aria-label="Quitar foto ${i + 1}">×</button>
      </div>`).join("");
  }

  dzPreviews.addEventListener("click", (e) => {
    const btn = e.target.closest(".dz-remove");
    if (!btn) return;
    e.stopPropagation();
    state.images.splice(Number(btn.dataset.i), 1);
    renderPreviews();
  });

  function resetForm() {
    state.editingId = null;
    state.images = [];
    nameInput.value = "";
    subtitleInput.value = "";
    priceInput.value = "";
    stockInput.value = "";
    tagInput.value = "";
    descInput.value = "";
    newCatInput.value = "";
    imageInput.value = "";
    TIERS.forEach((tier) => { tierInputs[tier].value = ""; });
    formError.textContent = "";
    formTitle.textContent = "Agregar producto";
    saveBtn.textContent = "Guardar producto";
    cancelEditBtn.hidden = true;
    renderCategorySelect();
    renderPreviews();
  }

  function startEdit(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    state.editingId = p.id;
    state.images = p.images.slice();
    nameInput.value = p.name;
    subtitleInput.value = p.subtitle || "";
    priceInput.value = hasPrice(p) ? String(p.price) : "";
    stockInput.value = p.stock == null ? "" : String(p.stock);
    tagInput.value = p.tag;
    descInput.value = p.desc;
    newCatInput.value = "";
    TIERS.forEach((tier) => {
      const value = Number(wholesaleOf(p)[tier]);
      tierInputs[tier].value = Number.isFinite(value) && value > 0 ? String(Math.round(value)) : "";
    });
    formError.textContent = "";
    renderCategorySelect(p.category);
    renderPreviews();
    formTitle.textContent = "Editar producto";
    saveBtn.textContent = "Guardar cambios";
    cancelEditBtn.hidden = false;
    $(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  cancelEditBtn.addEventListener("click", resetForm);

  function uniqueId(name) {
    const base = slugify(name);
    let id = base;
    let n = 2;
    while (state.products.some((p) => p.id === id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    return id;
  }

  productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.textContent = "";

    const name = nameInput.value.trim();
    if (!name) {
      formError.textContent = "Escribe el nombre del producto.";
      nameInput.focus();
      return;
    }

    let category = categorySelect.value;
    if (category === "__new") {
      category = newCatInput.value.trim();
      if (!category) {
        formError.textContent = "Escribe el nombre de la nueva categoría.";
        newCatInput.focus();
        return;
      }
    }
    if (!category) {
      formError.textContent = "Selecciona una categoría.";
      return;
    }

    let price = null;
    const priceRaw = priceInput.value.trim();
    if (priceRaw !== "") {
      const n = Number(priceRaw);
      if (!Number.isFinite(n) || n <= 0) {
        formError.textContent = "El precio debe ser un número mayor a 0 (o déjalo vacío).";
        priceInput.focus();
        return;
      }
      price = Math.round(n);
    }

    let stock = null;
    const stockRaw = stockInput.value.trim();
    if (stockRaw !== "") {
      const n = Number(stockRaw);
      if (!Number.isFinite(n) || n < 0) {
        formError.textContent = "El stock debe ser 0 o un número mayor.";
        stockInput.focus();
        return;
      }
      stock = Math.floor(n);
    }

    const wholesale = {};
    for (const tier of TIERS) {
      const raw = tierInputs[tier].value.trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        formError.textContent = `El precio al mayor desde ${tier} debe ser mayor a 0.`;
        tierInputs[tier].focus();
        return;
      }
      wholesale[tier] = Math.round(n);
    }

    if (state.images.length === 0) {
      formError.textContent = "Sube al menos una foto del producto.";
      dropzone.focus();
      return;
    }

    const editing = state.products.find((p) => p.id === state.editingId);
    const product = {
      id: editing ? editing.id : uniqueId(name),
      name,
      subtitle: subtitleInput.value.trim(),
      category,
      price,
      stock,
      wholesale,
      tag: tagInput.value.trim(),
      desc: descInput.value.trim(),
      images: state.images.slice()
    };

    saveBtn.disabled = true;
    try {
      if (editing) {
        const index = state.products.indexOf(editing);
        state.products[index] = product;
      } else {
        state.products.unshift(product);
      }
      const ok = await persist();
      resetForm();
      renderAll();
      if (ok) toast(editing ? "Producto actualizado" : "Producto agregado");
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* ---------- Fotos ---------- */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" })
        .catch(() => loadBitmapFallback(file));
    }
    return loadBitmapFallback(file);
  }

  function loadBitmapFallback(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setTimeout(() => URL.revokeObjectURL(url), 0);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo leer la imagen"));
      };
      img.src = url;
    });
  }

  function toJpeg(source) {
    const w = source.width;
    const h = source.height;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === "function") source.close();
    return canvas.toDataURL("image/jpeg", JPEG_Q);
  }

  async function addPhotos(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      toast("Selecciona archivos de imagen (JPG, PNG…).");
      return;
    }
    const room = MAX_IMAGES - state.images.length;
    if (room <= 0) {
      toast(`Máximo ${MAX_IMAGES} fotos por producto.`);
      return;
    }
    const chosen = files.slice(0, room);
    if (files.length > room) {
      toast(`Solo se agregaron ${room} foto(s). Máximo ${MAX_IMAGES}.`);
    }

    let failed = 0;
    for (const file of chosen) {
      try {
        const bitmap = await loadBitmap(file);
        state.images.push(toJpeg(bitmap));
      } catch (e) {
        failed += 1;
      }
    }
    renderPreviews();
    if (failed > 0) toast("No se pudo leer una de las fotos. Prueba con JPG o PNG.");
  }

  dropzone.addEventListener("click", (e) => {
    if (e.target.closest(".dz-remove")) return;
    imageInput.click();
  });

  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      imageInput.click();
    }
  });

  imageInput.addEventListener("change", () => {
    if (imageInput.files.length) addPhotos(imageInput.files);
    imageInput.value = "";
  });

  ["dragenter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-drag");
    });
  });
  ["dragleave", "dragend"].forEach((type) => {
    dropzone.addEventListener(type, () => dropzone.classList.remove("is-drag"));
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-drag");
    if (e.dataTransfer && e.dataTransfer.files.length) addPhotos(e.dataTransfer.files);
  });

  /* ---------- Lista ---------- */
  function renderStats() {
    const total = state.products.length;
    const pending = state.products.filter((p) => !hasPrice(p)).length;
    adminStats.textContent =
      `${total} producto${total === 1 ? "" : "s"} · ${categories().length} categoría${categories().length === 1 ? "" : "s"}` +
      (pending ? ` · ${pending} sin precio` : "");
  }

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const list = state.products.filter((p) =>
      !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );

    listCount.textContent = q
      ? `${list.length} de ${state.products.length}`
      : `${state.products.length} en total`;

    if (list.length === 0) {
      adminProducts.innerHTML = `<p class="list-empty">${
        state.products.length === 0
          ? "El catálogo está vacío. Agrega tu primer producto."
          : "No hay productos que coincidan con la búsqueda."
      }</p>`;
      return;
    }

    adminProducts.innerHTML = list.map((p) => {
      const img = cardImg(p.images[0] || PLACEHOLDER);
      const stock = stockOf(p);
      const stockText = stock === null ? "" : (stock === 0 ? "Agotado" : `${stock} en stock`);
      const meta = [p.category, p.subtitle, stockText]
        .filter(Boolean).join(" · ");
      return `
        <div class="admin-product" data-id="${esc(p.id)}">
          <img src="${esc(img)}" alt="" loading="lazy">
          <div class="admin-product-info">
            <h3>${esc(p.name)}</h3>
            <p>${esc(meta)}</p>
            <span class="admin-product-price${hasPrice(p) ? "" : " is-pending"}">${esc(priceLabel(p))}</span>
          </div>
          <div class="admin-product-actions">
            <button class="icon-btn" type="button" data-act="edit" data-id="${esc(p.id)}"
              aria-label="Editar ${esc(p.name)}" title="Editar">${icon("edit")}</button>
            <button class="icon-btn is-danger" type="button" data-act="del" data-id="${esc(p.id)}"
              aria-label="Eliminar ${esc(p.name)}" title="Eliminar">${icon("trash")}</button>
          </div>
        </div>`;
    }).join("");
  }

  adminProducts.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const p = state.products.find((x) => x.id === btn.dataset.id);
    if (!p) return;

    if (btn.dataset.act === "edit") {
      startEdit(p.id);
      return;
    }

    if (btn.dataset.act === "del") {
      if (!window.confirm(`¿Eliminar "${p.name}" del catálogo?`)) return;
      state.products = state.products.filter((x) => x.id !== p.id);
      if (state.editingId === p.id) resetForm();
      const ok = await persist();
      renderAll();
      if (ok) toast("Producto eliminado");
    }
  });

  searchInput.addEventListener("input", renderList);

  function renderAlert() {
    const limit = lowStockLimit();
    const low = state.products.filter((p) => {
      const stock = stockOf(p);
      return stock !== null && stock > 0 && stock <= limit;
    });
    const out = state.products.filter((p) => stockOf(p) === 0);
    if (!low.length && !out.length) {
      adminAlert.hidden = true;
      adminAlert.textContent = "";
      return;
    }
    const bits = [];
    if (low.length) bits.push(`${low.length} con stock bajo (≤ ${limit})`);
    if (out.length) bits.push(`${out.length} agotado${out.length === 1 ? "" : "s"}`);
    adminAlert.textContent = `Aviso: ${bits.join(" · ")}. Revisa la pestaña Stock.`;
    adminAlert.hidden = false;
  }

  function tableProduct(p) {
    return `<div class="table-product">
      <img src="${esc(cardImg(p.images[0] || PLACEHOLDER))}" alt="" loading="lazy">
      <span>${esc(p.name)}<small>${esc(p.category)}</small></span>
    </div>`;
  }

  function readMoneyField(input) {
    const raw = input.value.trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : NaN;
  }

  /* ---------- Pestaña Precios ---------- */
  function renderPrices() {
    const q = priceSearch.value.trim().toLowerCase();
    const list = state.products.filter((p) =>
      !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
    priceHint.textContent = `${list.length} de ${state.products.length} productos · vacío = sin precio`;

    if (list.length === 0) {
      priceRows.innerHTML = `<tr><td colspan="${2 + TIERS.length}"><p class="list-empty">${
        state.products.length === 0 ? "Agrega productos para editar sus precios." : "No hay productos que coincidan."
      }</p></td></tr>`;
      return;
    }

    priceRows.innerHTML = list.map((p) => {
      const wholesale = wholesaleOf(p);
      const tierCells = TIERS.map((tier) => {
        const value = Number(wholesale[tier]);
        return `<td><input type="number" min="0" step="1" inputmode="numeric"
          data-field="tier" data-tier="${tier}" value="${Number.isFinite(value) && value > 0 ? Math.round(value) : ""}"
          placeholder="—" aria-label="Precio desde ${tier} unidades de ${esc(p.name)}"></td>`;
      }).join("");
      return `<tr data-id="${esc(p.id)}">
        <td>${tableProduct(p)}</td>
        <td><input type="number" min="0" step="1" inputmode="numeric"
          data-field="price" value="${hasPrice(p) ? p.price : ""}" placeholder="—"
          aria-label="Precio al detal de ${esc(p.name)}"></td>
        ${tierCells}
      </tr>`;
    }).join("");
  }

  priceSearch.addEventListener("input", renderPrices);

  savePricesBtn.addEventListener("click", async () => {
    const rows = $$("#priceRows tr[data-id]");
    const updates = [];
    for (const row of rows) {
      const product = state.products.find((p) => p.id === row.dataset.id);
      if (!product) continue;

      const retailInput = $('[data-field="price"]', row);
      const retail = readMoneyField(retailInput);
      if (Number.isNaN(retail)) {
        toast("Revisa el precio al detal: debe ser mayor a 0 o quedar vacío.");
        retailInput.focus();
        return;
      }

      const wholesale = {};
      let bad = false;
      TIERS.forEach((tier) => {
        if (bad) return;
        const input = $(`[data-field="tier"][data-tier="${tier}"]`, row);
        const value = readMoneyField(input);
        if (Number.isNaN(value)) {
          bad = true;
          toast(`Revisa el precio desde ${tier} unidades.`);
          input.focus();
          return;
        }
        if (value !== null) wholesale[tier] = value;
      });
      if (bad) return;

      updates.push({ product, retail, wholesale });
    }

    updates.forEach(({ product, retail, wholesale }) => {
      product.price = retail;
      product.wholesale = wholesale;
    });

    const ok = await persist();
    renderAll();
    if (ok) toast("Precios actualizados");
  });

  /* ---------- Pestaña Stock ---------- */
  function stockState(p) {
    const stock = stockOf(p);
    const limit = lowStockLimit();
    if (stock === null) return { cls: "is-none", label: "Sin control" };
    if (stock === 0) return { cls: "is-out", label: "Agotado" };
    if (stock <= limit) return { cls: "is-low", label: "Stock bajo" };
    return { cls: "is-ok", label: "Disponible" };
  }

  function renderStock() {
    const low = state.products.filter((p) => {
      const stock = stockOf(p);
      return stock !== null && stock > 0 && stock <= lowStockLimit();
    }).length;
    const out = state.products.filter((p) => stockOf(p) === 0).length;
    stockSummary.innerHTML =
      `<b>${state.products.length}</b> productos · <b>${low}</b> con stock bajo · <b>${out}</b> agotados`;

    if (state.products.length === 0) {
      stockRows.innerHTML = `<tr><td colspan="4"><p class="list-empty">Agrega productos para controlar su stock.</p></td></tr>`;
      return;
    }

    stockRows.innerHTML = state.products.map((p) => {
      const stock = stockOf(p);
      const st = stockState(p);
      return `<tr data-id="${esc(p.id)}">
        <td>${tableProduct(p)}</td>
        <td>${esc(p.category)}</td>
        <td><input type="number" min="0" step="1" inputmode="numeric" data-field="stock"
          value="${stock === null ? "" : stock}" placeholder="—"
          aria-label="Stock de ${esc(p.name)}"></td>
        <td><span class="stock-pill ${st.cls}" data-stock-status>${st.label}</span></td>
      </tr>`;
    }).join("");
  }

  stockRows.addEventListener("input", (e) => {
    const input = e.target.closest('input[data-field="stock"]');
    if (!input) return;
    const pill = $("[data-stock-status]", input.closest("tr"));
    if (!pill) return;
    const raw = input.value.trim();
    const limit = lowStockLimit();
    let cls = "is-none";
    let label = "Sin control";
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        cls = "is-out";
        label = "Inválido";
      } else if (n === 0) {
        cls = "is-out";
        label = "Agotado";
      } else if (n <= limit) {
        cls = "is-low";
        label = "Stock bajo";
      } else {
        cls = "is-ok";
        label = "Disponible";
      }
    }
    pill.className = `stock-pill ${cls}`;
    pill.textContent = label;
  });

  saveStockBtn.addEventListener("click", async () => {
    const rows = $$("#stockRows tr[data-id]");
    const updates = [];
    for (const row of rows) {
      const product = state.products.find((p) => p.id === row.dataset.id);
      if (!product) continue;
      const input = $('[data-field="stock"]', row);
      const raw = input.value.trim();
      let stock = null;
      if (raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          toast("El stock debe ser 0 o un número mayor.");
          input.focus();
          return;
        }
        stock = Math.floor(n);
      }
      updates.push({ product, stock });
    }

    updates.forEach(({ product, stock }) => { product.stock = stock; });
    const ok = await persist();
    renderAll();
    if (ok) toast("Stock actualizado");
  });

  /* ---------- Pestaña Categorías ---------- */
  function renderCategories() {
    const cats = categories();
    if (cats.length === 0) {
      catList.innerHTML = `<p class="cat-empty">Todavía no hay categorías. Agrega la primera arriba.</p>`;
      return;
    }
    catList.innerHTML = cats.map((cat) => {
      const count = state.products.filter((p) => p.category === cat).length;
      if (state.editingCat === cat) {
        return `<div class="cat-item is-editing">
          <form class="cat-edit" data-cat="${esc(cat)}">
            <input class="cat-edit-input" value="${esc(cat)}" maxlength="40"
              aria-label="Nuevo nombre de la categoría ${esc(cat)}">
            <div class="cat-item-actions">
              <button class="icon-btn" type="submit" aria-label="Guardar nombre" title="Guardar">${icon("check")}</button>
              <button class="icon-btn" type="button" data-act="cancel" aria-label="Cancelar edición" title="Cancelar">${icon("x")}</button>
            </div>
          </form>
        </div>`;
      }
      return `<div class="cat-item">
        <div>
          <button class="cat-name-btn" type="button" data-act="rename" data-cat="${esc(cat)}"
            aria-label="Editar nombre de ${esc(cat)}">${esc(cat)}</button>
          <small>${count} producto${count === 1 ? "" : "s"}</small>
        </div>
        <div class="cat-item-actions">
          <button class="icon-btn" type="button" data-act="rename" data-cat="${esc(cat)}"
            aria-label="Renombrar ${esc(cat)}" title="Renombrar">${icon("edit")}</button>
          <button class="icon-btn is-danger" type="button" data-act="del" data-cat="${esc(cat)}"
            aria-label="Eliminar ${esc(cat)}" title="Eliminar"${count > 0 ? " disabled" : ""}>${icon("trash")}</button>
        </div>
      </div>`;
    }).join("");

    const editInput = $(".cat-edit-input", catList);
    if (editInput) {
      editInput.focus();
      editInput.select();
    }
  }

  catForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = catName.value.trim();
    if (!name) {
      catName.focus();
      return;
    }
    if (categories().some((c) => c.toLowerCase() === name.toLowerCase())) {
      toast("Esa categoría ya existe.");
      return;
    }
    state.settings.categories.push(name);
    const ok = await persistSettings();
    catForm.reset();
    renderAll();
    if (ok) toast("Categoría agregada");
  });

  catList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;

    if (btn.dataset.act === "cancel") {
      state.editingCat = null;
      renderCategories();
      return;
    }

    const cat = btn.dataset.cat;
    const count = state.products.filter((p) => p.category === cat).length;

    if (btn.dataset.act === "del") {
      if (count > 0) {
        toast(`No puedes eliminar "${cat}": tiene ${count} producto${count === 1 ? "" : "s"}.`);
        return;
      }
      if (!window.confirm(`¿Eliminar la categoría "${cat}"?`)) return;
      state.settings.categories = state.settings.categories.filter((c) => c !== cat);
      const ok = await persistSettings();
      renderAll();
      if (ok) toast("Categoría eliminada");
      return;
    }

    if (btn.dataset.act === "rename") {
      state.editingCat = cat;
      renderCategories();
    }
  });

  catList.addEventListener("submit", async (e) => {
    const form = e.target.closest(".cat-edit");
    if (!form) return;
    e.preventDefault();
    const cat = form.dataset.cat;
    const input = form.querySelector(".cat-edit-input");
    const next = (input ? input.value : "").trim();

    if (!next || next === cat) {
      state.editingCat = null;
      renderCategories();
      return;
    }
    if (categories().some((c) => c !== cat && c.toLowerCase() === next.toLowerCase())) {
      toast("Ya existe una categoría con ese nombre.");
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }

    state.settings.categories = state.settings.categories.map((c) => c === cat ? next : c);
    if (!state.settings.categories.includes(next)) state.settings.categories.push(next);
    state.products.forEach((p) => { if (p.category === cat) p.category = next; });
    const [okCatalog, okSettings] = await Promise.all([persist(), persistSettings()]);
    state.editingCat = null;
    renderAll();
    if (okCatalog && okSettings) toast("Categoría renombrada");
  });

  catList.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.closest(".cat-edit")) {
      state.editingCat = null;
      renderCategories();
    }
  });

  /* ---------- Pestaña Ajustes ---------- */
  function renderSettingsForm() {
    setWa.value = state.settings.whatsapp;
    setLow.value = String(state.settings.lowStock);
    setIg.value = state.settings.instagram;
    setTt.value = state.settings.tiktok;
  }

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const whatsapp = setWa.value.replace(/\D/g, "");
    if (whatsapp.length < 7) {
      toast("Escribe el número de WhatsApp con código de país.");
      setWa.focus();
      return;
    }
    const lowRaw = setLow.value.trim();
    const low = lowRaw === "" ? 3 : Math.floor(Number(lowRaw));
    if (!Number.isFinite(low) || low < 1) {
      toast("La alerta de stock bajo debe ser 1 o más unidades.");
      setLow.focus();
      return;
    }

    state.settings = {
      ...state.settings,
      whatsapp,
      lowStock: low,
      instagram: setIg.value.trim(),
      tiktok: setTt.value.trim()
    };
    state.whatsapp = whatsapp;
    saveSettings.disabled = true;
    try {
      const ok = await persistSettings();
      renderAll();
      if (ok) toast("Ajustes guardados");
    } finally {
      saveSettings.disabled = false;
    }
  });

  /* ---------- Pestañas ---------- */
  function activateTab(name) {
    state.activeTab = name;
    tabs.forEach((btn) => {
      const on = btn.dataset.tab === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    tabPanels.forEach((panel) => {
      const on = panel.dataset.panel === name;
      panel.hidden = !on;
      panel.classList.toggle("is-active", on);
    });
    if (name === "precios") renderPrices();
    if (name === "stock") renderStock();
    if (name === "categorias") renderCategories();
    if (name === "ajustes") renderSettingsForm();
  }

  tabsNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (btn) activateTab(btn.dataset.tab);
  });

  function renderAll() {
    renderStats();
    renderAlert();
    renderList();
    renderCategorySelect();
    renderPrices();
    renderStock();
    renderCategories();
    renderSettingsForm();
  }

  /* ---------- Exportar / importar ---------- */
  function buildCatalogFile() {
    const body = state.products.map((p) => ({
      id: p.id,
      name: p.name,
      subtitle: p.subtitle,
      category: p.category,
      price: p.price,
      stock: p.stock,
      wholesale: p.wholesale,
      tag: p.tag,
      desc: p.desc,
      images: p.images
    }));
    const settings = {
      whatsapp: state.settings.whatsapp,
      lowStock: state.settings.lowStock,
      instagram: state.settings.instagram,
      tiktok: state.settings.tiktok,
      categories: [...new Set([
        ...state.settings.categories,
        ...state.products.map((p) => p.category)
      ].filter(Boolean))]
    };
    const date = new Date().toLocaleDateString("es-MX");
    return `/* ============================================================
   CATÁLOGO DE LA TIENDA · generado el ${date} desde el panel
   ------------------------------------------------------------
   Reemplaza este archivo en assets/js/products.js.
   price: null → "Precio por confirmar" y pedido cotizado por WhatsApp.
   stock: null → sin control de stock.
   wholesale: precio por unidad desde 3, 6, 12, 20, 50 y 100 unidades.
   ============================================================ */

window.WHATSAPP_NUMBER = ${JSON.stringify(state.whatsapp || "584123897248")};

window.STORE_SETTINGS = ${JSON.stringify(settings, null, 2)};

window.PRODUCTS = ${JSON.stringify(body, null, 2)};
`;
  }

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([buildCatalogFile()], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.js";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Catálogo descargado. Reemplaza assets/js/products.js con este archivo.");
  });

  function extractBracedJson(text, anchor) {
    const at = text.indexOf(anchor);
    if (at === -1) return null;
    const start = text.indexOf("{", at + anchor.length);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          inString = false;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  function parseCatalogText(text) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("El archivo está vacío.");

    let whatsapp = state.whatsapp;
    const numberMatch = trimmed.match(/window\.WHATSAPP_NUMBER\s*=\s*(["'])(.*?)\1/);
    if (numberMatch) whatsapp = numberMatch[2].replace(/\D/g, "") || whatsapp;

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) return { products: data, whatsapp };
      if (data && Array.isArray(data.products)) {
        return {
          products: data.products,
          whatsapp: data.whatsapp ? String(data.whatsapp).replace(/\D/g, "") : whatsapp,
          settings: data.settings && typeof data.settings === "object" ? data.settings : null
        };
      }
      throw new Error("El archivo no contiene una lista de productos.");
    }

    const anchor = trimmed.indexOf("window.PRODUCTS");
    const start = trimmed.indexOf("[", anchor === -1 ? 0 : anchor);
    const end = trimmed.lastIndexOf("]");
    if (start === -1 || end <= start) {
      throw new Error("No se encontró window.PRODUCTS en el archivo.");
    }
    return {
      products: JSON.parse(trimmed.slice(start, end + 1)),
      whatsapp,
      settings: extractBracedJson(trimmed, "window.STORE_SETTINGS")
    };
  }

  importBtn.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    importFile.value = "";
    if (!file) return;

    if (!window.confirm(`Importar "${file.name}" reemplazará el catálogo actual (${state.products.length} productos). ¿Continuar?`)) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseCatalogText(text);
      const list = parsed.products.map(normalize).filter(Boolean);
      if (list.length === 0) throw new Error("No se encontraron productos válidos.");
      state.products = list;
      if (parsed.settings) {
        const incoming = normalizeSettings(parsed.settings);
        incoming.whatsapp = parsed.whatsapp || incoming.whatsapp;
        state.settings = incoming;
      } else {
        state.settings = { ...state.settings, whatsapp: parsed.whatsapp || state.settings.whatsapp };
      }
      state.whatsapp = state.settings.whatsapp;
      resetForm();
      const results = await Promise.all([persist(), persistSettings()]);
      const ok = results.every(Boolean);
      renderAll();
      if (ok) toast(`Catálogo importado: ${list.length} productos.`);
    } catch (err) {
      toast("No se pudo importar: " + (err.message || "archivo no válido."));
    }
  });

  resetBtn.addEventListener("click", async () => {
    if (SERVER_MODE) return;
    if (!window.confirm("Se descartarán los cambios guardados en este navegador y se usará el catálogo del archivo products.js. ¿Continuar?")) {
      return;
    }
    try { await Promise.all([idbDel(CATALOG_KEY), idbDel(SETTINGS_KEY)]); } catch (e) {}
    state.products = sourceProducts();
    state.settings = normalizeSettings(window.STORE_SETTINGS);
    state.whatsapp = state.settings.whatsapp;
    resetForm();
    renderAll();
    toast("Catálogo y ajustes restablecidos");
  });

  /* ---------- Credenciales ---------- */
  credsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (SERVER_MODE) return;
    const pass = newPass.value.trim();
    const pass2 = newPass2.value.trim();
    const key = newKey.value.trim();

    if (pass.length < 6 || key.length < 6) {
      toast("La contraseña y la clave deben tener al menos 6 caracteres.");
      return;
    }
    if (pass !== pass2) {
      toast("Las contraseñas no coinciden.");
      newPass2.focus();
      return;
    }
    if (!canHash) {
      toast("Este navegador no permite guardar credenciales seguras.");
      return;
    }

    try {
      const [passHash, keyHash] = await Promise.all([sha256(pass), sha256(key)]);
      localStorage.setItem(CREDS_KEY, JSON.stringify({ pass: passHash, key: keyHash }));
      credsForm.reset();
      toast("Credenciales actualizadas. Úsalas la próxima vez.");
    } catch (err) {
      toast("No se pudieron guardar las credenciales.");
    }
  });

  resetCredsBtn.addEventListener("click", () => {
    if (IS_LOCAL) {
      if (!window.confirm("Se borrarán la contraseña y la clave guardadas para que crees unas nuevas. ¿Continuar?")) return;
      try { localStorage.removeItem(CREDS_KEY); } catch (e) {}
      try { localStorage.removeItem(GUARD_KEY); } catch (e) {}
      clearSession();
      location.reload();
      return;
    }
    if (!window.confirm("Se restaurarán la contraseña y la clave originales. ¿Continuar?")) return;
    try { localStorage.removeItem(CREDS_KEY); } catch (e) {}
    credsForm.reset();
    toast("Credenciales originales restauradas.");
  });

  /* ---------- Arranque ---------- */
  startLockTicker();
  updateLockState();

  if (SERVER_MODE) {
    if (catalogHint) {
      catalogHint.innerHTML = "Los cambios se publican automáticamente en la tienda al guardar.";
    }
    if (resetBtn) resetBtn.hidden = true;
    if (credsForm) credsForm.hidden = true;
    if (credsSub) credsSub.hidden = true;
    if (serverCredsNote) serverCredsNote.hidden = false;
    window.addEventListener("online", () => {
      if (publishRetry) {
        clearTimeout(publishRetry);
        publishRetry = null;
        requestPublish();
      }
    });
    if (validSession()) unlock();
  } else if (IS_LOCAL && !hasCustomCreds()) {
    showSetup();
  } else if (validSession()) {
    unlock();
  }

  if (!canHash && !SERVER_MODE) {
    loginError.textContent = "Este navegador no permite el acceso seguro. Abre la página localmente o con HTTPS.";
  }
})();
