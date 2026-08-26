(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  let token = localStorage.getItem('admin_token') || '';
  let needsSetup = false;

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: authHeaders(), ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ---- Setup / Login ----
  async function checkSetup() {
    const data = await fetch('/api/admin/setup-status').then((r) => r.json());
    needsSetup = data.needsSetup;
    if (needsSetup) {
      $('loginTitle').textContent = 'Create Admin Account';
      $('loginSubtitle').textContent = 'First time here - set your username and password.';
      $('confirmPwField').style.display = 'block';
      $('loginSubmitBtn').textContent = 'Create Account';
    }
  }

  $('loginSubmitBtn').addEventListener('click', async () => {
    const errEl = $('loginError');
    errEl.style.display = 'none';
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;
    try {
      let data;
      if (needsSetup) {
        const confirm = $('loginPasswordConfirm').value;
        if (password !== confirm) throw new Error('Passwords do not match.');
        data = await fetch('/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(async (r) => {
          const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
        });
      } else {
        data = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(async (r) => {
          const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
        });
      }
      token = data.token;
      localStorage.setItem('admin_token', token);
      showAdmin();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    token = '';
    localStorage.removeItem('admin_token');
    location.reload();
  });

  function showAdmin() {
    $('loginWrap').style.display = 'none';
    $('adminShell').style.display = 'flex';
    loadDashboard();
    loadProducts();
    loadOrders();
    loadApiKey();
    loadStoreSettings();
  }

  // ---- Tabs ----
  document.querySelectorAll('.admin-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab[data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ['dashboard', 'products', 'orders', 'history', 'customers', 'broadcast', 'reviews', 'store', 'resets', 'account', 'settings'].forEach((t) => $('tab-' + t).style.display = t === btn.dataset.tab ? 'block' : 'none');
      if (btn.dataset.tab === 'resets') loadPasswordResets();
      if (btn.dataset.tab === 'dashboard') loadDashboard();
      if (btn.dataset.tab === 'customers') loadCustomers();
      if (btn.dataset.tab === 'history') { populateHistoryFilters(); loadHistory(); }
      if (btn.dataset.tab === 'reviews') loadReviews();
      if (btn.dataset.tab === 'orders') loadOrders();
      currentTab = btn.dataset.tab;
    });
  });
  let currentTab = 'dashboard';

  // Orders can arrive any time, so on top of refreshing whenever the Orders
  // tab is opened, also quietly re-fetch every 20s while it's the tab
  // being looked at - a plain click into the app (login) only fetches
  // once, so without this a new order sits invisible here until the admin
  // happens to leave and re-enter the tab.
  // Orders can arrive any time. While the Orders tab itself is open, fully
  // re-fetch every 20s so new orders/edits appear without the admin having
  // to leave and re-enter the tab. From any other tab, just refresh the
  // sidebar badge count every 20s so a new order is still noticeable.
  setInterval(() => {
    if (currentTab === 'orders') loadOrders();
    else api('/api/admin/orders').then((data) => updateOrdersTabBadge((data.orders || []).length)).catch(() => {});
  }, 20000);
  $('refreshOrdersBtn').addEventListener('click', loadOrders);

  // ---- Products ----
  let products = [];

  async function loadProducts() {
    try {
      const data = await api('/api/admin/products');
      products = data.products || [];
      renderProducts();
    } catch (e) { console.error(e); }
  }

