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
    loadStockAlerts();
  }

  // ---- Tabs ----
  document.querySelectorAll('.admin-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab[data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ['dashboard', 'products', 'orders', 'history', 'customers', 'broadcast', 'reviews', 'stock-alerts', 'store', 'resets', 'account', 'settings'].forEach((t) => $('tab-' + t).style.display = t === btn.dataset.tab ? 'block' : 'none');
      if (btn.dataset.tab === 'resets') loadPasswordResets();
      if (btn.dataset.tab === 'dashboard') loadDashboard();
      if (btn.dataset.tab === 'customers') loadCustomers();
      if (btn.dataset.tab === 'history') loadHistory();
      if (btn.dataset.tab === 'reviews') loadReviews();
      if (btn.dataset.tab === 'stock-alerts') loadStockAlerts();
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
    if (p.packing_type === 'box_piece') return `${money(p.price_box)}/Box &middot; ${money(p.price_piece)}/Piece`;
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
          <div style="font-size:12px; color:var(--ink-soft);">${priceSummary(p)} ${p.company ? '&middot; ' + escapeHtml(p.company) : ''} ${p.category ? '&middot; ' + escapeHtml(p.category) : ''}</div>
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
    $('p_company').value = product?.company || '';
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
    $('p_carton_field').style.display = (pt === 'carton_piece' || pt === 'carton_box_piece') ? 'block' : 'none';
    $('p_box_field').style.display = (pt === 'carton_box_piece' || pt === 'box_piece') ? 'block' : 'none';
    $('p_packing_type').value = pt;
    document.querySelectorAll('.packing-opt').forEach((btn) => btn.classList.toggle('active', btn.dataset.pt === pt));
  }
  document.querySelectorAll('.packing-opt').forEach((btn) => {
    btn.addEventListener('click', () => applyPackingTypeUI(btn.dataset.pt));
  });

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
      company: $('p_company').value.trim(),
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
    if (pt === 'box_piece' && (body.price_box === '' || body.price_piece === '')) {
      errEl.textContent = 'Please enter both Box price and Piece price.'; errEl.style.display = 'block'; return;
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
      const underReview = !!o.review_pending;
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';

      const compareHtml = underReview ? `
        <div class="review-compare-box">
          <div class="heading">Customer ne yeh order kiya tha, humne review mein unhein yeh offer kiya hai:</div>
          ${(o.items || []).map((it) => {
            const reviewQty = it.review_quantity != null ? it.review_quantity : it.quantity;
            const changed = Number(reviewQty) !== Number(it.quantity);
            return `<div style="display:flex; justify-content:space-between; font-size:12.5px; padding:2px 0;">
              <span>${escapeHtml(it.product_name)} ${changed ? `<s style="opacity:.55;">${it.quantity}</s> &rarr; <b>${reviewQty}</b>` : `x ${it.quantity}`} ${escapeHtml(it.unit || '')}</span>
              <span style="color:var(--ink-soft);">${money(it.price)}</span>
            </div>`;
          }).join('')}
          <div class="total-row"><span>Offer Ki Gayi Total</span><span>${money((o.items || []).reduce((s, it) => s + (it.review_quantity != null ? it.review_quantity : it.quantity) * it.price, 0))}</span></div>
        </div>
      ` : '';

      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${escapeHtml(o.customer_name)}
            ${underReview ? '<span class="pill-review">🕒 Review Mein</span>' : ''}
            <span class="pill-status pill-new">New</span>
          </div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(o.shop_name || '')} ${o.shop_name ? '·' : ''} ${escapeHtml(o.whatsapp || '')}</div>
          ${!underReview ? `<div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(itemsText)}</div>` : ''}
          ${o.note ? `<div style="font-size:12px; color:var(--gold); margin-top:4px;">Note: ${escapeHtml(o.note)}</div>` : ''}
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(o.order_date || '').toString().replace('T', ' ').slice(0, 16)}</div>
          ${compareHtml}
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          ${underReview ? `
            <button class="btn btn-navy confirm-reviewed-btn">Confirm (Review Wala)</button>
            <button class="btn btn-outline confirm-original-btn">Original Order Confirm</button>
            <button class="btn btn-outline review-btn">Edit Review</button>
            <button class="btn btn-red cancel-btn">Cancel</button>
          ` : `
            <button class="btn btn-navy quick-confirm-btn">Confirm</button>
            <button class="btn btn-outline review-btn">Review</button>
            <button class="btn btn-red cancel-btn">Cancel</button>
          `}
        </div>
      `;
      // Quick path: nothing needs to change, confirm exactly as ordered -
      // no need to open Review at all.
      row.querySelector('.quick-confirm-btn')?.addEventListener('click', async () => {
        if (!confirm(`Confirm this order exactly as ordered (${itemsText})?`)) return;
        try { await api(`/api/admin/orders/${o.id}/confirm`, { method: 'PUT', body: JSON.stringify({ items: [] }) }); loadOrders(); } catch (e) { alert(e.message); }
      });
      // Under review: confirm with the reviewed (offered) quantities.
      row.querySelector('.confirm-reviewed-btn')?.addEventListener('click', async () => {
        const items = (o.items || []).map((it) => ({ id: it.id, confirmed_quantity: it.review_quantity != null ? it.review_quantity : it.quantity }));
        if (!confirm('Confirm this order with the reviewed (offered) quantities?')) return;
        try { await api(`/api/admin/orders/${o.id}/confirm`, { method: 'PUT', body: JSON.stringify({ items }) }); loadOrders(); } catch (e) { alert(e.message); }
      });
      // Under review, but customer wants exactly what they originally ordered instead.
      row.querySelector('.confirm-original-btn')?.addEventListener('click', async () => {
        if (!confirm(`Confirm this order exactly as originally ordered (${itemsText})?`)) return;
        try { await api(`/api/admin/orders/${o.id}/confirm`, { method: 'PUT', body: JSON.stringify({ items: [] }) }); loadOrders(); } catch (e) { alert(e.message); }
      });
      row.querySelector('.review-btn')?.addEventListener('click', () => openOrderReview(o));
      row.querySelector('.cancel-btn')?.addEventListener('click', async () => {
        if (!confirm('Cancel this order? It will also show as cancelled in the DMS.')) return;
        try { await api(`/api/admin/orders/${o.id}/cancel`, { method: 'PUT' }); loadOrders(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // ---- Order review editor ----
  // Used to propose (or re-propose) quantities and message the customer.
  // Sending the WhatsApp message saves the proposal as "Under Review" (here
  // and pushed to the DMS) and closes the editor - actually confirming
  // happens afterwards, from the order list buttons (either app).
  $('closeOrderReview').addEventListener('click', () => $('orderReviewOverlay').style.display = 'none');
  $('orderReviewCloseBtn').addEventListener('click', () => $('orderReviewOverlay').style.display = 'none');
  $('orderReviewOverlay').addEventListener('click', (e) => { if (e.target.id === 'orderReviewOverlay') $('orderReviewOverlay').style.display = 'none'; });

  let reviewingOrder = null;

  function openOrderReview(order) {
    reviewingOrder = order;
    $('orderReviewError').style.display = 'none';

    $('orderReviewCustomerBox').innerHTML = `
      <div style="font-weight:700; font-size:14.5px; color:var(--ink);">${escapeHtml(order.customer_name)}</div>
      ${order.shop_name ? escapeHtml(order.shop_name) + ' &middot; ' : ''}${escapeHtml(order.whatsapp || '')}
      ${order.note ? `<div style="color:var(--gold); margin-top:4px;">Note: ${escapeHtml(order.note)}</div>` : ''}
    `;

    const itemsBox = $('orderReviewItems');
    itemsBox.innerHTML = (order.items || []).map((it) => {
      const startQty = it.review_quantity != null ? it.review_quantity : it.quantity;
      return `
      <div class="review-item-row" data-item-id="${it.id}" data-price="${it.price}" data-name="${escapeHtml(it.product_name)}" data-unit="${escapeHtml(it.unit || '')}" data-ordered-qty="${it.quantity}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid var(--line);">
        <div>
          <div style="font-weight:600; font-size:13px;">${escapeHtml(it.product_name)}</div>
          <div style="font-size:11.5px; color:var(--ink-soft);">Ordered: ${it.quantity} ${escapeHtml(it.unit || '')} &middot; ${money(it.price)} each</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:11px; color:var(--ink-soft); margin:0;">Give qty</label>
          <input type="number" class="review-qty-input" value="${startQty}" min="0" step="any" style="width:72px; padding:6px 8px;" />
        </div>
      </div>
    `;
    }).join('');
    itemsBox.querySelectorAll('.review-qty-input').forEach((inp) => inp.addEventListener('input', () => { updateOrderReviewTotal(); updateAskMessage(); }));
    updateOrderReviewTotal();
    updateAskMessage();
    $('orderReviewAskMsg').oninput = updateAskWhatsAppLink;
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

  // Builds the "here's what we can actually send you, is that OK?" message
  // from whatever's currently in the qty inputs - regenerated on every
  // change so it always reflects the latest numbers.
  function updateAskMessage() {
    if (!reviewingOrder) return;
    const orderedLines = [];
    const givingLines = [];
    let anyDiff = false;
    document.querySelectorAll('#orderReviewItems .review-item-row').forEach((row) => {
      const name = row.dataset.name;
      const unit = row.dataset.unit || '';
      const orderedQty = Number(row.dataset.orderedQty);
      const giveQty = Number(row.querySelector('.review-qty-input').value) || 0;
      if (giveQty !== orderedQty) anyDiff = true;
      orderedLines.push(`- ${name}: ${orderedQty} ${unit}`.trim());
      givingLines.push(`- ${name}: ${giveQty} ${unit}`.trim());
    });
    const totalText = $('orderReviewTotal').textContent;
    const custName = reviewingOrder.customer_name || '';
    const message = anyDiff
      ? `Assalam o Alaikum ${custName}!\n\nAap ne yeh order diya tha -\n${orderedLines.join('\n')}\n\nHum filhaal itna bhej sakte hain -\n${givingLines.join('\n')}\n\nNaya total: ${totalText}\n\nKya yeh aapko manzoor hai? Please tasdeeq kar dein.`
      : `Assalam o Alaikum ${custName}!\n\nAap ka order confirm kar rahe hain, poora ordered saman ke mutabiq -\n${givingLines.join('\n')}\n\nTotal: ${totalText}\n\nKya yeh confirm hai?`;
    $('orderReviewAskMsg').value = message;
    updateAskWhatsAppLink();
  }

  function updateAskWhatsAppLink() {
    if (!reviewingOrder) return;
    const link = $('orderReviewAskBtn');
    link.href = `https://wa.me/${formatWhatsAppNumber(reviewingOrder.whatsapp)}?text=${encodeURIComponent($('orderReviewAskMsg').value)}`;
  }

  // Sends the WhatsApp message AND saves the proposal as "under review" in
  // one action - the editor then closes and the order list shows the
  // "Review Mein" box from here on (even after a reload, and in the DMS
  // too) until someone confirms/cancels it.
  $('orderReviewAskBtn').addEventListener('click', async () => {
    if (!reviewingOrder) return;
    const errEl = $('orderReviewError');
    errEl.style.display = 'none';
    const items = [];
    document.querySelectorAll('#orderReviewItems .review-item-row').forEach((row) => {
      items.push({ id: Number(row.dataset.itemId), review_quantity: row.querySelector('.review-qty-input').value });
    });
    try {
      await api(`/api/admin/orders/${reviewingOrder.id}/set-review`, { method: 'PUT', body: JSON.stringify({ items }) });
      $('orderReviewOverlay').style.display = 'none';
      loadOrders();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  // ---- Period filter: Today / Date / Month / Year ----
  // Shared by the Dashboard and Order History tabs, mirroring the DMS
  // app's own period picker so both feel the same to use.
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function currentMonthStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function currentYearStr() { return String(new Date().getFullYear()); }
  function lastDayOfMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  // Turns a period+value into an inclusive { start, end } YYYY-MM-DD range.
  function computeRange(period, value) {
    if (period === 'today') { const d = todayStr(); return { start: d, end: d, label: 'Today' }; }
    if (period === 'date') { const d = value || todayStr(); return { start: d, end: d, label: d }; }
    if (period === 'month') { const ym = value || currentMonthStr(); return { start: `${ym}-01`, end: lastDayOfMonth(ym), label: ym }; }
    if (period === 'year') { const y = value || currentYearStr(); return { start: `${y}-01-01`, end: `${y}-12-31`, label: y }; }
    const d = todayStr(); return { start: d, end: d, label: 'Today' };
  }

  // Builds the tabs + matching input into `container`, keeps its own
  // period/value state, and calls onChange(range) whenever either changes
  // (including once immediately, so the caller can do its first load).
  function createPeriodFilter(container, onChange) {
    let period = 'today';
    let dateValue = todayStr();
    let monthValue = currentMonthStr();
    let yearValue = currentYearStr();
    const currentYearNum = new Date().getFullYear();
    const yearOptions = Array.from({ length: 8 }, (_, i) => currentYearNum - 6 + i).reverse();

    function valueFor(p) { return { date: dateValue, month: monthValue, year: yearValue }[p]; }

    function render() {
      const tabs = [['today', 'Today'], ['date', 'Date'], ['month', 'Month'], ['year', 'Year']];
      container.innerHTML = `
        <div class="period-tabs">
          ${tabs.map(([k, l]) => `<button type="button" class="period-tab ${period === k ? 'active' : ''}" data-period="${k}">${l}</button>`).join('')}
        </div>
        <div class="period-input-wrap">
          ${period === 'date' ? `<input type="date" id="periodInput_${container.id}" value="${dateValue}" />` : ''}
          ${period === 'month' ? `<input type="month" id="periodInput_${container.id}" value="${monthValue}" />` : ''}
          ${period === 'year' ? `
            <select id="periodInput_${container.id}">
              ${yearOptions.map((y) => `<option value="${y}" ${String(y) === yearValue ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          ` : ''}
        </div>
        <span class="period-range-label" id="periodRangeLabel_${container.id}"></span>
      `;
      container.querySelectorAll('.period-tab').forEach((btn) => {
        btn.addEventListener('click', () => { period = btn.dataset.period; render(); fire(); });
      });
      const input = document.getElementById(`periodInput_${container.id}`);
      if (input) {
        input.addEventListener('change', () => {
          if (period === 'date') dateValue = input.value || todayStr();
          if (period === 'month') monthValue = input.value || currentMonthStr();
          if (period === 'year') yearValue = input.value || currentYearStr();
          fire();
        });
      }
      const range = computeRange(period, valueFor(period));
      const rangeLabelEl = document.getElementById(`periodRangeLabel_${container.id}`);
      if (rangeLabelEl) rangeLabelEl.textContent = range.start === range.end ? range.start : `${range.start} → ${range.end}`;
    }
    function fire() {
      const rangeLabelEl = document.getElementById(`periodRangeLabel_${container.id}`);
      const range = computeRange(period, valueFor(period));
      if (rangeLabelEl) rangeLabelEl.textContent = range.start === range.end ? range.start : `${range.start} → ${range.end}`;
      onChange(range);
    }
    render();
    return { getRange: () => computeRange(period, valueFor(period)) };
  }

  // ---- Dashboard ----
  const dashboardFilter = createPeriodFilter($('dashboardPeriodFilter'), (range) => loadDashboard(range));

  async function loadDashboard(range) {
    range = range || dashboardFilter.getRange();
    try {
      const params = new URLSearchParams({ start: range.start, end: range.end });
      const data = await api('/api/admin/dashboard?' + params.toString());
      const grid = $('dashGrid');
      grid.innerHTML = `
        <div class="dash-card"><div class="num">${data.pending_orders}</div><div class="label">Pending orders</div></div>
        <div class="dash-card"><div class="num">${data.confirmed_count}</div><div class="label">Confirmed</div></div>
        <div class="dash-card"><div class="num">${money(data.revenue)}</div><div class="label">Revenue</div></div>
        <div class="dash-card"><div class="num">${data.cancelled_count}</div><div class="label">Cancelled</div></div>
      `;
      const topBox = $('dashTopProducts');
      if (!data.top_products || data.top_products.length === 0) {
        topBox.innerHTML = '<div class="empty-note">No confirmed orders in this period.</div>';
      } else {
        topBox.innerHTML = data.top_products.map((p) => `
          <div class="admin-row"><span>${escapeHtml(p.product_name)}</span><span style="color:var(--ink-soft);">${p.total_qty} sold</span></div>
        `).join('');
      }
    } catch (e) { console.error(e); }
  }

  // ---- Order History ----
  const historyFilter = createPeriodFilter($('historyPeriodFilter'), (range) => loadHistory(range));

  async function loadHistory(range) {
    range = range || historyFilter.getRange();
    const params = new URLSearchParams({ start: range.start, end: range.end });
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

  // ---- Delete Order History ----
  async function loadHistoryDeleteCount() {
    try {
      const data = await api('/api/admin/orders/history-count');
      $('deleteHistoryCountNote').textContent = data.count > 0
        ? `This will permanently delete all ${data.count} confirmed/cancelled order(s) below. Orders still waiting in the Orders tab are not touched.`
        : 'There is no confirmed/cancelled order history to delete yet.';
    } catch (e) { console.error(e); }
  }

  $('openDeleteHistoryBtn').addEventListener('click', () => {
    $('dh_password').value = '';
    $('dh_confirm').value = '';
    $('deleteHistoryError').style.display = 'none';
    loadHistoryDeleteCount();
    $('deleteHistoryOverlay').style.display = 'flex';
  });
  $('closeDeleteHistory').addEventListener('click', () => $('deleteHistoryOverlay').style.display = 'none');
  $('deleteHistoryOverlay').addEventListener('click', (e) => { if (e.target.id === 'deleteHistoryOverlay') $('deleteHistoryOverlay').style.display = 'none'; });

  $('deleteHistorySubmitBtn').addEventListener('click', async () => {
    const errEl = $('deleteHistoryError');
    errEl.style.display = 'none';
    const password = $('dh_password').value;
    const confirmText = $('dh_confirm').value;
    if (confirmText !== 'DELETE') {
      errEl.textContent = 'Type DELETE in the confirmation box.';
      errEl.style.display = 'block';
      return;
    }
    const btn = $('deleteHistorySubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
      await api('/api/admin/orders/delete-history', { method: 'POST', body: JSON.stringify({ password, confirm: confirmText }) });
      $('deleteHistoryOverlay').style.display = 'none';
      loadHistory();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Yes, Delete Order History';
    }
  });

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
      row.style.flexWrap = 'wrap';

      const readyAt = c.deletion_requested_at ? new Date(c.deletion_requested_at).getTime() + 48 * 60 * 60 * 1000 : null;
      const coolOffDone = readyAt !== null && Date.now() >= readyAt;

      let deleteControlsHtml;
      if (!c.pending_deletion) {
        deleteControlsHtml = `<button class="btn btn-red delete-btn">Delete customer</button>`;
      } else if (!coolOffDone) {
        deleteControlsHtml = `
          <div class="delete-pending-box">
            <span class="delete-pending-label">Deletion scheduled &middot; ${timeRemaining(readyAt)} left</span>
            <button class="btn btn-navy cancel-delete-btn">Cancel deletion</button>
          </div>`;
      } else {
        deleteControlsHtml = `
          <div class="delete-pending-box">
            <span class="delete-pending-label delete-ready-label">48 hours passed - delete now?</span>
            <button class="btn btn-navy cancel-delete-btn">No, keep</button>
            <button class="btn btn-red confirm-delete-btn">Yes, delete permanently</button>
          </div>`;
      }

      row.innerHTML = `
        <div style="flex:1; min-width:180px;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(c.name)} ${c.blocked ? '<span class="pill-status pill-cancelled">Blocked</span>' : ''}</div>
          <div style="font-size:12px; color:var(--ink-soft);">${escapeHtml(c.shop_name || '')} ${c.shop_name ? '·' : ''} ${escapeHtml(c.whatsapp || '')} &middot; ${c.order_count} orders</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="btn ${c.blocked ? 'btn-navy' : 'btn-red'} block-btn">${c.blocked ? 'Unblock' : 'Block'}</button>
          ${deleteControlsHtml}
        </div>
      `;
      row.querySelector('.block-btn').addEventListener('click', async () => {
        if (!c.blocked && !confirm(`Block ${c.name}? They won't be able to log in or order.`)) return;
        try { await api(`/api/admin/customers/${c.id}/block`, { method: 'PUT', body: JSON.stringify({ blocked: !c.blocked }) }); loadCustomers(); } catch (e) { alert(e.message); }
      });
      const deleteBtn = row.querySelector('.delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Delete ${c.name}? Their account will be permanently removed after a mandatory 48-hour cool-off. You can cancel any time before then.`)) return;
          try { await api(`/api/admin/customers/${c.id}/schedule-delete`, { method: 'PUT' }); loadCustomers(); } catch (e) { alert(e.message); }
        });
      }
      const cancelBtn = row.querySelector('.cancel-delete-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          try { await api(`/api/admin/customers/${c.id}/cancel-delete`, { method: 'PUT' }); loadCustomers(); } catch (e) { alert(e.message); }
        });
      }
      const confirmBtn = row.querySelector('.confirm-delete-btn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          if (!confirm(`Permanently delete ${c.name} and their entire order history? This cannot be undone, and removes it from the DMS app too.`)) return;
          try { await api(`/api/admin/customers/${c.id}`, { method: 'DELETE' }); loadCustomers(); } catch (e) { alert(e.message); }
        });
      }
      box.appendChild(row);
    }
  }

  // Ticks every minute so the "Xh Ym left" label on a scheduled deletion
  // stays roughly current without needing a full reload.
  function timeRemaining(readyAtMs) {
    const ms = Math.max(0, readyAtMs - Date.now());
    const totalMinutes = Math.ceil(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  }
  setInterval(() => { if (currentTab === 'customers') loadCustomers(); }, 60000);

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

  // ---- Stock Alerts ("notify me when back in stock") ----
  async function loadStockAlerts() {
    try {
      const data = await api('/api/admin/stock-notify-requests');
      renderStockAlerts(data.requests || []);
      const pendingCount = (data.requests || []).filter((r) => !r.notified).length;
      const badge = $('stockAlertsTabBadge');
      badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
      badge.style.display = pendingCount > 0 ? 'flex' : 'none';
    } catch (e) { console.error(e); }
  }

  function renderStockAlerts(requests) {
    const box = $('stockAlertsList');
    box.innerHTML = '';
    if (requests.length === 0) {
      box.innerHTML = '<div class="empty-note">No stock alert requests yet.</div>';
      return;
    }
    for (const r of requests) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';
      const backInStock = !!r.product_in_stock;
      const waNumber = formatWhatsAppNumber(r.whatsapp);
      const productLabel = r.product_name || 'this product';
      const waMessage = backInStock
        ? `Hi! You asked us to notify you about "${productLabel}" - it's back in stock now! You can order it again at iqbaltrader.vercel.app. Enjoy the opportunity!`
        : `Hi! Sorry for the inconvenience - "${productLabel}" is not available right now. As soon as it's back in stock, we'll message you here on WhatsApp to let you know.`;
      const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(waMessage)}`;
      row.innerHTML = `
        <div style="flex:1; ${r.notified ? 'opacity:0.55;' : ''}">
          <div style="font-weight:600; font-size:13.5px;">
            ${escapeHtml(r.product_name || '(deleted product)')}
            ${r.notified ? '<span class="pill-status pill-new">Notified</span>' : backInStock ? '<span class="pill-status pill-confirmed">Back in stock</span>' : '<span class="pill-status pill-cancelled">Still out of stock</span>'}
          </div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(r.customer_name || 'Customer')} &middot; ${escapeHtml(r.whatsapp || '')}</div>
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(r.created_at || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
          <a class="btn ${backInStock ? 'btn-gold' : 'btn-navy'} whatsapp-btn" href="${waLink}" target="_blank" rel="noopener">${backInStock ? 'WhatsApp: It\u2019s back!' : 'WhatsApp: Sorry, not yet'}</a>
          ${!r.notified ? '<button class="btn btn-navy mark-notified-btn">Mark as notified</button>' : '<button class="btn btn-navy unmark-notified-btn">Move back to pending</button>'}
          <button class="btn btn-red delete-alert-btn">Remove</button>
        </div>
      `;
      const markBtn = row.querySelector('.mark-notified-btn');
      if (markBtn) markBtn.addEventListener('click', async () => {
        try { await api(`/api/admin/stock-notify-requests/${r.id}/notified`, { method: 'PUT', body: JSON.stringify({ notified: true }) }); loadStockAlerts(); } catch (e) { alert(e.message); }
      });
      const unmarkBtn = row.querySelector('.unmark-notified-btn');
      if (unmarkBtn) unmarkBtn.addEventListener('click', async () => {
        try { await api(`/api/admin/stock-notify-requests/${r.id}/notified`, { method: 'PUT', body: JSON.stringify({ notified: false }) }); loadStockAlerts(); } catch (e) { alert(e.message); }
      });
      row.querySelector('.delete-alert-btn').addEventListener('click', async () => {
        if (!confirm('Remove this alert request?')) return;
        try { await api(`/api/admin/stock-notify-requests/${r.id}`, { method: 'DELETE' }); loadStockAlerts(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

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
        <div style="flex:1; ${r.hidden ? 'opacity:0.55;' : ''}">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(r.customer_name || 'Customer')} <span style="color:#ffd45e;">${stars}</span> ${r.hidden ? '<span class="pill-status pill-cancelled">Hidden</span>' : ''}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${r.target_type === 'general' ? 'General feedback (service/website)' : 'Product: ' + escapeHtml(r.product_name || '(deleted product)')}</div>
          ${r.comment ? `<div style="font-size:12.5px; margin-top:6px;">${escapeHtml(r.comment)}</div>` : ''}
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(r.created_at || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        <div style="display:flex; gap:8px; flex-shrink:0;">
          <button class="btn btn-navy hide-review-btn">${r.hidden ? 'Unhide' : 'Hide'}</button>
          <button class="btn btn-red delete-review-btn">Delete</button>
        </div>
      `;
      row.querySelector('.hide-review-btn').addEventListener('click', async () => {
        try { await api(`/api/admin/reviews/${r.id}/hide`, { method: 'PUT', body: JSON.stringify({ hidden: !r.hidden }) }); loadReviews(); } catch (e) { alert(e.message); }
      });
      row.querySelector('.delete-review-btn').addEventListener('click', async () => {
        if (!confirm('Delete this review? This cannot be undone.')) return;
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
