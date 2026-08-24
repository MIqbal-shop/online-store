(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const TILE_COLORS = ['tile-amber', 'tile-coral', 'tile-crimson'];

  let token = localStorage.getItem('customer_token') || '';
  let customer = null;
  let products = [];
  let cart = {}; // product_id -> { product, qty }
  let signupType = null; // 'new' | 'old'

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { headers, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ---- Store branding (shown on both the auth gate and the shop) ----
  async function loadStoreInfo() {
    try {
      const data = await fetch('/api/store-info').then((r) => r.json());
      const store = data.store || {};
      const initials = (store.store_name || 'IT').trim().slice(0, 2).toUpperCase();
      for (const nameEl of [$('brandName'), $('sidebarBrand')]) nameEl.textContent = store.store_name || 'IQBAL TRADER';
      $('authName').textContent = store.store_name || 'IQBAL TRADER';
      if (store.tagline) $('brandTag').textContent = store.tagline;
      document.title = store.store_name || 'Online Order';
      for (const markEl of [$('brandMark'), $('authMark')]) {
        if (store.logo_image) {
          markEl.innerHTML = `<img src="${store.logo_image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
        } else {
          markEl.textContent = initials;
        }
      }
    } catch (e) { console.error(e); }
  }

  // ---- 3D tilt effect for product tiles ----
  function attachTilt(el) {
    const strength = 10;
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `rotateY(${x * strength}deg) rotateX(${-y * strength}deg) translateZ(0)`;
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'rotateY(0deg) rotateX(0deg)';
    });
  }

  // ---- Auth gate ----
  function showAuthGate() {
    $('authGate').style.display = 'flex';
    $('shopRoot').style.display = 'none';
  }
  function showShop() {
    $('authGate').style.display = 'none';
    $('shopRoot').style.display = 'block';
    loadProducts();
  }

  $('tabLogin').addEventListener('click', () => {
    $('tabLogin').classList.add('active'); $('tabSignup').classList.remove('active');
    $('loginForm').style.display = 'block'; $('signupForm').style.display = 'none';
  });
  $('tabSignup').addEventListener('click', () => {
    $('tabSignup').classList.add('active'); $('tabLogin').classList.remove('active');
    $('signupForm').style.display = 'block'; $('loginForm').style.display = 'none';
  });

  // ---- Sidebar (Account / Cart) ----
  function openSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarOverlay').style.display = 'block';
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').style.display = 'none';
  }
  $('menuBtn').addEventListener('click', openSidebar);
  $('closeSidebar').addEventListener('click', closeSidebar);
  $('sidebarOverlay').addEventListener('click', closeSidebar);

  $('typeOldBtn').addEventListener('click', () => selectSignupType('old'));
  $('typeNewBtn').addEventListener('click', () => selectSignupType('new'));
  function selectSignupType(type) {
    signupType = type;
    $('typeOldBtn').classList.toggle('active', type === 'old');
    $('typeNewBtn').classList.toggle('active', type === 'new');
    $('newOnlyFields').style.display = type === 'new' ? 'block' : 'none';
  }

  // ---- Forgot password ----
  $('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    $('f_whatsapp').value = $('l_whatsapp').value.trim();
    $('forgotError').style.display = 'none';
    $('forgotMsg').style.display = 'none';
    $('forgotOverlay').style.display = 'flex';
  });
  $('closeForgot').addEventListener('click', () => $('forgotOverlay').style.display = 'none');
  $('forgotOverlay').addEventListener('click', (e) => { if (e.target.id === 'forgotOverlay') $('forgotOverlay').style.display = 'none'; });

  $('forgotSubmitBtn').addEventListener('click', async () => {
    const errEl = $('forgotError');
    const msgEl = $('forgotMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const whatsapp = $('f_whatsapp').value.trim();
    if (!whatsapp) { errEl.textContent = 'Please enter your WhatsApp number.'; errEl.style.display = 'block'; return; }
    const btn = $('forgotSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const data = await api('/api/customers/forgot-password', { method: 'POST', body: JSON.stringify({ whatsapp }) });
      msgEl.textContent = data.message || 'If this WhatsApp number has an account, a new password has been sent to it.';
      msgEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send new password';
    }
  });

  $('loginBtn').addEventListener('click', async () => {
    const errEl = $('loginError');
    errEl.style.display = 'none';
    const whatsapp = $('l_whatsapp').value.trim();
    const password = $('l_password').value;
    if (!whatsapp || !password) { errEl.textContent = 'Please enter your WhatsApp number and password.'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/customers/login', { method: 'POST', body: JSON.stringify({ whatsapp, password }) });
      token = data.token;
      customer = data.customer;
      localStorage.setItem('customer_token', token);
      showShop();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  $('signupBtn').addEventListener('click', async () => {
    const errEl = $('signupError');
    errEl.style.display = 'none';
    if (!signupType) { errEl.textContent = 'Please select whether you are a new or existing customer.'; errEl.style.display = 'block'; return; }
    const name = $('s_name').value.trim();
    const whatsapp = $('s_whatsapp').value.trim();
    const shop_name = $('s_shop').value.trim();
    const phone = $('s_phone').value.trim();
    const address = $('s_address').value.trim();
    const password = $('s_password').value;

    if (!name) { errEl.textContent = 'Please enter your name.'; errEl.style.display = 'block'; return; }
    if (!whatsapp) { errEl.textContent = 'Please enter your WhatsApp number.'; errEl.style.display = 'block'; return; }
    if (!password || password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    if (signupType === 'new' && (!shop_name || !phone || !address)) {
      errEl.textContent = 'Shop name, phone number, and address are required.';
      errEl.style.display = 'block';
      return;
    }
    try {
      const data = await api('/api/customers/signup', {
        method: 'POST',
        body: JSON.stringify({ customer_type: signupType, name, whatsapp, shop_name, phone, address, password }),
      });
      token = data.token;
      customer = data.customer;
      localStorage.setItem('customer_token', token);
      showShop();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  // ---- Products ----
  let selectedUnit = {}; // product_id -> 'carton' | 'box' | 'piece' | 'single'

  async function loadProducts() {
    try {
      const data = await fetch('/api/products').then((r) => r.json());
      products = data.products || [];
      renderProducts();
    } catch (e) { console.error(e); }
  }

  // Returns the list of buyable options for a product - one for 'single'
  // products, two or three for carton/box/piece ones.
  function unitOptions(p) {
    if (p.packing_type === 'carton_box_piece') {
      return [
        { key: 'carton', label: 'Carton', price: Number(p.price_carton) },
        { key: 'box', label: 'Box', price: Number(p.price_box) },
        { key: 'piece', label: 'Piece', price: Number(p.price_piece) },
      ];
    }
    if (p.packing_type === 'carton_piece') {
      return [
        { key: 'carton', label: 'Carton', price: Number(p.price_carton) },
        { key: 'piece', label: 'Piece', price: Number(p.price_piece) },
      ];
    }
    return [{ key: 'single', label: p.unit, price: Number(p.price) }];
  }

  function cartKey(productId, unitKey) { return productId + '::' + unitKey; }

  function renderProducts() {
    const grid = $('productGrid');
    grid.innerHTML = '';
    $('emptyMsg').style.display = products.length ? 'none' : 'block';
    products.forEach((p, i) => {
      const options = unitOptions(p);
      const which = selectedUnit[p.id] || options[0].key;
      const info = options.find((o) => o.key === which) || options[0];
      const qty = cart[cartKey(p.id, info.key)]?.qty || 0;

      const wrap = document.createElement('div');
      wrap.className = 'tile-wrap';
      const tile = document.createElement('div');
      tile.className = 'product-tile ' + TILE_COLORS[i % TILE_COLORS.length];
      tile.innerHTML = `
        <div class="product-name">${escapeHtml(p.name)}</div>
        ${p.description ? `<div class="product-desc">${escapeHtml(p.description)}</div>` : ''}
        <div class="product-img-box">${p.image ? `<img src="${p.image}" alt="${escapeHtml(p.name)}" />` : `<div class="product-img-placeholder">No image</div>`}</div>
        ${options.length > 1 ? `
          <div class="unit-toggle">
            ${options.map((o) => `<button class="unit-opt ${o.key === which ? 'active' : ''}" data-unit="${o.key}">${escapeHtml(o.label)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="product-price">${money(info.price)} <span class="unit">${info.label ? '/ ' + escapeHtml(info.label) : ''}</span></div>
        <div class="qty-row">
          <button class="qty-btn minus">-</button>
          <span class="qty-val">${qty}</span>
          <button class="qty-btn plus">+</button>
        </div>
      `;
      if (options.length > 1) {
        tile.querySelectorAll('.unit-opt').forEach((btn) => {
          btn.addEventListener('click', () => {
            selectedUnit[p.id] = btn.dataset.unit;
            renderProducts();
          });
        });
      }
      tile.querySelector('.minus').addEventListener('click', () => changeQty(p, info, -1));
      tile.querySelector('.plus').addEventListener('click', () => changeQty(p, info, 1));
      attachTilt(tile);
      wrap.appendChild(tile);
      grid.appendChild(wrap);
    });
  }

  function changeQty(product, info, delta) {
    const key = cartKey(product.id, info.key);
    const current = cart[key]?.qty || 0;
    const next = Math.max(0, current + delta);
    if (next === 0) delete cart[key];
    else cart[key] = { product, unitKey: info.key, unitLabel: info.label, price: info.price, qty: next };
    renderProducts();
    if ($('cartOverlay').style.display === 'flex') renderCart();
    updateCartCount();
  }

  function cartTotal() {
    return Object.values(cart).reduce((s, l) => s + l.qty * (l.price || 0), 0);
  }

  function updateCartCount() {
    const count = Object.values(cart).reduce((s, l) => s + l.qty, 0);
    $('cartCount').textContent = count;

    const bar = $('stickyCartBar');
    if (count > 0) {
      $('stickyCartCount').textContent = count + (count === 1 ? ' item' : ' items');
      $('stickyCartTotal').textContent = money(cartTotal());
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  }

  // ---- Cart drawer ----
  function openCart() { renderCart(); $('cartOverlay').style.display = 'flex'; }
  $('cartBtn').addEventListener('click', () => { closeSidebar(); openCart(); });
  $('stickyCartBtn').addEventListener('click', openCart);
  $('closeCart').addEventListener('click', () => $('cartOverlay').style.display = 'none');
  $('cartOverlay').addEventListener('click', (e) => { if (e.target.id === 'cartOverlay') $('cartOverlay').style.display = 'none'; });

  function renderCart() {
    const lines = Object.values(cart);
    const box = $('cartLines');
    box.innerHTML = '';
    $('cartEmptyNote').style.display = lines.length ? 'none' : 'block';
    $('cartTotalRow').style.display = lines.length ? 'flex' : 'none';
    for (const l of lines) {
      const info = { key: l.unitKey, label: l.unitLabel, price: l.price };
      const row = document.createElement('div');
      row.className = 'cart-line';
      row.innerHTML = `
        <div>
          <div class="name">${escapeHtml(l.product.name)} ${l.unitLabel ? `<span class="sub">(${escapeHtml(l.unitLabel)})</span>` : ''}</div>
          <div class="sub">${l.qty} x ${money(l.price)}</div>
        </div>
        <div class="qty-row" style="margin-top:0;">
          <button class="qty-btn minus">-</button>
          <span class="qty-val">${l.qty}</span>
          <button class="qty-btn plus">+</button>
        </div>
      `;
      row.querySelector('.minus').addEventListener('click', () => changeQty(l.product, info, -1));
      row.querySelector('.plus').addEventListener('click', () => changeQty(l.product, info, 1));
      box.appendChild(row);
    }
    $('cartTotal').textContent = money(cartTotal());
  }

  // ---- Checkout (review saved profile, then place order) ----
  $('checkoutBtn').addEventListener('click', () => {
    if (Object.keys(cart).length === 0) return;
    $('cartOverlay').style.display = 'none';
    renderCheckoutProfile();
    $('checkoutOverlay').style.display = 'flex';
  });
  $('closeCheckout').addEventListener('click', () => $('checkoutOverlay').style.display = 'none');
  $('checkoutOverlay').addEventListener('click', (e) => { if (e.target.id === 'checkoutOverlay') $('checkoutOverlay').style.display = 'none'; });

  function renderCheckoutProfile() {
    const box = $('checkoutProfileBox');
    box.innerHTML = `
      <div class="profile-row"><span>Name</span><span>${escapeHtml(customer.name)}</span></div>
      ${customer.shop_name ? `<div class="profile-row"><span>Shop</span><span>${escapeHtml(customer.shop_name)}</span></div>` : ''}
      <div class="profile-row"><span>WhatsApp</span><span>${escapeHtml(customer.whatsapp)}</span></div>
      ${customer.address ? `<div class="profile-row"><span>Address</span><span>${escapeHtml(customer.address)}</span></div>` : ''}
      <div class="profile-row" style="border-bottom:none;"><a href="#" id="editInfoLink" style="color:var(--gold); font-weight:700;">Edit info</a></div>
    `;
    $('editInfoLink').addEventListener('click', (e) => { e.preventDefault(); $('checkoutOverlay').style.display = 'none'; openProfile(); });
  }

  $('submitOrderBtn').addEventListener('click', async () => {
    const errEl = $('checkoutError');
    errEl.style.display = 'none';
    const items = Object.values(cart).map((l) => ({ product_name: l.product.name, quantity: l.qty, unit: l.unitLabel, price: l.price }));
    const btn = $('submitOrderBtn');
    btn.disabled = true;
    btn.textContent = 'Placing order...';
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify({ items }) });
      cart = {};
      updateCartCount();
      renderProducts();
      $('checkoutOverlay').style.display = 'none';
      $('successOverlay').style.display = 'flex';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Place order';
    }
  });
  $('successCloseBtn').addEventListener('click', () => $('successOverlay').style.display = 'none');

  // ---- Profile modal ----
  $('profileBtn').addEventListener('click', () => { closeSidebar(); openProfile(); });
  $('closeProfile').addEventListener('click', () => $('profileOverlay').style.display = 'none');
  $('profileOverlay').addEventListener('click', (e) => { if (e.target.id === 'profileOverlay') $('profileOverlay').style.display = 'none'; });

  function openProfile() {
    $('p_name').value = customer.name || '';
    $('p_shop').value = customer.shop_name || '';
    $('p_phone').value = customer.phone || '';
    $('p_address').value = customer.address || '';
    $('profileError').style.display = 'none';
    $('profileMsg').style.display = 'none';
    $('profileOverlay').style.display = 'flex';
  }

  $('saveProfileBtn').addEventListener('click', async () => {
    const errEl = $('profileError');
    const msgEl = $('profileMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const name = $('p_name').value.trim();
    if (!name) { errEl.textContent = 'Please enter your name.'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/customers/me', {
        method: 'PUT',
        body: JSON.stringify({ name, shop_name: $('p_shop').value.trim(), phone: $('p_phone').value.trim(), address: $('p_address').value.trim() }),
      });
      customer = data.customer;
      msgEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/customers/logout', { method: 'POST' }); } catch {}
    token = '';
    customer = null;
    localStorage.removeItem('customer_token');
    $('profileOverlay').style.display = 'none';
    showAuthGate();
  });

  // ---- Settings (change password) ----
  $('settingsBtn').addEventListener('click', () => {
    closeSidebar();
    $('st_current').value = '';
    $('st_new').value = '';
    $('st_confirm').value = '';
    $('settingsError').style.display = 'none';
    $('settingsMsg').style.display = 'none';
    $('settingsOverlay').style.display = 'flex';
  });
  $('closeSettings').addEventListener('click', () => $('settingsOverlay').style.display = 'none');
  $('settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') $('settingsOverlay').style.display = 'none'; });

  $('saveSettingsBtn').addEventListener('click', async () => {
    const errEl = $('settingsError');
    const msgEl = $('settingsMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const current_password = $('st_current').value;
    const new_password = $('st_new').value;
    const confirm_password = $('st_confirm').value;
    if (!current_password) { errEl.textContent = 'Please enter your current password.'; errEl.style.display = 'block'; return; }
    if (!new_password || new_password.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    if (new_password !== confirm_password) { errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; return; }
    const btn = $('saveSettingsBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      await api('/api/customers/me/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) });
      msgEl.style.display = 'block';
      $('st_current').value = '';
      $('st_new').value = '';
      $('st_confirm').value = '';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Change password';
    }
  });

  // ---- Boot ----
  (async () => {
    await loadStoreInfo();
    if (token) {
      try {
        const data = await api('/api/customers/me');
        customer = data.customer;
        showShop();
        return;
      } catch (e) {
        token = '';
        localStorage.removeItem('customer_token');
      }
    }
    showAuthGate();
  })();
})();
