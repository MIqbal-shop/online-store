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
      ['products', 'orders', 'store', 'settings'].forEach((t) => $('tab-' + t).style.display = t === btn.dataset.tab ? 'block' : 'none');
    });
  });

  // ---- Products ----
  let products = [];

  async function loadProducts() {
    try {
      const data = await api('/api/admin/products');
      products = data.products || [];
      renderProducts();
    } catch (e) { console.error(e); }
  }

  function renderProducts() {
    const box = $('productsList');
    box.innerHTML = '';
    if (products.length === 0) {
      box.innerHTML = '<div class="empty-note">No products yet - add one with "+ New Product".</div>';
      return;
    }
    for (const p of products) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        ${p.image ? `<img class="thumb" src="${p.image}" />` : `<div class="thumb"></div>`}
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(p.name)} ${p.active ? '' : '<span class="pill-status pill-cancelled">Hidden</span>'}</div>
          <div style="font-size:12px; color:var(--ink-soft);">${money(p.price)} ${p.unit ? '/ ' + escapeHtml(p.unit) : ''}${p.unit_2 ? ` &middot; ${money(p.price_2)} / ${escapeHtml(p.unit_2)}` : ''}</div>
        </div>
        <button class="btn btn-ghost edit-btn">Edit</button>
      `;
      row.querySelector('.edit-btn').addEventListener('click', () => openProductModal(p));
      box.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  $('newProductBtn').addEventListener('click', () => openProductModal(null));
  $('closeProductModal').addEventListener('click', () => $('productOverlay').style.display = 'none');
  $('productOverlay').addEventListener('click', (e) => { if (e.target.id === 'productOverlay') $('productOverlay').style.display = 'none'; });

  let currentImageData = null;

  function openProductModal(product) {
    $('productError').style.display = 'none';
    $('productModalTitle').textContent = product ? 'Edit Product' : 'New Product';
    $('p_id').value = product?.id || '';
    $('p_name').value = product?.name || '';
    $('p_price').value = product?.price || '';
    $('p_unit').value = product?.unit || '';
    $('p_description').value = product?.description || '';
    $('p_active').checked = product ? !!product.active : true;
    const hasSecond = !!(product?.unit_2 && product?.price_2 != null);
    $('p_has_second').checked = hasSecond;
    $('p_second_fields').style.display = hasSecond ? 'block' : 'none';
    $('p_unit_2').value = product?.unit_2 || '';
    $('p_price_2').value = product?.price_2 ?? '';
    currentImageData = product?.image || null;
    if (currentImageData) { $('p_image_preview').src = currentImageData; $('p_image_preview').style.display = 'block'; }
    else { $('p_image_preview').style.display = 'none'; }
    $('p_image_file').value = '';
    $('deleteProductBtn').style.display = product ? 'inline-flex' : 'none';
    $('productOverlay').style.display = 'flex';
  }

  $('p_has_second').addEventListener('change', (e) => {
    $('p_second_fields').style.display = e.target.checked ? 'block' : 'none';
  });

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
    const hasSecond = $('p_has_second').checked;
    const body = {
      name: $('p_name').value.trim(),
      price: Number($('p_price').value) || 0,
      unit: $('p_unit').value.trim(),
      unit_2: hasSecond ? $('p_unit_2').value.trim() : '',
      price_2: hasSecond ? $('p_price_2').value : '',
      description: $('p_description').value.trim(),
      image: currentImageData,
      active: $('p_active').checked,
    };
    if (!body.name) { errEl.textContent = 'Please enter a product name.'; errEl.style.display = 'block'; return; }
    if (hasSecond && (!body.unit_2 || body.price_2 === '')) {
      errEl.textContent = 'Please fill in both Unit 2 and Price 2, or uncheck the second unit option.';
      errEl.style.display = 'block';
      return;
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
    } catch (e) { console.error(e); }
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
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(o.customer_name)} <span class="pill-status ${o.status === 'cancelled' ? 'pill-cancelled' : 'pill-new'}">${o.status === 'cancelled' ? 'Cancelled' : o.status === 'confirmed' ? 'Confirmed' : 'New'}</span></div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(o.shop_name || '')} ${o.shop_name ? '·' : ''} ${escapeHtml(o.whatsapp || '')}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(itemsText)}</div>
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(o.order_date || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        ${o.status !== 'cancelled' ? '<button class="btn btn-red cancel-btn">Cancel</button>' : ''}
      `;
      const cancelBtn = row.querySelector('.cancel-btn');
      if (cancelBtn) cancelBtn.addEventListener('click', async () => {
        if (!confirm('Cancel this order? It will also show as cancelled in the DMS.')) return;
        try { await api(`/api/admin/orders/${o.id}/cancel`, { method: 'PUT' }); loadOrders(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // ---- Store (name, tagline, logo) ----
  let currentLogoData = null;

  async function loadStoreSettings() {
    try {
      const data = await fetch('/api/store-info').then((r) => r.json());
      const store = data.store || {};
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
