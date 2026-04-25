/*
  EtenRennen — shared JavaScript
  Features:
  - Menu rendering (cards)
  - Search filter
  - Add to cart
  - Cart counter in navbar
  - Cart storage using localStorage
  - Cart page quantity +/- and remove
*/

(() => {
  "use strict";

  const STORAGE_KEY = "etenrennen_cart_v1";

  // --- Demo menu data (edit freely) ---
  const MENU = [
    { id: "crash-burger", name: "Bandicoot Burger", price: 299, rating: 4.6, image: "images/food-burger.jpg", tag: "Top" },
    { id: "wumpa-wrap", name: "Wumpa Wrap", price: 189, rating: 4.4, image: "images/food-wrap.jpg", tag: "New" },
    { id: "spin-pizza", name: "Spin-Away Pizza", price: 399, rating: 4.7, image: "images/food-pizza.jpg", tag: "Hot" },
    { id: "jungle-bowl", name: "Jungle Power Bowl", price: 249, rating: 4.5, image: "images/food-bowl.jpg", tag: "Vegan" },
    { id: "tropic-tacos", name: "Tropic Tacos", price: 229, rating: 4.3, image: "images/food-tacos.jpg", tag: "Crispy" },
    { id: "lava-noodles", name: "Lava Noodles", price: 349, rating: 4.2, image: "images/food-noodles.jpg", tag: "Spicy" },
    { id: "checkpoint-fries", name: "Checkpoint Fries", price: 159, rating: 4.4, image: "images/food-fries.jpg", tag: "Snack" },
    { id: "aku-juice", name: "Aku Aku Juice", price: 149, rating: 4.1, image: "images/food-juice.jpg", tag: "Cold" }
  ];

  // --- Helpers ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function formatMoney(n) {
    const amount = Number(n);
    if (!Number.isFinite(amount)) return "₹0.00";

    // Use Indian numbering format (e.g., ₹1,23,456.78)
    // Falls back to a simple prefix if Intl isn't available.
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `₹${amount.toFixed(2)}`;
    }
  }

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  function readCart() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const cart = safeParse(raw, { items: {} });
    if (!cart || typeof cart !== "object" || !cart.items || typeof cart.items !== "object") {
      return { items: {} };
    }
    return cart;
  }

  function writeCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }

  function getCartCount(cart = readCart()) {
    return Object.values(cart.items).reduce((sum, qty) => sum + Number(qty || 0), 0);
  }

  function getCartLines(cart = readCart()) {
    // Returns [{ item, qty }] for items still present in MENU
    const byId = new Map(MENU.map(m => [m.id, m]));
    return Object.entries(cart.items)
      .map(([id, qty]) => ({ item: byId.get(id), qty: Number(qty || 0) }))
      .filter(x => x.item && x.qty > 0);
  }

  function setCartQty(id, qty) {
    const cart = readCart();
    const n = Math.max(0, Math.floor(Number(qty || 0)));
    if (n <= 0) delete cart.items[id];
    else cart.items[id] = n;
    writeCart(cart);
    updateCartCounter();
    return cart;
  }

  function addToCart(id, qty = 1) {
    const cart = readCart();
    const current = Number(cart.items[id] || 0);
    const next = Math.max(0, current + Number(qty || 0));
    cart.items[id] = next;
    writeCart(cart);
    updateCartCounter();
    return cart;
  }

  function updateCartCounter() {
    const countEl = $("#cartCount");
    if (!countEl) return;
    const count = getCartCount();
    countEl.textContent = String(count);
  }

  // --- Navbar active link + hamburger ---
  function initNav() {
    const page = document.body?.dataset?.page || "";
    $$("[data-nav]").forEach(a => {
      if (a.dataset.nav === page) a.classList.add("active");
    });

    const btn = $("#hamburgerBtn");
    const mobileNav = $("#mobileNav");
    if (btn && mobileNav) {
      btn.addEventListener("click", () => mobileNav.classList.toggle("open"));
      // Close when clicking a link
      $$("#mobileNav a").forEach(a => a.addEventListener("click", () => mobileNav.classList.remove("open")));
    }
  }

  // --- Food card templates ---
  function foodCardHTML(item, { showQuickAdd = false } = {}) {
    const tag = item.tag ? `<span class="badge"><span class="star">★</span> ${escapeHTML(item.rating)} <span style="opacity:.6">•</span> ${escapeHTML(item.tag)}</span>` :
      `<span class="badge"><span class="star">★</span> ${escapeHTML(item.rating)}</span>`;

    return `
      <article class="food-card">
        <div class="food-media">
          ${tag}
          <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)} image">
        </div>
        <div class="food-body">
          <div class="food-title">
            <h3>${escapeHTML(item.name)}</h3>
            <p class="price">${formatMoney(item.price)}</p>
          </div>
          <div class="food-meta">
            <span>Rating: <b style="color:#1f2a37">${escapeHTML(item.rating)}</b></span>
            <span>Fast delivery</span>
          </div>
          <div class="card-actions">
            <button class="btn btn-add" data-add="${escapeAttr(item.id)}" type="button">Add to Cart</button>
            ${showQuickAdd ? `<button class="btn-mini" data-add="${escapeAttr(item.id)}" data-qty="2" type="button">+2</button>` : ``}
          </div>
        </div>
      </article>
    `.trim();
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(s) {
    return escapeHTML(s).replaceAll("`", "&#096;");
  }

  // --- Menu page ---
  function renderMenuGrid(items) {
    const grid = $("#menuGrid");
    if (!grid) return;
    grid.innerHTML = items.map(i => foodCardHTML(i)).join("\n");
  }

  function initMenuPage() {
    const grid = $("#menuGrid");
    if (!grid) return;

    renderMenuGrid(MENU);

    const search = $("#foodSearch");
    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        const filtered = MENU.filter(m => m.name.toLowerCase().includes(q));
        renderMenuGrid(filtered);
      });
    }
  }

  // --- Home featured section (optional render) ---
  function initFeatured() {
    const featured = $("#featuredGrid");
    if (!featured) return;
    const picks = MENU.slice(0, 6);
    featured.innerHTML = picks.map(i => foodCardHTML(i, { showQuickAdd: true })).join("\n");
  }

  // --- Add-to-cart click delegation (works on any page) ---
  function initAddToCartClicks() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("[data-add]");
      if (!btn) return;

      const id = btn.getAttribute("data-add");
      const qtyAttr = btn.getAttribute("data-qty");
      const qty = qtyAttr ? Number(qtyAttr) : 1;
      if (!id) return;

      addToCart(id, qty);
      toast(`Added to cart! (${id.replaceAll("-", " ")})`);
    });
  }

  // --- Cart page ---
  function calcTotals(lines) {
    const subtotal = lines.reduce((sum, l) => sum + l.item.price * l.qty, 0);
    const delivery = subtotal > 0 ? 1.49 : 0;
    const discount = subtotal >= 20 ? 2.0 : 0; // simple promo
    const total = Math.max(0, subtotal + delivery - discount);
    return { subtotal, delivery, discount, total };
  }

  function renderCart() {
    const list = $("#cartList");
    const totalsEl = $("#cartTotals");
    const emptyEl = $("#cartEmpty");
    if (!list || !totalsEl) return;

    const lines = getCartLines();
    const { subtotal, delivery, discount, total } = calcTotals(lines);

    if (lines.length === 0) {
      list.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
    } else {
      if (emptyEl) emptyEl.hidden = true;
      list.innerHTML = lines.map(({ item, qty }) => `
        <div class="cart-item" data-id="${escapeAttr(item.id)}">
          <div class="cart-thumb">
            <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)} image">
          </div>
          <div class="cart-info">
            <h3>${escapeHTML(item.name)}</h3>
            <div class="line">
              <span>${formatMoney(item.price)} each</span>
              <a class="danger-link" href="#" data-remove="${escapeAttr(item.id)}">Remove</a>
            </div>
            <div class="line">
              <div class="qty">
                <button type="button" data-dec="${escapeAttr(item.id)}">−</button>
                <span aria-label="quantity">${qty}</span>
                <button type="button" data-inc="${escapeAttr(item.id)}">+</button>
              </div>
              <b>${formatMoney(item.price * qty)}</b>
            </div>
          </div>
        </div>
      `).join("\n");
    }

    totalsEl.innerHTML = `
      <div class="totals">
        <div class="row"><span>Subtotal</span><b>${formatMoney(subtotal)}</b></div>
        <div class="row"><span>Delivery</span><b>${formatMoney(delivery)}</b></div>
        <div class="row"><span>Discount</span><b>− ${formatMoney(discount)}</b></div>
        <div class="divider"></div>
        <div class="row" style="font-size:1.1rem"><span>Total</span><b>${formatMoney(total)}</b></div>
      </div>
    `.trim();

    const totalBig = $("#totalBig");
    if (totalBig) totalBig.textContent = formatMoney(total);
  }

  function initCartPage() {
    if (!$("#cartList")) return;
    renderCart();

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const inc = target.closest("[data-inc]");
      const dec = target.closest("[data-dec]");
      const rem = target.closest("[data-remove]");

      if (inc) {
        e.preventDefault();
        const id = inc.getAttribute("data-inc");
        addToCart(id, 1);
        renderCart();
      }
      if (dec) {
        e.preventDefault();
        const id = dec.getAttribute("data-dec");
        const cart = readCart();
        const next = Number(cart.items[id] || 0) - 1;
        setCartQty(id, next);
        renderCart();
      }
      if (rem) {
        e.preventDefault();
        const id = rem.getAttribute("data-remove");
        setCartQty(id, 0);
        renderCart();
      }
    });

    const checkoutBtn = $("#checkoutBtn");
    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", () => {
        const lines = getCartLines();
        if (lines.length === 0) {
          toast("Your cart is empty. Add something tasty first!");
          return;
        }
        toast("Checkpoint reached! (Demo) Checkout complete.");
        writeCart({ items: {} });
        updateCartCounter();
        renderCart();
      });
    }
  }

  // --- Simple toast (no dependency) ---
  let toastTimer = null;
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => { el.hidden = true; }, 220);
    }, 1400);
  }

  // --- Auth pages (basic demo validation) ---
  function initAuth() {
    const loginForm = $("#loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        toast("Logged in! (Demo)");
        setTimeout(() => window.location.href = "index.html", 450);
      });
    }

    const signupForm = $("#signupForm");
    if (signupForm) {
      signupForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const pass = $("#signupPassword")?.value || "";
        const confirm = $("#signupConfirm")?.value || "";
        if (pass.length < 6) {
          toast("Password should be at least 6 characters.");
          return;
        }
        if (pass !== confirm) {
          toast("Passwords do not match.");
          return;
        }
        toast("Account created! (Demo)");
        setTimeout(() => window.location.href = "login.html", 500);
      });
    }
  }

  // --- Initialize on every page ---
  function init() {
    initNav();
    initAddToCartClicks();
    updateCartCounter();
    initMenuPage();
    initFeatured();
    initCartPage();
    initAuth();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