function priceSummary(p) {
    if (p.packing_type === 'carton_box_piece') return `${money(p.price_carton)}/Carton &middot; ${money(p.price_box)}/Box &middot; ${money(p.price_piece)}/Piece`;
    if (p.packing_type === 'carton_piece') return `${money(p.price_carton)}/Carton &middot; ${money(p.price_piece)}/Piece`;
    return `${money(p.price)} ${p.unit ? '/ ' + escapeHtml(p.unit) : ''}`;
  }

  function renderProducts() {
    const box = $('productsList');
    box.innerHTML = '';
    if (products.length === 0) {
      box.innerHTML = '<div class="empty-note">No products yet - add one with "+ New Product".</div>';
      return;
    }
    for (const p of products) {
      const inStock = p.in_stock !== false;
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        ${p.image ? `<img class="thumb" src="${p.image}" />` : `<div class="thumb"></div>`}
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(p.name)} ${p.active ? '' : '<span class="pill-status pill-cancelled">Hidden</span>'} <span class="pill-status ${inStock ? 'pill-in' : 'pill-out'}">${inStock ? 'In stock' : 'Out of stock'}</span></div>
          <div style="font-size:12px; color:var(--ink-soft);">${priceSummary(p)} ${p.category ? '&middot; ' + escapeHtml(p.category) : ''}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn stock-toggle-btn ${inStock ? 'active-in' : ''} stock-in-btn" style="padding:8px 12px; font-size:12px;">In stock</button>
          <button class="btn stock-toggle-btn ${!inStock ? 'active-out' : ''} stock-out-btn" style="padding:8px 12px; font-size:12px;">Out of stock</button>
          <button class="btn btn-ghost edit-btn">Edit</button>
        </div>
      `;
      row.querySelector('.edit-btn').addEventListener('click', () => openProductModal(p));
      row.querySelector('.stock-in-btn').addEventListener('click', () => toggleStock(p.id, true));
      row.querySelector('.stock-out-btn').addEventListener('click', () => toggleStock(p.id, false));
      box.appendChild(row);
    }
  }

  async function toggleStock(id, in_stock) {
    try {
      await api(`/api/admin/products/${id}/stock`, { method: 'PUT', body: JSON.stringify({ in_stock }) });
      loadProducts();
    } catch (e) { alert(e.message); }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Show/Hide toggle for every password field on the page ----
  function wirePasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.closest('.pw-wrap')) return; // already wired
      const wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle-btn';
      btn.textContent = 'Show';
      btn.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? 'Show' : 'Hide';
      });
      wrap.appendChild(btn);
    });
  }
  wirePasswordToggles();

  // ---- Sidebar collapse (desktop) ----
  function applySidebarCollapsed(collapsed) {
    $('adminSide').classList.toggle('collapsed', collapsed);
    localStorage.setItem('admin_sidebar_collapsed', collapsed ? '1' : '0');
  }
  applySidebarCollapsed(localStorage.getItem('admin_sidebar_collapsed') === '1');
  $('collapseSidebarBtn').addEventListener('click', () => {
    applySidebarCollapsed(!$('adminSide').classList.contains('collapsed'));
  });

  $('newProductBtn').addEventListener('click', () => openProductModal(null));
  $('closeProductModal').addEventListener('click', () => $('productOverlay').style.display = 'none');
  $('productOverlay').addEventListener('click', (e) => { if (e.target.id === 'productOverlay') $('productOverlay').style.display = 'none'; });

  let currentImageData = null;

  function openProductModal(product) {
    $('productError').style.display = 'none';
    $('productModalTitle').textContent = product ? 'Edit Product' : 'New Product';
    $('p_id').value = product?.id || '';
    $('p_name').value = product?.name || '';
    const pt = product?.packing_type || 'single';
    $('p_packing_type').value = pt;
    $('p_unit').value = product?.unit || '';
    $('p_price').value = product?.price || '';
    $('p_price_carton').value = product?.price_carton ?? '';
    $('p_price_box').value = product?.price_box ?? '';
    $('p_price_piece').value = product?.price_piece ?? '';
    $('p_description').value = product?.description || '';
    $('p_category').value = product?.category || '';
    $('p_active').checked = product ? !!product.active : true;
    setStockToggle(product ? product.in_stock !== false : true);
    applyPackingTypeUI(pt);
    currentImageData = product?.image || null;
    if (currentImageData) { $('p_image_preview').src = currentImageData; $('p_image_preview').style.display = 'block'; }
    else { $('p_image_preview').style.display = 'none'; }
    $('p_image_file').value = '';
    $('deleteProductBtn').style.display = product ? 'inline-flex' : 'none';
    $('productOverlay').style.display = 'flex';
  }

  function applyPackingTypeUI(pt) {
    $('p_single_fields').style.display = pt === 'single' ? 'block' : 'none';
    $('p_multi_fields').style.display = pt === 'single' ? 'none' : 'block';
    $('p_box_field').style.display = pt === 'carton_box_piece' ? 'block' : 'none';
  }
  $('p_packing_type').addEventListener('change', (e) => applyPackingTypeUI(e.target.value));

  function setStockToggle(inStock) {
    $('p_in_stock').value = inStock ? 'true' : 'false';
    $('p_stock_in').classList.toggle('active-in', inStock);
    $('p_stock_out').classList.toggle('active-out', !inStock);
  }
  $('p_stock_in').addEventListener('click', () => setStockToggle(true));
  $('p_stock_out').addEventListener('click', () => setStockToggle(false));

  $('p_image_file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      currentImageData = reader.result;
      $('p_image_preview').src = currentImageData;
      $('p_image_preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  $('saveProductBtn').addEventListener('click', async () => {
    const errEl = $('productError');
    errEl.style.display = 'none';
    const id = $('p_id').value;
    const pt = $('p_packing_type').value;
    const body = {
      name: $('p_name').value.trim(),
      packing_type: pt,
      unit: $('p_unit').value.trim(),
      price: $('p_price').value,
      price_carton: $('p_price_carton').value,
      price_box: $('p_price_box').value,
      price_piece: $('p_price_piece').value,
      description: $('p_description').value.trim(),
      category: $('p_category').value.trim(),
      image: currentImageData,
      active: $('p_active').checked,
      in_stock: $('p_in_stock').value === 'true',
    };
    if (!body.name) { errEl.textContent = 'Please enter a product name.'; errEl.style.display = 'block'; return; }
    if (pt === 'single' && !body.unit) { errEl.textContent = 'Please enter a unit name.'; errEl.style.display = 'block'; return; }
    if (pt === 'carton_piece' && (body.price_carton === '' || body.price_piece === '')) {
      errEl.textContent = 'Please enter both Carton price and Piece price.'; errEl.style.display = 'block'; return;
    }
    if (pt === 'carton_box_piece' && (body.price_carton === '' || body.price_box === '' || body.price_piece === '')) {
      errEl.textContent = 'Please enter Carton, Box, and Piece prices.'; errEl.style.display = 'block'; return;
    }
    try {
      if (id) await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
      $('productOverlay').style.display = 'none';
      loadProducts();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  $('deleteProductBtn').addEventListener('click', async () => {
    const id = $('p_id').value;
    if (!id || !confirm('Delete this product?')) return;
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      $('productOverlay').style.display = 'none';
      loadProducts();
    } catch (e) { alert(e.message); }
  });

  // ---- Orders ----
  async function loadOrders() {
    try {
      const data = await api('/api/admin/orders');
      renderOrders(data.orders || []);
      updateOrdersTabBadge((data.orders || []).length);
    } catch (e) { console.error(e); }
  }

  function updateOrdersTabBadge(count) {
    const badge = $('ordersTabBadge');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  function renderOrders(orders) {
    const box = $('ordersList');
    box.innerHTML = '';
    if (orders.length === 0) {
      box.innerHTML = '<div class="empty-note">No orders yet.</div>';
      return;
    }
    for (const o of orders) {
      const itemsText = (o.items || []).map((it) => `${it.product_name} x ${it.quantity}${it.unit ? ' ' + it.unit : ''}`).join(', ');
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(o.customer_name)} <span class="pill-status pill-new">New</span></div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(o.shop_name || '')} ${o.shop_name ? '·' : ''} ${escapeHtml(o.whatsapp || '')}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(itemsText)}</div>
          ${o.note ? `<div style="font-size:12px; color:var(--gold); margin-top:4px;">Note: ${escapeHtml(o.note)}</div>` : ''}
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(o.order_date || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-navy review-btn">Review &amp; Confirm</button>
          <button class="btn btn-red cancel-btn">Cancel</button>
        </div>
      `;
      row.querySelector('.review-btn').addEventListener('click', () => openOrderReview(o));
      row.querySelector('.cancel-btn').addEventListener('click', async () => {
        if (!confirm('Cancel this order? It will also show as cancelled in the DMS.')) return;
        try { await api(`/api/admin/orders/${o.id}/cancel`, { method: 'PUT' }); loadOrders(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // ---- Order review modal (adjust quantities, then confirm) ----
  $('closeOrderReview').addEventListener('click', () => $('orderReviewOverlay').style.display = 'none');
  $('orderReviewOverlay').addEventListener('click', (e) => { if (e.target.id === 'orderReviewOverlay') $('orderReviewOverlay').style.display = 'none'; });

  let reviewingOrder = null;

  function openOrderReview(order) {
    reviewingOrder = order;
    $('orderReviewError').style.display = 'none';
    $('orderReviewNotifyBox').style.display = 'none';
    $('orderReviewItems').style.display = 'block';
    $('orderReviewConfirmBtn').style.display = 'inline-block';
    $('orderReviewCancelBtn').style.display = 'inline-block';
    $('orderReviewConfirmBtn').disabled = false;
    $('orderReviewConfirmBtn').textContent = 'Confirm Order';

    $('orderReviewCustomerBox').innerHTML = `
      <div style="font-weight:700; font-size:14.5px; color:var(--ink);">${escapeHtml(order.customer_name)}</div>
      ${order.shop_name ? escapeHtml(order.shop_name) + ' &middot; ' : ''}${escapeHtml(order.whatsapp || '')}
      ${order.note ? `<div style="color:var(--gold); margin-top:4px;">Note: ${escapeHtml(order.note)}</div>` : ''}
    `;

    const itemsBox = $('orderReviewItems');
    itemsBox.innerHTML = (order.items || []).map((it) => `
      <div class="review-item-row" data-item-id="${it.id}" data-price="${it.price}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid var(--line);">
        <div>
          <div style="font-weight:600; font-size:13px;">${escapeHtml(it.product_name)}</div>
          <div style="font-size:11.5px; color:var(--ink-soft);">Ordered: ${it.quantity} ${escapeHtml(it.unit || '')} &middot; ${money(it.price)} each</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:11px; color:var(--ink-soft); margin:0;">Give qty</label>
          <input type="number" class="review-qty-input" value="${it.quantity}" min="0" step="any" style="width:72px; padding:6px 8px;" />
        </div>
      </div>
    `).join('');
    itemsBox.querySelectorAll('.review-qty-input').forEach((inp) => inp.addEventListener('input', updateOrderReviewTotal));
    updateOrderReviewTotal();
    $('orderReviewOverlay').style.display = 'flex';
  }

  function updateOrderReviewTotal() {
    let total = 0;
    document.querySelectorAll('#orderReviewItems .review-item-row').forEach((row) => {
      const price = Number(row.dataset.price) || 0;
      const qty = Number(row.querySelector('.review-qty-input').value) || 0;
      total += price * qty;
    });
    $('orderReviewTotal').textContent = money(total);
  }

  $('orderReviewConfirmBtn').addEventListener('click', async () => {
    if (!reviewingOrder) return;
    const errEl = $('orderReviewError');
    errEl.style.display = 'none';
    const items = [];
    document.querySelectorAll('#orderReviewItems .review-item-row').forEach((row) => {
      items.push({ id: Number(row.dataset.itemId), confirmed_quantity: row.querySelector('.review-qty-input').value });
    });
    const btn = $('orderReviewConfirmBtn');
    btn.disabled = true;
    btn.textContent = 'Confirming...';
    try {
      const data = await api(`/api/admin/orders/${reviewingOrder.id}/confirm`, { method: 'PUT', body: JSON.stringify({ items }) });
      $('orderReviewItems').style.display = 'none';
      $('orderReviewCancelBtn').style.display = 'none';
      btn.style.display = 'none';
      if (data.altered && data.whatsapp) {
        const box = $('orderReviewNotifyBox');
        const msgEl = $('orderReviewNotifyMsg');
        const linkEl = $('orderReviewNotifyBtn');
        msgEl.value = data.whatsapp.message;
        const updateLink = () => { linkEl.href = `https://wa.me/${formatWhatsAppNumber(data.whatsapp.phone)}?text=${encodeURIComponent(msgEl.value)}`; };
        updateLink();
        msgEl.oninput = updateLink;
        box.style.display = 'block';
      } else {
        $('orderReviewCustomerBox').insertAdjacentHTML('beforeend', '<div style="color:#8fd19e; margin-top:10px; font-weight:600;">Order confirmed - exactly as ordered.</div>');
      }
      loadOrders();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Confirm Order';
    }
  });

  $('orderReviewCancelBtn').addEventListener('click', async () => {
    if (!reviewingOrder) return;
    if (!confirm('Cancel this order? It will also show as cancelled in the DMS.')) return;
    try {
      await api(`/api/admin/orders/${reviewingOrder.id}/cancel`, { method: 'PUT' });
      $('orderReviewOverlay').style.display = 'none';
      loadOrders();
    } catch (e) { alert(e.message); }
  });

  // ---- Dashboard ----
  async function loadDashboard() {
    try {
      const data = await api('/api/admin/dashboard');
      const grid = $('dashGrid');
      grid.innerHTML = `
        <div class="dash-card"><div class="num">${data.pending_orders}</div><div class="label">Pending orders</div></div>
        <div class="dash-card"><div class="num">${data.confirmed_last_30d}</div><div class="label">Confirmed (30 days)</div></div>
        <div class="dash-card"><div class="num">${money(data.revenue_last_30d)}</div><div class="label">Revenue (30 days)</div></div>
        <div class="dash-card"><div class="num">${data.cancelled_last_30d}</div><div class="label">Cancelled (30 days)</div></div>
      `;
      const topBox = $('dashTopProducts');
      if (!data.top_products || data.top_products.length === 0) {
        topBox.innerHTML = '<div class="empty-note">No confirmed orders yet.</div>';
      } else {
        topBox.innerHTML = data.top_products.map((p) => `
          <div class="admin-row"><span>${escapeHtml(p.product_name)}</span><span style="color:var(--ink-soft);">${p.total_qty} sold</span></div>
        `).join('');
      }
    } catch (e) { console.error(e); }
  }

  // ---- Order History ----
  function populateHistoryFilters() {
    if ($('h_year').options.length > 0) return; // already populated
    const thisYear = new Date().getFullYear();
    let yearOptions = '<option value="">All years</option>';
    for (let y = thisYear; y >= thisYear - 4; y--) yearOptions += `<option value="${y}">${y}</option>`;
    $('h_year').innerHTML = yearOptions;
    let dayOptions = '<option value="">All days</option>';
    for (let d = 1; d <= 31; d++) dayOptions += `<option value="${d}">${d}</option>`;
    $('h_day').innerHTML = dayOptions;
  }

  $('h_filterBtn').addEventListener('click', loadHistory);

  async function loadHistory() {
    const params = new URLSearchParams();
    if ($('h_year').value) params.set('year', $('h_year').value);
    if ($('h_month').value) params.set('month', $('h_month').value);
    if ($('h_day').value) params.set('day', $('h_day').value);
    try {
      const data = await api('/api/admin/orders/history?' + params.toString());
      renderHistory(data.orders || []);
    } catch (e) { console.error(e); }
  }

  function renderHistory(orders) {
    const box = $('historyList');
    box.innerHTML = '';
    if (orders.length === 0) {
      box.innerHTML = '<div class="empty-note">No orders found for this period.</div>';
      return;
    }
    for (const o of orders) {
      const itemsText = (o.items || []).map((it) => {
        const hasAdjustment = it.confirmed_quantity != null && Number(it.confirmed_quantity) !== Number(it.quantity);
        const qtyPart = hasAdjustment ? `${it.quantity} → ${it.confirmed_quantity}` : `${it.quantity}`;
        return `${it.product_name} x ${qtyPart}${it.unit ? ' ' + it.unit : ''}`;
      }).join(', ');
      const billTotal = (o.items || []).reduce((s, it) => s + (it.confirmed_quantity != null ? Number(it.confirmed_quantity) : Number(it.quantity)) * Number(it.price), 0);
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">
            ${escapeHtml(o.customer_name)}
            <span class="pill-status ${o.status === 'cancelled' ? 'pill-cancelled' : 'pill-confirmed'}">${o.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}</span>
            ${o.altered ? '<span class="pill-adjusted">Adjusted</span>' : ''}
            ${o.confirmed_via ? `<span style="font-size:10.5px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.02em;">via ${o.confirmed_via === 'dms' ? 'DMS' : 'Admin Portal'}</span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(o.shop_name || '')} ${o.shop_name ? '·' : ''} ${escapeHtml(o.whatsapp || '')}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(itemsText)}</div>
          ${o.note ? `<div style="font-size:12px; color:var(--gold); margin-top:4px;">Note: ${escapeHtml(o.note)}</div>` : ''}
          ${o.status !== 'cancelled' ? `<div style="font-size:12.5px; font-weight:700; margin-top:4px;">${money(billTotal)}</div>` : ''}
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(o.order_date || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
      `;
      box.appendChild(row);
    }
  }

  // ---- Customers ----
  async function loadCustomers() {
    try {
      const data = await api('/api/admin/customers');
      renderCustomers(data.customers || []);
    } catch (e) { console.error(e); }
  }

  function renderCustomers(customers) {
    const box = $('customersList');
    box.innerHTML = '';
    if (customers.length === 0) {
      box.innerHTML = '<div class="empty-note">No customers yet.</div>';
      return;
    }
    for (const c of customers) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(c.name)} ${c.blocked ? '<span class="pill-status pill-cancelled">Blocked</span>' : ''}</div>
          <div style="font-size:12px; color:var(--ink-soft);">${escapeHtml(c.shop_name || '')} ${c.shop_name ? '·' : ''} ${escapeHtml(c.whatsapp || '')} &middot; ${c.order_count} orders</div>
        </div>
        <button class="btn ${c.blocked ? 'btn-navy' : 'btn-red'} block-btn">${c.blocked ? 'Unblock' : 'Block'}</button>
      `;
      row.querySelector('.block-btn').addEventListener('click', async () => {
        if (!c.blocked && !confirm(`Block ${c.name}? They won't be able to log in or order.`)) return;
        try { await api(`/api/admin/customers/${c.id}/block`, { method: 'PUT', body: JSON.stringify({ blocked: !c.blocked }) }); loadCustomers(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // ---- Account (admin's own password) ----
  $('saveAccountBtn').addEventListener('click', async () => {
    const errEl = $('accountError');
    const msgEl = $('accountMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const current_password = $('a_current').value;
    const new_password = $('a_new').value;
    const confirm_password = $('a_confirm').value;
    if (!current_password) { errEl.textContent = 'Please enter your current password.'; errEl.style.display = 'block'; return; }
    if (!new_password || new_password.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    if (new_password !== confirm_password) { errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; return; }
    try {
      await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) });
      msgEl.style.display = 'block';
      $('a_current').value = '';
      $('a_new').value = '';
      $('a_confirm').value = '';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  // ---- Password Resets ----
  async function loadPasswordResets() {
    try {
      const data = await api('/api/admin/password-resets');
      renderPasswordResets(data.resets || []);
    } catch (e) { console.error(e); }
  }

  function renderPasswordResets(resets) {
    const box = $('resetsList');
    box.innerHTML = '';
    if (resets.length === 0) {
      box.innerHTML = '<div class="empty-note">No password reset requests yet.</div>';
      return;
    }
    for (const r of resets) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';
      const waNumber = formatWhatsAppNumber(r.whatsapp);
      const waMessage = `${storeName}: Your new password is: ${r.temp_password}\nPlease log in and change it from Settings.`;
      const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(waMessage)}`;
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(r.customer_name || '')} <span class="pill-status ${r.sent ? 'pill-new' : 'pill-cancelled'}">${r.sent ? 'Sent' : 'Not sent yet'}</span></div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">WhatsApp: ${escapeHtml(r.whatsapp || '')}</div>
          <div class="key-box" style="margin-top:6px; display:inline-block; padding:6px 12px;">${escapeHtml(r.temp_password)}</div>
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(r.created_at || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <a class="btn btn-gold whatsapp-btn" href="${waLink}" target="_blank" rel="noopener">WhatsApp</a>
          ${!r.sent ? '<button class="btn btn-navy mark-sent-btn">Mark as sent</button>' : ''}
        </div>
      `;
      const markBtn = row.querySelector('.mark-sent-btn');
      if (markBtn) markBtn.addEventListener('click', async () => {
        try { await api(`/api/admin/password-resets/${r.id}/sent`, { method: 'PUT' }); loadPasswordResets(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // Formats a stored WhatsApp number into the digits-only, country-code-first
  // shape wa.me expects (e.g. "03001234567" -> "923001234567"). Assumes
  // Pakistan when the number starts with a leading 0 - adjust here if your
  // customers are elsewhere.
  function formatWhatsAppNumber(raw) {
    let digits = String(raw || '').replace(/[^0-9]/g, '');
    if (digits.startsWith('0')) digits = '92' + digits.slice(1);
    return digits;
  }

  // ---- Broadcast (send one WhatsApp message to every customer) ----
  $('sendBroadcastBtn').addEventListener('click', async () => {
    const errEl = $('broadcastError');
    const msgEl = $('broadcastMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const message = $('b_message').value.trim();
    if (!message) { errEl.textContent = 'Please write a message first.'; errEl.style.display = 'block'; return; }
    const btn = $('sendBroadcastBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const data = await api('/api/admin/broadcast', { method: 'POST', body: JSON.stringify({ message }) });
      renderBroadcastResults(data, message);
      msgEl.textContent = data.configured
        ? `Sent automatically to ${data.sent_count} of ${data.total} customers. Use the WhatsApp buttons below for anyone missed.`
        : `WhatsApp isn't auto-configured on this server yet, so nothing was sent automatically - tap the WhatsApp button next to each customer below to send it yourself.`;
      msgEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send to All Customers';
    }
  });

  function renderBroadcastResults(data, message) {
    const box = $('broadcastResults');
    box.innerHTML = '';
    if (!data.results || data.results.length === 0) {
      box.innerHTML = '<div class="empty-note">No customers to send to yet.</div>';
      return;
    }
    for (const r of data.results) {
      const waNumber = formatWhatsAppNumber(r.whatsapp);
      const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
      const row = document.createElement('div');
      row.className = 'broadcast-result-row';
      row.innerHTML = `
        <div>
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(r.name)}</div>
          <div style="font-size:12px; color:var(--ink-soft);">${escapeHtml(r.whatsapp || '')}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="${r.sent ? 'pill-sent' : 'pill-not-sent'}">${r.sent ? 'Sent' : 'Not sent'}</span>
          ${!r.sent ? `<a class="btn btn-gold whatsapp-btn" href="${waLink}" target="_blank" rel="noopener" style="padding:8px 14px; font-size:12px;">WhatsApp</a>` : ''}
        </div>
      `;
      box.appendChild(row);
    }
  }

  // ---- Reviews (moderation) ----
  async function loadReviews() {
    try {
      const data = await api('/api/admin/reviews');
      renderReviewsAdmin(data.reviews || []);
    } catch (e) { console.error(e); }
  }

  function renderReviewsAdmin(reviews) {
    const box = $('reviewsAdminList');
    box.innerHTML = '';
    if (reviews.length === 0) {
      box.innerHTML = '<div class="empty-note">No reviews yet.</div>';
      return;
    }
    for (const r of reviews) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(r.customer_name || 'Customer')} <span style="color:#ffd45e;">${stars}</span></div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${r.target_type === 'general' ? 'General feedback (service/website)' : 'Product: ' + escapeHtml(r.product_name || '(deleted product)')}</div>
          ${r.comment ? `<div style="font-size:12.5px; margin-top:6px;">${escapeHtml(r.comment)}</div>` : ''}
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(r.created_at || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        <button class="btn btn-red delete-review-btn">Delete</button>
      `;
      row.querySelector('.delete-review-btn').addEventListener('click', async () => {
        if (!confirm('Delete this review?')) return;
        try { await api(`/api/admin/reviews/${r.id}`, { method: 'DELETE' }); loadReviews(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // ---- Store (name, tagline, logo) ----
  let currentLogoData = null;
  let storeName = 'Our Store';

  async function loadStoreSettings() {
    try {
      const data = await fetch('/api/store-info').then((r) => r.json());
      const store = data.store || {};
      storeName = store.store_name || 'Our Store';
      $('s_name').value = store.store_name || '';
      $('s_tagline').value = store.tagline || '';
      currentLogoData = store.logo_image || null;
      if (currentLogoData) { $('s_logo_preview').src = currentLogoData; $('s_logo_preview').style.display = 'block'; }
    } catch (e) { console.error(e); }
  }

  $('s_logo_file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      currentLogoData = reader.result;
      $('s_logo_preview').src = currentLogoData;
      $('s_logo_preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  $('saveStoreBtn').addEventListener('click', async () => {
    const errEl = $('storeError');
    const msgEl = $('storeMsg');
    errEl.style.display = 'none';
    msgEl.style.display = 'none';
    const store_name = $('s_name').value.trim();
    if (!store_name) { errEl.textContent = 'Please enter a store name.'; errEl.style.display = 'block'; return; }
    try {
      await api('/api/admin/store-info', {
        method: 'PUT',
        body: JSON.stringify({ store_name, tagline: $('s_tagline').value.trim(), logo_image: currentLogoData }),
      });
      msgEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  // ---- Settings / API key ----
  async function loadApiKey() {
    try {
      $('siteUrlBox').textContent = location.origin;
      const data = await api('/api/admin/api-key');
      $('apiKeyBox').textContent = data.api_key;
    } catch (e) { console.error(e); }
  }

  $('regenKeyBtn').addEventListener('click', async () => {
    if (!confirm('Generating a new key will stop the old one from working - you will need to update it in the DMS too. Continue?')) return;
    try {
      const data = await api('/api/admin/api-key/regenerate', { method: 'POST' });
      $('apiKeyBox').textContent = data.api_key;
    } catch (e) { alert(e.message); }
  });

  // ---- Boot ----
  (async () => {
    await checkSetup();
    if (token) {
      try { await api('/api/admin/products'); showAdmin(); }
      catch { token = ''; localStorage.removeItem('admin_token'); }
    }
  })();
})();
