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
    if (!res.ok) throw new Error(data.error || 'Kuch ghalat ho gaya.');
    return data;
  }

  // ---- Setup / Login ----
  async function checkSetup() {
    const data = await fetch('/api/admin/setup-status').then((r) => r.json());
    needsSetup = data.needsSetup;
    if (needsSetup) {
      $('loginTitle').textContent = 'Admin Account Banayein';
      $('loginSubtitle').textContent = 'Pehli dafa - apna username aur password set karein.';
      $('confirmPwField').style.display = 'block';
      $('loginSubmitBtn').textContent = 'Account Banayein';
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
        if (password !== confirm) throw new Error('Dono password match nahi karte.');
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
  }

  // ---- Tabs ----
  document.querySelectorAll('.admin-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab[data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ['products', 'orders', 'settings'].forEach((t) => $('tab-' + t).style.display = t === btn.dataset.tab ? 'block' : 'none');
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
      box.innerHTML = '<div class="empty-note">Abhi koi product nahi hai - "+ Naya Product" se add karein.</div>';
      return;
    }
    for (const p of products) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        ${p.image ? `<img class="thumb" src="${p.image}" />` : `<div class="thumb"></div>`}
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(p.name)} ${p.active ? '' : '<span class="pill-status pill-cancelled">Hidden</span>'}</div>
          <div style="font-size:12px; color:var(--ink-soft);">${money(p.price)} ${p.unit ? '/ ' + escapeHtml(p.unit) : ''}</div>
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
    $('productModalTitle').textContent = product ? 'Product Edit Karein' : 'Naya Product';
    $('p_id').value = product?.id || '';
    $('p_name').value = product?.name || '';
    $('p_price').value = product?.price || '';
    $('p_unit').value = product?.unit || '';
    $('p_description').value = product?.description || '';
    $('p_active').checked = product ? !!product.active : true;
    currentImageData = product?.image || null;
    if (currentImageData) { $('p_image_preview').src = currentImageData; $('p_image_preview').style.display = 'block'; }
    else { $('p_image_preview').style.display = 'none'; }
    $('p_image_file').value = '';
    $('deleteProductBtn').style.display = product ? 'inline-flex' : 'none';
    $('productOverlay').style.display = 'flex';
  }

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
    const body = {
      name: $('p_name').value.trim(),
      price: Number($('p_price').value) || 0,
      unit: $('p_unit').value.trim(),
      description: $('p_description').value.trim(),
      image: currentImageData,
      active: $('p_active').checked,
    };
    if (!body.name) { errEl.textContent = 'Product ka naam likhein.'; errEl.style.display = 'block'; return; }
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
    if (!id || !confirm('Yeh product delete karna hai?')) return;
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
      box.innerHTML = '<div class="empty-note">Abhi koi order nahi aaya.</div>';
      return;
    }
    for (const o of orders) {
      const itemsText = (o.items || []).map((it) => `${it.product_name} x ${it.quantity}${it.unit ? ' ' + it.unit : ''}`).join(', ');
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.style.alignItems = 'flex-start';
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13.5px;">${escapeHtml(o.customer_name)} <span class="pill-status ${o.status === 'cancelled' ? 'pill-cancelled' : 'pill-new'}">${o.status === 'cancelled' ? 'Cancel' : o.status === 'confirmed' ? 'Confirmed' : 'Naya'}</span></div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(o.shop_name || '')} ${o.shop_name ? '·' : ''} ${escapeHtml(o.whatsapp || '')}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">${escapeHtml(itemsText)}</div>
          <div style="font-size:11px; color:#9aa0b4; margin-top:4px;">${(o.order_date || '').toString().replace('T', ' ').slice(0, 16)}</div>
        </div>
        ${o.status !== 'cancelled' ? '<button class="btn btn-red cancel-btn">Cancel</button>' : ''}
      `;
      const cancelBtn = row.querySelector('.cancel-btn');
      if (cancelBtn) cancelBtn.addEventListener('click', async () => {
        if (!confirm('Yeh order cancel karna hai? DMS mein bhi cancel dikhega.')) return;
        try { await api(`/api/admin/orders/${o.id}/cancel`, { method: 'PUT' }); loadOrders(); } catch (e) { alert(e.message); }
      });
      box.appendChild(row);
    }
  }

  // ---- Settings / API key ----
  async function loadApiKey() {
    try {
      $('siteUrlBox').textContent = location.origin;
      const data = await api('/api/admin/api-key');
      $('apiKeyBox').textContent = data.api_key;
    } catch (e) { console.error(e); }
  }

  $('regenKeyBtn').addEventListener('click', async () => {
    if (!confirm('Nayi key banane se purani key kaam karna band kar degi - DMS mein bhi nayi key dalni hogi. Aage badhein?')) return;
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
