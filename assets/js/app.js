(function () {
  "use strict";

  /* ---------- Configuración ---------- */
  let PRODUCTS = Array.isArray(window.PRODUCTS) ? window.PRODUCTS.slice() : [];
  const PLACEHOLDER = "assets/products/placeholder.svg";
  const CART_KEY = "ia_cart_v1";
  const THEME_KEY = "ia_theme";
  const CACHE_KEY = "ia_store_cache_v1";
  const API_CATALOG = "api/catalog";
  const LIVE_MS = 12000;
  const CAN_FETCH = /^https?:$/.test(location.protocol);
  const TIERS = [3, 6, 12, 20, 50, 100];

  const localAsset = (src, dir) => {
    const m = /^assets\/products\/([^/]+)\.jpg$/i.exec(src);
    return m ? `assets/${dir}/${m[1]}.jpg` : src;
  };
  const cardImg = (src) => localAsset(src, "cards");
  const thumbImg = (src) => localAsset(src, "thumbs");
  const originalImg = (src) => String(src).replace(/^assets\/(?:cards|thumbs)\//i, "assets/products/");

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const money = (n) => "$" + Number(n).toLocaleString("es-MX");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const hasPrice = (p) => typeof p.price === "number" && p.price > 0;
  const icon = (id, cls = "") =>
    `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"></use></svg>`;

  /* ---------- Intro de bienvenida ---------- */
  (function intro() {
    const el = $("#intro");
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.remove();
      return;
    }
    document.documentElement.classList.add("intro-open");
    const finish = () => {
      el.classList.add("is-done");
      document.documentElement.classList.remove("intro-open");
      window.setTimeout(() => el.remove(), 700);
    };
    const timer = window.setTimeout(finish, 2600);
    el.addEventListener("click", () => {
      window.clearTimeout(timer);
      finish();
    }, { once: true });
  })();

  function normalizeSettings(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    return {
      whatsapp: String(data.whatsapp || window.WHATSAPP_NUMBER || "").replace(/\D/g, ""),
      lowStock: Math.max(0, Math.floor(Number(data.lowStock)) || 3),
      instagram: String(data.instagram || "").trim(),
      tiktok: String(data.tiktok || "").trim(),
      categories: Array.isArray(data.categories)
        ? data.categories.map((c) => String(c || "").trim()).filter(Boolean)
        : []
    };
  }

  let SETTINGS = normalizeSettings(window.STORE_SETTINGS);

  const wholesaleOf = (p) => (p && typeof p.wholesale === "object" && p.wholesale) || {};
  const stockOf = (p) => {
    const n = Number(p && p.stock);
    return p && p.stock !== null && p.stock !== "" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };
  const isSoldOut = (p) => stockOf(p) === 0;
  const isLowStock = (p) => {
    const stock = stockOf(p);
    return stock !== null && stock > 0 && stock <= SETTINGS.lowStock;
  };

  function tierInfo(product, qty) {
    let unit = hasPrice(product) ? product.price : null;
    let tier = null;
    TIERS.forEach((t) => {
      const value = Number(wholesaleOf(product)[t]);
      if (qty >= t && Number.isFinite(value) && value > 0) {
        unit = value;
        tier = t;
      }
    });
    return { unit, tier };
  }

  function lowestTier(product) {
    for (const t of TIERS) {
      const value = Number(wholesaleOf(product)[t]);
      if (Number.isFinite(value) && value > 0) return { tier: t, price: value };
    }
    return null;
  }

  function previousUnit(product, tier) {
    let prev = hasPrice(product) ? product.price : null;
    TIERS.forEach((t) => {
      if (t >= tier) return;
      const value = Number(wholesaleOf(product)[t]);
      if (Number.isFinite(value) && value > 0) prev = value;
    });
    return prev;
  }

  function priceBlock(product, qty) {
    const { unit, tier } = tierInfo(product, qty);
    const first = lowestTier(product);

    if (unit == null) {
      return `<span class="price price-pending">Precio por confirmar</span>${first
        ? `<span class="wholesale-hint">Al mayor ${first.tier}+: ${money(first.price)} c/u</span>`
        : ""}`;
    }

    if (tier) {
      const prev = previousUnit(product, tier);
      const old = prev != null && prev !== unit ? `<s>${money(prev)}</s> ` : "";
      return `<span class="price">${old}${money(unit)} <span class="price-unit">c/u</span></span>
        <span class="wholesale-hint is-active">Mayor ${tier}+ aplicado</span>`;
    }

    return `<span class="price">${money(unit)}</span>${first
      ? `<span class="wholesale-hint">Al mayor ${first.tier}+: ${money(first.price)} c/u</span>`
      : ""}`;
  }

  function socialUrl(value, network) {
    let url = String(value || "").trim();
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (/^(www\.)?(instagram|tiktok)\.com/i.test(url)) return "https://" + url.replace(/^https?:\/\//i, "");
    url = url.replace(/^@+/, "");
    return network === "tt" ? `https://www.tiktok.com/@${url}` : `https://instagram.com/${url}`;
  }

  /* ---------- Tema claro / oscuro ---------- */
  const themeToggle = $("#themeToggle");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const mqLight = window.matchMedia("(prefers-color-scheme: light)");

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

  if (mqLight.addEventListener) {
    mqLight.addEventListener("change", (e) => {
      let saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (err) {}
      if (!saved) applyTheme(e.matches ? "light" : "dark", false);
    });
  }

  /* ---------- Enlaces, redes y menú ---------- */
  const waGeneralMsg = "¡Hola! Quiero información sobre sus accesorios para iPhone.";
  const waBase = () => `https://wa.me/${SETTINGS.whatsapp}`;
  const waGeneral = () => `${waBase()}?text=${encodeURIComponent(waGeneralMsg)}`;

  const menuDrawer = $("#menuDrawer");
  const menuOverlay = $("#menuOverlay");
  const menuBtn = $("#menuBtn");
  const menuCats = $("#menuCats");

  function applyStoreSettings() {
    const general = waGeneral();
    ["#waFab", "#heroWa", "#menuWa", "#footWa"].forEach((sel) => {
      const el = $(sel);
      if (el) el.href = general;
    });
    const social = (sel, url, network) => {
      const a = $(sel);
      if (!a) return;
      const href = socialUrl(url, network);
      a.hidden = !href;
      if (href) a.href = href;
    };
    social("#menuIg", SETTINGS.instagram, "ig");
    social("#menuTt", SETTINGS.tiktok, "tt");
    social("#footIg", SETTINGS.instagram, "ig");
    social("#footTt", SETTINGS.tiktok, "tt");
    renderMenu();
  }

  function baseCategories() {
    return [...new Set([...SETTINGS.categories, ...PRODUCTS.map((p) => p.category)].filter(Boolean))];
  }

  function renderMenu() {
    if (!menuCats) return;
    const cats = baseCategories();
    menuCats.innerHTML = [
      `<button class="menu-cat${activeCategory === "Todos" ? " is-active" : ""}" type="button" data-cat="Todos"><span>Todos</span><span>${PRODUCTS.length}</span></button>`,
      ...cats.map((cat) => {
        const count = PRODUCTS.filter((p) => p.category === cat).length;
        return `<button class="menu-cat${activeCategory === cat ? " is-active" : ""}" type="button" data-cat="${esc(cat)}"><span>${esc(cat)}</span><span>${count}</span></button>`;
      })
    ].join("");
  }

  function openMenu() {
    hideToast();
    if (drawer.classList.contains("is-open")) closeCart();
    renderMenu();
    menuOverlay.classList.add("is-open");
    menuDrawer.classList.add("is-open");
    menuDrawer.setAttribute("aria-hidden", "false");
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
    $("#menuClose").focus({ preventScroll: true });
  }

  function closeMenu() {
    menuDrawer.classList.remove("is-open");
    menuOverlay.classList.remove("is-open");
    menuDrawer.setAttribute("aria-hidden", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
  }

  function setCategory(cat) {
    activeCategory = cat;
    renderFilters();
    renderProducts();
    renderMenu();
  }

  menuBtn.addEventListener("click", openMenu);
  $("#menuClose").addEventListener("click", closeMenu);
  menuOverlay.addEventListener("click", closeMenu);
  menuCats.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    setCategory(btn.dataset.cat);
    closeMenu();
    const target = $("#productos");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Bloqueo de zoom ---------- */
  const blockGesture = (e) => e.preventDefault();
  document.addEventListener("gesturestart", blockGesture, { passive: false });
  document.addEventListener("gesturechange", blockGesture, { passive: false });
  document.addEventListener("gestureend", blockGesture, { passive: false });

  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  /* ---------- Imágenes con relleno automático ---------- */
  function wireImg(img) {
    const fallback = () => {
      const src = img.getAttribute("src") || "";
      const original = originalImg(src);
      if (original !== src) {
        img.src = original;
        return;
      }
      if (!img.src.endsWith(PLACEHOLDER)) {
        img.src = PLACEHOLDER;
      }
    };
    img.addEventListener("error", fallback);
    if (img.complete && img.naturalWidth === 0) fallback();
  }

  /* ---------- Aparición al hacer scroll ---------- */
  const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" })
    : null;

  function observeReveal(el) {
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add("is-visible");
  }

  /* ---------- Catálogo ---------- */
  const grid = $("#productGrid");
  const filtersEl = $("#filters");
  let activeCategory = "Todos";

  const getCategories = () => ["Todos", ...baseCategories()];

  function renderFilters() {
    filtersEl.innerHTML = getCategories().map((cat) => `
      <button class="filter${cat === activeCategory ? " is-active" : ""}" type="button"
        data-cat="${esc(cat)}" aria-pressed="${cat === activeCategory}">${esc(cat)}</button>
    `).join("");
  }

  function productCard(p, i) {
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : [PLACEHOLDER];
    const img = imgs[0];
    const stock = stockOf(p);
    const sold = stock === 0;
    const low = isLowStock(p);
    const qty = cart[p.id] || 0;
    const inCart = qty > 0;
    const draft = drafts[p.id] || 0;
    const shownQty = inCart ? qty : draft;
    const atMax = stock !== null && shownQty >= stock;
    const badge = sold
      ? `<span class="stock-badge is-out">Agotado</span>`
      : low
        ? `<span class="stock-badge is-low">Últimas ${stock} unidades</span>`
        : "";
    return `
      <article class="product-card reveal" style="--d:${(i % 4) * 70}ms" data-id="${esc(p.id)}">
        <div class="product-media" data-shot="0" title="Ampliar imagen">
          <img src="${esc(cardImg(img))}" alt="${esc(p.name)}" loading="lazy" decoding="async">
          ${p.tag ? `<span class="product-tag">${esc(p.tag)}</span>` : ""}
          ${imgs.length > 1 ? `<div class="media-thumbs">${imgs.map((src, j) => `
            <button type="button" class="media-thumb${j === 0 ? " is-active" : ""}" data-shot="${j}"
              data-src="${esc(j === 0 ? cardImg(src) : src)}"
              aria-pressed="${j === 0}" aria-label="Ver foto ${j + 1} de ${imgs.length} de ${esc(p.name)}">
              <img src="${esc(j === 0 ? cardImg(src) : thumbImg(src))}" alt="" loading="lazy" decoding="async">
            </button>`).join("")}</div>` : ""}
          <span class="zoom-hint">${icon("search")}</span>
        </div>
        <div class="product-body">
          <span class="product-cat">${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          ${p.subtitle ? `<p class="product-sub">${esc(p.subtitle)}</p>` : ""}
          ${p.desc ? `<p class="product-desc">${esc(p.desc)}</p>` : ""}
          ${badge}
          <div class="product-row">
            <span class="price-block" data-price-block>${priceBlock(p, shownQty)}</span>
            <div class="card-actions">
              <div class="card-qty" role="group" aria-label="Cantidad de ${esc(p.name)}">
                <button class="card-qty-btn" type="button" data-card-dec="${esc(p.id)}"
                  aria-label="Disminuir cantidad de ${esc(p.name)}" ${shownQty <= 0 ? "disabled" : ""}>−</button>
                <span class="card-qty-num" data-card-count="${esc(p.id)}" aria-live="polite">${shownQty}</span>
                <button class="card-qty-btn" type="button" data-card-inc="${esc(p.id)}"
                  aria-label="${sold ? `${esc(p.name)} agotado` : `Aumentar cantidad de ${esc(p.name)}`}"
                  ${sold || atMax ? "disabled" : ""}>+</button>
              </div>
              <button class="card-add${inCart ? " is-remove" : ""}" type="button" data-card-add="${esc(p.id)}"
                aria-label="${inCart ? `Quitar ${esc(p.name)} del carrito` : `Agregar ${esc(p.name)} al carrito`}" ${!inCart && sold ? "disabled" : ""}>${inCart ? "Quitar" : "Agregar"}</button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function syncProductCards() {
    $$(".product-card", grid).forEach((card) => {
      const product = PRODUCTS.find((p) => p.id === card.dataset.id);
      if (!product) return;
      const qty = cart[product.id] || 0;
      const stock = stockOf(product);
      const inCart = qty > 0;
      const draft = drafts[product.id] || 0;
      const shownQty = inCart ? qty : draft;
      const priceEl = $("[data-price-block]", card);
      if (priceEl) priceEl.innerHTML = priceBlock(product, shownQty);
      const countEl = $("[data-card-count]", card);
      if (countEl) countEl.textContent = shownQty;
      const decBtn = $("[data-card-dec]", card);
      if (decBtn) decBtn.disabled = shownQty <= 0;
      const incBtn = $("[data-card-inc]", card);
      if (incBtn) incBtn.disabled = stock === 0 || (stock !== null && shownQty >= stock);
      const addBtn = $("[data-card-add]", card);
      if (addBtn) {
        addBtn.textContent = inCart ? "Quitar" : "Agregar";
        addBtn.classList.toggle("is-remove", inCart);
        addBtn.setAttribute("aria-label", inCart
          ? `Quitar ${product.name} del carrito`
          : `Agregar ${product.name} al carrito`);
        addBtn.disabled = !inCart && stock === 0;
      }
    });
  }

  function renderProducts() {
    const list = activeCategory === "Todos"
      ? PRODUCTS
      : PRODUCTS.filter((p) => p.category === activeCategory);

    grid.innerHTML = list.map(productCard).join("");

    $$(".product-media img", grid).forEach(wireImg);

    $$(".product-card", grid).forEach((card) => {
      observeReveal(card);
      const media = $(".product-media", card);
      const mainImg = media.querySelector("img");
      const thumbs = $$(".media-thumb", media);
      const showShot = (shot) => {
        if (!mainImg || !thumbs[shot]) return;
        const src = thumbs[shot].dataset.src || thumbs[shot].querySelector("img").getAttribute("src");
        media.dataset.shot = String(shot);
        mainImg.src = src;
        thumbs.forEach((t, j) => {
          t.classList.toggle("is-active", j === shot);
          t.setAttribute("aria-pressed", String(j === shot));
        });
      };
      thumbs.forEach((thumb) => {
        thumb.addEventListener("click", (e) => {
          e.stopPropagation();
          showShot(Number(thumb.dataset.shot));
        });
      });
      media.addEventListener("click", () => {
        openLightbox(card.dataset.id, Number(media.dataset.shot || 0));
      });
    });
  }

  grid.addEventListener("click", (e) => {
    const add = e.target.closest("[data-card-add]");
    if (add) {
      const id = add.dataset.cardAdd;
      if (cart[id] > 0) removeFromCard(id);
      else addSelectedToCart(id);
      return;
    }
    const inc = e.target.closest("[data-card-inc]");
    if (inc) {
      const id = inc.dataset.cardInc;
      if (cart[id] > 0) addToCart(id);
      else increaseDraft(id);
      return;
    }
    const dec = e.target.closest("[data-card-dec]");
    if (dec) {
      const id = dec.dataset.cardDec;
      if (cart[id] > 0) decrementFromCard(id);
      else decreaseDraft(id);
    }
  });

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (!btn || btn.dataset.cat === activeCategory) return;
    activeCategory = btn.dataset.cat;
    $$(".filter", filtersEl).forEach((b) => {
      const on = b.dataset.cat === activeCategory;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    renderProducts();
  });

  /* ---------- Carrito ---------- */
  const drawer = $("#cartDrawer");
  const overlay = $("#overlay");
  const cartItemsEl = $("#cartItems");
  const cartEmptyEl = $("#cartEmpty");
  const cartFootEl = $("#cartFoot");
  const cartTotalEl = $("#cartTotal");
  const cartHeadCountEl = $("#cartHeadCount");
  const cartCountEl = $("#cartCount");
  const checkoutBtn = $("#checkoutBtn");
  const cartFab = $("#cartFab");

  let cart = {};
  try {
    cart = JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch (e) { cart = {}; }
  let drafts = {};

  /* ---------- Pago y entrega ---------- */
  const DELIVERY_KEY = "ia_delivery_v1";
  const PAYMENT_KEY = "ia_payment_v1";
  const VE = window.VENEZUELA && typeof window.VENEZUELA === "object" ? window.VENEZUELA : {};
  const hasVenezuela = Object.keys(VE).length > 0;

  const DELIVERY_METHODS = [
    { id: "mrw", label: "Envío por MRW", shipping: true },
    { id: "zoom", label: "Envío por Zoom", shipping: true },
    { id: "personal", label: "Entrega personal en Valencia, Carabobo", shipping: false },
  ];
  const PAYMENT_METHODS = [
    { id: "divisas", label: "Divisas", personalOnly: true },
    { id: "pago-movil", label: "Pago Móvil" },
    { id: "binance", label: "Binance" },
    { id: "efectivo", label: "Efectivo", personalOnly: true },
  ];

  const cartFormEl = $("#cartForm");
  const payTab = $("#payTab");
  const payValueEl = $("#payValue");
  const payErrorEl = $("#payError");
  const methodTab = $("#methodTab");
  const methodValueEl = $("#methodValue");
  const methodErrorEl = $("#methodError");
  const locationTabs = $("#locationTabs");
  const locationErrorEl = $("#locationError");
  const nameInput = $("#nameInput");
  const cedulaInput = $("#cedulaInput");
  const phoneInput = $("#phoneInput");
  const nameErrorEl = $("#nameError");
  const cedulaErrorEl = $("#cedulaError");
  const phoneErrorEl = $("#phoneError");
  const agencyField = $("#agencyField");
  const agencyInput = $("#agencyInput");
  const agencyErrorEl = $("#agencyError");
  const stateTab = $("#stateTab");
  const muniTab = $("#muniTab");
  const stateValueEl = $("#stateValue");
  const muniValueEl = $("#muniValue");
  const picker = $("#picker");
  const pickerList = $("#pickerList");
  const pickerTitle = $("#pickerTitle");
  const pickerKicker = $("#pickerKicker");
  const pickerBack = $("#pickerBack");

  function formatCedula(value) {
    const raw = String(value || "").toUpperCase();
    const first = raw.replace(/\s/g, "").charAt(0);
    if (!first) return "";
    let prefix = first === "E" ? "E" : "V";
    const digits = raw.replace(/\D/g, "").slice(0, 9);
    if (digits) return `${prefix}-${digits}`;
    return first === "V" || first === "E" ? prefix : "";
  }

  const sanitizeName = (value) =>
    String(value || "").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]/g, "");
  const sanitizePhone = (value) =>
    String(value || "").replace(/[^\d+\s-]/g, "").replace(/(?!^)\+/g, "");
  const phoneValid = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return (digits.length === 11 && digits.startsWith("0")) ||
      (digits.length === 10 && digits.startsWith("4")) ||
      (digits.length === 12 && digits.startsWith("58"));
  };

  const delivery = { state: "", municipality: "", method: "", name: "", cedula: "", phone: "", agency: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(DELIVERY_KEY)) || {};
    ["state", "municipality", "method", "name", "cedula", "phone", "agency"].forEach((key) => {
      if (typeof saved[key] === "string") delivery[key] = saved[key];
    });
  } catch (e) {}
  if (!Object.prototype.hasOwnProperty.call(VE, delivery.state)) {
    delivery.state = "";
    delivery.municipality = "";
  } else if (!VE[delivery.state].includes(delivery.municipality)) {
    delivery.municipality = "";
  }
  if (!DELIVERY_METHODS.some((m) => m.id === delivery.method)) delivery.method = "";
  delivery.name = sanitizeName(delivery.name);
  delivery.cedula = formatCedula(delivery.cedula);
  delivery.phone = sanitizePhone(delivery.phone);
  delivery.agency = String(delivery.agency || "").trim();

  let payment = "";
  try { payment = localStorage.getItem(PAYMENT_KEY) || ""; } catch (e) {}
  if (!PAYMENT_METHODS.some((m) => m.id === payment && (!m.personalOnly || delivery.method === "personal"))) {
    payment = "";
  }

  let pickerKind = null;
  let pickerTrigger = null;

  const isShipping = () => {
    const method = DELIVERY_METHODS.find((m) => m.id === delivery.method);
    return !!method && method.shipping;
  };

  function saveDelivery() {
    try { localStorage.setItem(DELIVERY_KEY, JSON.stringify(delivery)); } catch (e) {}
  }

  function savePayment() {
    try { localStorage.setItem(PAYMENT_KEY, payment); } catch (e) {}
  }

  function renderCheckout() {
    stateValueEl.textContent = delivery.state || "Seleccionar";
    stateTab.title = delivery.state;
    stateTab.classList.toggle("is-set", !!delivery.state);
    muniTab.disabled = !delivery.state;
    muniValueEl.textContent = delivery.municipality || (delivery.state ? "Seleccionar" : "Elige el estado");
    muniTab.title = delivery.municipality;
    muniTab.classList.toggle("is-set", !!delivery.municipality);

    const method = DELIVERY_METHODS.find((m) => m.id === delivery.method);
    methodValueEl.textContent = method ? method.label : "Elige cómo recibir tu pedido";
    methodTab.title = method ? method.label : "";
    methodTab.classList.toggle("is-set", !!method);

    const pay = PAYMENT_METHODS.find((m) => m.id === payment);
    payValueEl.textContent = pay ? pay.label : "Elige cómo vas a pagar";
    payTab.title = pay ? pay.label : "";
    payTab.classList.toggle("is-set", !!pay);

    locationTabs.hidden = !isShipping() || !hasVenezuela;
    agencyField.hidden = !isShipping();
    if (agencyField.hidden) clearError(agencyInput, agencyErrorEl);
  }

  function setError(el, errEl, message) {
    el.classList.add("is-invalid");
    el.setAttribute("aria-invalid", "true");
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  }

  function clearError(el, errEl) {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
    if (errEl) {
      errEl.textContent = "";
      errEl.hidden = true;
    }
  }

  function clearCheckoutErrors() {
    clearError(payTab, payErrorEl);
    clearError(methodTab, methodErrorEl);
    clearError(nameInput, nameErrorEl);
    clearError(cedulaInput, cedulaErrorEl);
    clearError(phoneInput, phoneErrorEl);
    clearError(agencyInput, agencyErrorEl);
    clearError(stateTab, locationErrorEl);
    clearError(muniTab, locationErrorEl);
  }

  function validateCheckout() {
    clearCheckoutErrors();
    delivery.name = nameInput.value.replace(/\s+/g, " ").trim();
    delivery.cedula = cedulaInput.value.trim();
    delivery.phone = phoneInput.value.trim();
    delivery.agency = agencyInput.value.trim();
    saveDelivery();

    const issues = [];
    const add = (el, errEl, message) => issues.push({ el, errEl, message });

    if (!payment) add(payTab, payErrorEl, "Elige cómo vas a pagar.");
    if (!delivery.method) add(methodTab, methodErrorEl, "Elige cómo recibir tu pedido.");

    const name = nameInput.value.trim();
    if (!name) add(nameInput, nameErrorEl, "Escribe tu nombre y apellido.");
    else if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(name)) add(nameInput, nameErrorEl, "Usa solo letras.");

    const cedula = cedulaInput.value.trim();
    if (!cedula) add(cedulaInput, cedulaErrorEl, "Escribe tu cédula.");
    else if (!/^[VE]-\d{6,9}$/.test(cedula)) add(cedulaInput, cedulaErrorEl, "Cédula inválida. Ej: V-12345678.");

    const phone = phoneInput.value.trim();
    if (!phone) add(phoneInput, phoneErrorEl, "Escribe tu número de teléfono.");
    else if (!phoneValid(phone)) add(phoneInput, phoneErrorEl, "Teléfono inválido. Ej: 04141234567.");

    if (isShipping()) {
      if (!delivery.agency) add(agencyInput, agencyErrorEl, "Escribe la dirección de agencia.");
      if (hasVenezuela) {
        if (!delivery.state) add(stateTab, locationErrorEl, "Elige tu estado.");
        else if (!delivery.municipality) add(muniTab, locationErrorEl, "Elige tu municipio.");
      }
    }

    issues.forEach((issue) => setError(issue.el, issue.errEl, issue.message));
    if (!issues.length) return true;

    const first = issues[0];
    toast(first.message);
    first.el.focus({ preventScroll: true });
    first.el.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }

  function bindField(input, key, sanitize, errEl) {
    input.addEventListener("input", () => {
      const clean = sanitize(input.value);
      if (clean !== input.value) input.value = clean;
      delivery[key] = input.value;
      saveDelivery();
      clearError(input, errEl);
    });
    input.addEventListener("blur", () => {
      const clean = key === "name"
        ? input.value.replace(/\s+/g, " ").trim()
        : input.value.trim();
      input.value = clean;
      delivery[key] = clean;
      saveDelivery();
    });
  }

  nameInput.value = delivery.name;
  cedulaInput.value = delivery.cedula;
  phoneInput.value = delivery.phone;
  agencyInput.value = delivery.agency;
  bindField(nameInput, "name", sanitizeName, nameErrorEl);
  bindField(cedulaInput, "cedula", formatCedula, cedulaErrorEl);
  bindField(phoneInput, "phone", sanitizePhone, phoneErrorEl);
  bindField(agencyInput, "agency", (value) => value, agencyErrorEl);

  function openPicker(kind) {
    if ((kind === "state" || kind === "muni") && (!hasVenezuela || (kind === "muni" && !delivery.state))) return;
    hideToast();
    pickerKind = kind;

    let items;
    let current;
    let title;
    let kicker;
    if (kind === "state") {
      items = Object.keys(VE).map((name) => ({ value: name, label: name }));
      current = delivery.state;
      title = "Estado donde te encuentras";
      kicker = "Entrega";
      pickerTrigger = stateTab;
    } else if (kind === "muni") {
      items = VE[delivery.state].map((name) => ({ value: name, label: name }));
      current = delivery.municipality;
      title = "Municipio";
      kicker = delivery.state;
      pickerTrigger = muniTab;
    } else if (kind === "method") {
      items = DELIVERY_METHODS.map((m) => ({ value: m.id, label: m.label }));
      current = delivery.method;
      title = "Método de entrega";
      kicker = "Entrega";
      pickerTrigger = methodTab;
    } else {
      items = PAYMENT_METHODS
        .filter((m) => !m.personalOnly || delivery.method === "personal")
        .map((m) => ({ value: m.id, label: m.label }));
      current = payment;
      title = "Método de pago";
      kicker = "Pago";
      pickerTrigger = payTab;
    }

    pickerTitle.textContent = title;
    pickerKicker.textContent = kicker;
    pickerList.innerHTML = items.map((item) => `
      <button class="picker-row${item.value === current ? " is-selected" : ""}" type="button" role="radio" aria-checked="${item.value === current}" data-value="${esc(item.value)}">
        <span class="picker-name">${esc(item.label)}</span>
        <span class="picker-radio" aria-hidden="true"></span>
      </button>`).join("");
    picker.hidden = false;
    const active = pickerList.querySelector(".is-selected");
    if (active) {
      const listRect = pickerList.getBoundingClientRect();
      const rowRect = active.getBoundingClientRect();
      pickerList.scrollTop += (rowRect.top - listRect.top) - (pickerList.clientHeight - rowRect.height) / 2;
    }
    pickerBack.focus({ preventScroll: true });
  }

  function closePicker(refocus = true) {
    if (picker.hidden) return;
    picker.hidden = true;
    pickerKind = null;
    if (refocus && pickerTrigger) pickerTrigger.focus({ preventScroll: true });
    pickerTrigger = null;
  }

  stateTab.addEventListener("click", () => openPicker("state"));
  muniTab.addEventListener("click", () => openPicker("muni"));
  methodTab.addEventListener("click", () => openPicker("method"));
  payTab.addEventListener("click", () => openPicker("pay"));
  pickerBack.addEventListener("click", () => closePicker());

  pickerList.addEventListener("click", (e) => {
    const row = e.target.closest(".picker-row");
    if (!row || !pickerKind) return;
    const kind = pickerKind;
    const value = row.dataset.value;
    let message;

    if (kind === "state") {
      if (delivery.state && delivery.state !== value) delivery.municipality = "";
      delivery.state = value;
      clearError(stateTab, locationErrorEl);
      message = `Estado: ${value}`;
    } else if (kind === "muni") {
      delivery.municipality = value;
      clearError(muniTab, locationErrorEl);
      message = `Municipio: ${value}`;
    } else if (kind === "method") {
      delivery.method = value;
      clearError(methodTab, methodErrorEl);
      const method = DELIVERY_METHODS.find((m) => m.id === value);
      const payMethod = PAYMENT_METHODS.find((m) => m.id === payment);
      if (isShipping() && payMethod && payMethod.personalOnly) {
        payment = "";
        savePayment();
        message = `${payMethod.label} no disponible para envíos`;
      } else {
        message = method.label;
      }
    } else {
      payment = value;
      savePayment();
      clearError(payTab, payErrorEl);
      message = `Pago: ${PAYMENT_METHODS.find((m) => m.id === value).label}`;
    }

    saveDelivery();
    renderCheckout();
    closePicker();
    renderCart();
    toast(message);
  });

  checkoutBtn.addEventListener("click", (e) => {
    const list = entries();
    if (!list.length) {
      e.preventDefault();
      return;
    }
    if (!validateCheckout()) {
      e.preventDefault();
      return;
    }
    checkoutBtn.href = `${waBase()}?text=${encodeURIComponent(orderMessage(list))}`;
  });

  const entries = () =>
    Object.entries(cart)
      .map(([id, qty]) => ({ product: PRODUCTS.find((p) => p.id === id), qty }))
      .filter((e) => e.product && e.qty > 0);

  const cartCount = () => entries().reduce((sum, e) => sum + e.qty, 0);
  const lineInfo = (e) => tierInfo(e.product, e.qty);
  const lineTotal = (e) => {
    const { unit } = lineInfo(e);
    return unit != null ? unit * e.qty : null;
  };
  const cartTotal = () => entries().reduce((sum, e) => sum + (lineTotal(e) || 0), 0);
  const cartAllPriced = (list) => list.length > 0 && list.every((e) => lineTotal(e) != null);

  function persistCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  function saveCart() {
    persistCart();
    renderCart();
    updateBadge();
    syncProductCards();
  }

  function cartItemTemplate(e) {
    const p = e.product;
    const { unit, tier } = lineInfo(e);
    const total = lineTotal(e);
    const unitHtml = unit == null
      ? "Precio por confirmar"
      : `${tier && hasPrice(p) ? `<s>${money(p.price)}</s> ` : ""}${money(unit)} c/u${tier ? ` <span class="tier-tag">Mayor ${tier}+</span>` : ""}`;
    return `
      <div class="cart-item">
        <img class="cart-thumb" src="${esc(cardImg((p.images && p.images[0]) || PLACEHOLDER))}" alt="${esc(p.name)}">
        <div class="cart-info">
          <p class="cart-name">${esc(p.name)}</p>
          <p class="cart-unit">${unitHtml}</p>
          <div class="qty">
            <button type="button" data-dec="${esc(p.id)}" aria-label="Quitar una unidad de ${esc(p.name)}">−</button>
            <span>${e.qty}</span>
            <button type="button" data-inc="${esc(p.id)}" aria-label="Añadir una unidad de ${esc(p.name)}">+</button>
          </div>
        </div>
        <div class="cart-side">
          <strong>${total != null ? money(total) : `<span class="cart-pending">Por cotizar</span>`}</strong>
          <button type="button" class="cart-remove" data-del="${esc(p.id)}" aria-label="Eliminar ${esc(p.name)}">
            ${icon("x")}
          </button>
        </div>
      </div>`;
  }

  function orderMessage(list) {
    const lines = list.map((e) => {
      const { unit, tier } = lineInfo(e);
      const base = `• ${e.qty} × ${e.product.name}`;
      if (unit == null) return base;
      const tierText = tier ? ` (mayor ${tier}+)` : "";
      return `${base} — ${money(unit)} c/u${tierText} — ${money(unit * e.qty)}`;
    });
    const totalLine = cartAllPriced(list)
      ? `Total: ${money(cartTotal())}`
      : "Total: por confirmar";
    let message = `¡Hola! Quiero hacer este pedido:\n\n${lines.join("\n")}\n\n${totalLine}`;

    const pay = PAYMENT_METHODS.find((m) => m.id === payment);
    if (pay) message += `\n\nPago: ${pay.label}`;

    const method = DELIVERY_METHODS.find((m) => m.id === delivery.method);
    if (method) {
      message += `\n\nEntrega: ${method.label}`;
      if (delivery.name) message += `\nNombre: ${delivery.name}`;
      if (delivery.cedula) message += `\nCédula: ${delivery.cedula}`;
      if (delivery.phone) message += `\nTeléfono: ${delivery.phone}`;
      if (method.shipping) {
        if (delivery.agency) message += `\nDirección de agencia: ${delivery.agency}`;
        if (delivery.state) message += `\nEstado: ${delivery.state}`;
        if (delivery.municipality) message += `\nMunicipio: ${delivery.municipality}`;
      }
    }
    return message;
  }

  function renderCart() {
    const list = entries();

    cartItemsEl.innerHTML = list.map(cartItemTemplate).join("");
    $$("img", cartItemsEl).forEach(wireImg);

    const empty = list.length === 0;
    cartItemsEl.hidden = empty;
    cartEmptyEl.hidden = !empty;
    cartFormEl.hidden = empty;
    cartFootEl.hidden = empty;
    cartHeadCountEl.textContent = empty ? "" : `(${cartCount()})`;
    cartTotalEl.textContent = empty ? money(0) : cartAllPriced(list) ? money(cartTotal()) : "Por cotizar";

    checkoutBtn.href = "#";
  }

  function updateBadge() {
    const n = cartCount();
    cartCountEl.textContent = n;
    cartCountEl.hidden = n === 0;
    if (n > 0) {
      cartCountEl.classList.remove("pop");
      void cartCountEl.offsetWidth;
      cartCountEl.classList.add("pop");
    }
  }

  function addToCart(id) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) return;

    const stock = stockOf(product);
    const current = cart[id] || 0;
    if (stock === 0) {
      toast(`${product.name} está agotado`);
      return;
    }
    if (stock !== null && current >= stock) {
      toast(`Solo quedan ${stock} unidades de ${product.name}`);
      return;
    }

    const beforeTier = tierInfo(product, current).tier;
    cart[id] = current + 1;
    const after = tierInfo(product, cart[id]);
    saveCart();
    toast(after.tier && after.tier !== beforeTier
      ? `Mayor ${after.tier}+: ${money(after.unit)} c/u`
      : `${product.name} agregado al carrito`);

    cartFab.classList.remove("bump");
    void cartFab.offsetWidth;
    cartFab.classList.add("bump");
  }

  function removeFromCard(id) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!cart[id]) return;
    delete cart[id];
    drafts[id] = 0;
    saveCart();
    if (product) toast(`${product.name} eliminado del carrito`);
  }

  function increaseDraft(id) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) return;
    const stock = stockOf(product);
    const current = drafts[id] || 0;
    if (stock === 0) return;
    if (stock !== null && current >= stock) {
      toast(`Solo quedan ${stock} unidades de ${product.name}`);
      return;
    }
    drafts[id] = current + 1;
    syncProductCards();
  }

  function decreaseDraft(id) {
    if (!drafts[id]) return;
    drafts[id] -= 1;
    syncProductCards();
  }

  function addSelectedToCart(id) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) return;
    const stock = stockOf(product);
    if (stock === 0) {
      toast(`${product.name} está agotado`);
      return;
    }
    const wanted = Math.max(1, drafts[id] || 0);
    const qty = stock !== null ? Math.min(wanted, stock) : wanted;
    const beforeTier = tierInfo(product, 0).tier;
    cart[id] = qty;
    drafts[id] = 0;
    const after = tierInfo(product, qty);
    saveCart();
    toast(after.tier && after.tier !== beforeTier
      ? `${qty} × ${product.name} · Mayor ${after.tier}+: ${money(after.unit)} c/u`
      : `${qty} × ${product.name} agregado al carrito`);

    cartFab.classList.remove("bump");
    void cartFab.offsetWidth;
    cartFab.classList.add("bump");
  }

  function decrementFromCard(id) {
    const current = cart[id] || 0;
    if (current <= 0) return;
    if (current === 1) {
      delete cart[id];
      drafts[id] = 0;
    } else {
      cart[id] = current - 1;
    }
    saveCart();
  }

  cartItemsEl.addEventListener("click", (e) => {
    const inc = e.target.closest("[data-inc]");
    const dec = e.target.closest("[data-dec]");
    const del = e.target.closest("[data-del]");

    if (inc) {
      const id = inc.dataset.inc;
      const product = PRODUCTS.find((p) => p.id === id);
      const stock = stockOf(product);
      const next = (cart[id] || 0) + 1;
      if (product && stock !== null && next > stock) {
        toast(`Solo quedan ${stock} unidades de ${product.name}`);
        return;
      }
      cart[id] = next;
      saveCart();
    } else if (dec) {
      const id = dec.dataset.dec;
      cart[id] = (cart[id] || 0) - 1;
      if (cart[id] <= 0) {
        delete cart[id];
        drafts[id] = 0;
      }
      saveCart();
    } else if (del) {
      const id = del.dataset.del;
      delete cart[id];
      drafts[id] = 0;
      saveCart();
    }
  });

  $("#clearCart").addEventListener("click", () => {
    if (entries().length === 0) return;
    cart = {};
    drafts = {};
    saveCart();
    toast("Carrito vaciado");
  });

  cartFab.addEventListener("click", openCart);
  $("#cartClose").addEventListener("click", closeCart);
  overlay.addEventListener("click", closeCart);

  function openCart() {
    hideToast();
    closePicker(false);
    if (menuDrawer.classList.contains("is-open")) closeMenu();
    renderCart();
    overlay.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    $("#cartClose").focus({ preventScroll: true });
  }

  function closeCart() {
    closePicker(false);
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    cartFab.focus({ preventScroll: true });
  }

  $("#cartEmptyCta").addEventListener("click", () => {
    closeCart();
    const target = $("#productos");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Toast ---------- */
  const toastEl = $("#toast");
  let toastTimer;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function hideToast() {
    toastEl.classList.remove("show");
    clearTimeout(toastTimer);
  }

  /* ---------- Lightbox ---------- */
  const lightbox = $("#lightbox");
  const lbImg = $("#lbImg");
  const lbCaption = $("#lbCaption");
  let lbImages = [PLACEHOLDER];
  let lbShot = 0;
  let lbName = "";
  let lbPrice = null;
  let lbProductId = null;

  function openLightbox(productId, shot = 0) {
    const product = PRODUCTS.find((p) => p.id === productId);
    lbProductId = product ? productId : null;
    lbImages = product && Array.isArray(product.images) && product.images.length
      ? product.images.slice()
      : [PLACEHOLDER];
    lbShot = Math.min(Math.max(0, Math.floor(shot) || 0), lbImages.length - 1);
    lbName = product ? product.name : "";
    lbPrice = product && hasPrice(product) ? product.price : null;
    paintLightbox();
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    $("#lbClose").focus({ preventScroll: true });
  }

  function closeLightbox() {
    lbProductId = null;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
  }

  function paintLightbox() {
    lbImg.onerror = () => {
      lbImg.onerror = null;
      lbImg.src = PLACEHOLDER;
    };
    lbImg.src = lbImages[lbShot] || PLACEHOLDER;
    lbImg.alt = lbName;
    const bits = [lbName];
    if (lbPrice != null) bits.push(money(lbPrice));
    if (lbImages.length > 1) bits.push(`Foto ${lbShot + 1} de ${lbImages.length}`);
    lbCaption.textContent = bits.filter(Boolean).join(" · ");
    $("#lbPrev").hidden = lbImages.length < 2;
    $("#lbNext").hidden = lbImages.length < 2;
  }

  function stepLightbox(dir) {
    if (lbImages.length < 2) return;
    lbShot = (lbShot + dir + lbImages.length) % lbImages.length;
    paintLightbox();
  }

  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lbPrev").addEventListener("click", () => stepLightbox(-1));
  $("#lbNext").addEventListener("click", () => stepLightbox(1));
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  /* ---------- Teclado ---------- */
  document.addEventListener("keydown", (e) => {
    const key = e.key;

    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(key)) {
      e.preventDefault();
    }

    if (key === "Escape") {
      if (!picker.hidden) closePicker();
      else if (lightbox.classList.contains("is-open")) closeLightbox();
      else if (menuDrawer.classList.contains("is-open")) closeMenu();
      else if (drawer.classList.contains("is-open")) closeCart();
    }

    if (lightbox.classList.contains("is-open")) {
      if (key === "ArrowLeft") stepLightbox(-1);
      if (key === "ArrowRight") stepLightbox(1);
    }
  }, { passive: false });

  /* ---------- Catálogo administrado (IndexedDB, solo vista local) ---------- */
  async function loadLocalStore() {
    if (!("indexedDB" in window)) return null;
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("ia-admin", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const read = (key) => new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get(key);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
      const [catalog, settings] = await Promise.all([read("catalog"), read("settings")]);
      db.close();
      return { catalog, settings };
    } catch (e) {
      return null;
    }
  }

  /* ---------- Catálogo publicado en vivo ---------- */
  let remoteVersion = null;
  let remoteBusy = null;
  let liveTimer = null;

  function normalizeRemoteProduct(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = String(raw.name || "").trim();
    if (!name) return null;
    let stock = null;
    if (raw.stock !== null && raw.stock !== undefined && raw.stock !== "") {
      const n = Number(raw.stock);
      stock = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
    }
    return {
      id: String(raw.id || name),
      name,
      subtitle: raw.subtitle ? String(raw.subtitle) : "",
      category: String(raw.category || "Otros"),
      price: typeof raw.price === "number" && raw.price > 0 ? raw.price : null,
      stock,
      wholesale: raw.wholesale && typeof raw.wholesale === "object" ? raw.wholesale : {},
      tag: raw.tag ? String(raw.tag) : "",
      desc: raw.desc ? String(raw.desc) : "",
      images: Array.isArray(raw.images) ? raw.images.filter((src) => typeof src === "string" && src) : []
    };
  }

  function reconcileCart() {
    let changed = false;
    Object.keys(cart).forEach((id) => {
      const product = PRODUCTS.find((p) => p.id === id);
      const stock = product ? stockOf(product) : null;
      if (!product || stock === 0) {
        delete cart[id];
        changed = true;
        return;
      }
      if (stock !== null && cart[id] > stock) {
        cart[id] = stock;
        changed = true;
      }
      if (!(cart[id] > 0)) {
        delete cart[id];
        changed = true;
      }
    });
    if (changed) persistCart();
  }

  function applyRemoteData(data) {
    SETTINGS = normalizeSettings(data.settings);
    PRODUCTS = (Array.isArray(data.products) ? data.products : [])
      .map(normalizeRemoteProduct)
      .filter(Boolean);
    remoteVersion = Number(data.version) || 0;
    if (!getCategories().includes(activeCategory)) activeCategory = "Todos";
    reconcileCart();
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        version: remoteVersion,
        updatedAt: data.updatedAt || "",
        settings: SETTINGS,
        products: PRODUCTS
      }));
    } catch (e) {}
  }

  function readCachedStore() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && Array.isArray(data.products) ? data : null;
    } catch (e) {
      return null;
    }
  }

  function refreshLightbox() {
    if (!lbProductId || !lightbox.classList.contains("is-open")) return;
    const product = PRODUCTS.find((p) => p.id === lbProductId);
    if (!product) {
      closeLightbox();
      return;
    }
    lbImages = Array.isArray(product.images) && product.images.length ? product.images.slice() : [PLACEHOLDER];
    lbShot = Math.min(Math.max(0, lbShot), lbImages.length - 1);
    lbName = product.name;
    lbPrice = hasPrice(product) ? product.price : null;
    paintLightbox();
  }

  function renderRemoteView() {
    applyStoreSettings();
    renderFilters();
    renderProducts();
    renderCart();
    updateBadge();
    refreshLightbox();
  }

  async function loadRemoteStore() {
    if (!CAN_FETCH) return false;
    if (remoteBusy) return remoteBusy;
    remoteBusy = (async () => {
      try {
        const query = remoteVersion != null
          ? `?v=${encodeURIComponent(remoteVersion)}`
          : `?_=${Date.now()}`;
        const res = await fetch(API_CATALOG + query, {
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (!data || data.unchanged || !Array.isArray(data.products)) return false;
        if (remoteVersion === (Number(data.version) || 0)) return false;
        applyRemoteData(data);
        return true;
      } catch (e) {
        return false;
      } finally {
        remoteBusy = null;
      }
    })();
    return remoteBusy;
  }

  function startLiveSync() {
    if (!CAN_FETCH || liveTimer) return;
    const pull = () => {
      if (document.visibilityState === "hidden") return;
      loadRemoteStore().then((changed) => {
        if (changed) renderRemoteView();
      });
    };
    liveTimer = setInterval(pull, LIVE_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") pull();
    });
    window.addEventListener("focus", pull);
    window.addEventListener("online", pull);
  }

  /* ---------- Arranque ---------- */
  if (CAN_FETCH) {
    const cached = readCachedStore();
    if (cached) applyRemoteData(cached);
  }

  applyStoreSettings();
  renderFilters();
  renderProducts();
  renderCheckout();
  renderCart();
  updateBadge();

  $$(".reveal").forEach((el) => observeReveal(el));

  if (CAN_FETCH) {
    loadRemoteStore().then((changed) => {
      if (changed) renderRemoteView();
    });
    startLiveSync();
  } else {
    loadLocalStore().then((data) => {
      if (!data) return;
      if (data.settings) SETTINGS = normalizeSettings(data.settings);
      if (Array.isArray(data.catalog)) PRODUCTS = data.catalog;
      applyStoreSettings();
      if (!getCategories().includes(activeCategory)) activeCategory = "Todos";
      renderFilters();
      renderProducts();
      renderCart();
      updateBadge();
    });
  }
})();
