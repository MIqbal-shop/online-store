(() => {
  let products = [];
  let cart = {}; // product_id -> { product, qty }
  let customerType = null; // 'old' | 'new'

  const $ = (id) => document.getElementById(id);
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');

  async function loadStoreInfo() {
    try {
      const res = await fetch('/api/store-info');
      const data = await res.json();
      const store = data.store || {};
      if (store.store_name) {
        document.title = store.store_name;
        $('brandName').textContent = store.store_name;
        $('brandMark').textContent = store.store_name.trim().slice(0, 2).toUpperCase();
      }
      if (store.tagline) $('brandTag').textContent = store.tagline;
      if (store.logo_image) {
        $('brandMark').innerHTML = '';
        $('brandMark').style.padding = '0';
        $('brandMark').style.overflow = 'hidden';
        const img = document.createElement('img');
        img.src = store.logo_image;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        $('brandMark').appendChild(img);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function loadProducts() {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      products = data.products || [];
      renderProducts();
    } catch (e) {
      console.error(e);
    }
  }

  function renderProducts() {
    const grid = $('productGrid');
    grid.innerHTML = '';
    $('emptyMsg').style.display = products.length ? 'none' : 'block';
    for (const p of products) {
      const card = document.createElement('div');
      card.className = 'card product-card';
      const qty = cart[p.id]?.qty || 0;
      card.innerHTML = `
        ${p.image ? `<img class="product-img" src="${p.image}" alt="${escapeHtml(p.name)}" />` : `<div class="product-img-placeholder">No image</div>`}
        <div class="product-body">
          <div class="product-name">${escapeHtml(p.name)}</div>
          ${p.description ? `<div class="product-desc">${escapeHtml(p.description)}</div>` : ''}
          <div class="product-price">${money(p.price)} <span class="unit">${p.unit ? '/ ' + escapeHtml(p.unit) : ''}</span></div>
          <div class="qty-row" data-id="${p.id}">
            <button class="qty-btn minus">−</button>
            <span class="qty-val">${qty}</span>
            <button class="qty-btn plus">+</button>
          </div>
        </div>
      `;
      const minus = card.querySelector('.minus');
      const plus = card.querySelector('.plus');
      minus.addEventListener('click', () => changeQty(p, -1, card));
      plus.addEventListener('click', () => changeQty(p, 1, card));
      grid.appendChild(card);
    }
  }

  function changeQty(product, delta, cardEl) {
    const current = cart[product.id]?.qty || 0;
    const next = Math.max(0, current + delta);
    if (next === 0) delete cart[product.id];
    else cart[product.id] = { product, qty: next };
    cardEl.querySelector('.qty-val').textContent = next;
    updateCartCount();
  }

  function updateCartCount() {
    const count = Object.values(cart).reduce((s, l) => s + l.qty, 0);
    $('cartCount').textContent = count;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Cart drawer ----
  $('cartBtn').addEventListener('click', () => { renderCart(); $('cartOverlay').style.display = 'flex'; });
  $('closeCart').addEventListener('click', () => $('cartOverlay').style.display = 'none');
  $('cartOverlay').addEventListener('click', (e) => { if (e.target.id === 'cartOverlay') $('cartOverlay').style.display = 'none'; });

  function renderCart() {
    const lines = Object.values(cart);
    const box = $('cartLines');
    box.innerHTML = '';
    $('cartEmptyNote').style.display = lines.length ? 'none' : 'block';
    $('cartTotalRow').style.display = lines.length ? 'flex' : 'none';
    let total = 0;
    for (const l of lines) {
      total += l.qty * (l.product.price || 0);
      const row = document.createElement('div');
      row.className = 'cart-line';
      row.innerHTML = `
        <div>
          <div class="name">${escapeHtml(l.product.name)}</div>
          <div class="sub">${l.qty} x ${money(l.product.price)}</div>
        </div>
        <div class="qty-row">
          <button class="qty-btn minus">−</button>
          <span class="qty-val">${l.qty}</span>
          <button class="qty-btn plus">+</button>
        </div>
      `;
      row.querySelector('.minus').addEventListener('click', () => { changeQty(l.product, -1, { querySelector: () => ({ textContent: '' }) }); renderCart(); renderProducts(); });
      row.querySelector('.plus').addEventListener('click', () => { changeQty(l.product, 1, { querySelector: () => ({ textContent: '' }) }); renderCart(); renderProducts(); });
      box.appendChild(row);
    }
    $('cartTotal').textContent = money(total);
  }

  // ---- Checkout ----
  $('checkoutBtn').addEventListener('click', () => {
    if (Object.keys(cart).length === 0) return;
    $('cartOverlay').style.display = 'none';
    $('checkoutOverlay').style.display = 'flex';
    $('checkoutForm').style.display = 'none';
    $('typeOldBtn').classList.remove('active');
    $('typeNewBtn').classList.remove('active');
    customerType = null;
  });
  $('closeCheckout').addEventListener('click', () => $('checkoutOverlay').style.display = 'none');
  $('checkoutOverlay').addEventListener('click', (e) => { if (e.target.id === 'checkoutOverlay') $('checkoutOverlay').style.display = 'none'; });

  $('typeOldBtn').addEventListener('click', () => selectType('old'));
  $('typeNewBtn').addEventListener('click', () => selectType('new'));

  function selectType(type) {
    customerType = type;
    $('typeOldBtn').classList.toggle('active', type === 'old');
    $('typeNewBtn').classList.toggle('active', type === 'new');
    $('checkoutForm').style.display = 'block';
    $('newOnlyFields').style.display = type === 'new' ? 'block' : 'none';
  }

  $('submitOrderBtn').addEventListener('click', async () => {
    const errEl = $('checkoutError');
    errEl.style.display = 'none';

    const name = $('f_name').value.trim();
    const whatsapp = $('f_whatsapp').value.trim();
    const shop = $('f_shop').value.trim();
    const phone = $('f_phone').value.trim();
    const address = $('f_address').value.trim();

    if (!customerType) { errEl.textContent = 'Please select whether you are a new or existing customer.'; errEl.style.display = 'block'; return; }
    if (!name) { errEl.textContent = 'Please enter your name.'; errEl.style.display = 'block'; return; }
    if (!whatsapp) { errEl.textContent = 'Please enter your WhatsApp number.'; errEl.style.display = 'block'; return; }
    if (customerType === 'new' && (!shop || !phone || !address)) {
      errEl.textContent = 'Shop name, phone number, and address are required.';
      errEl.style.display = 'block';
      return;
    }

    const items = Object.values(cart).map((l) => ({
      product_name: l.product.name, quantity: l.qty, unit: l.product.unit, price: l.product.price,
    }));

    const btn = $('submitOrderBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_type: customerType, customer_name: name, shop_name: shop, phone, whatsapp, address, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong while placing your order.');

      cart = {};
      updateCartCount();
      renderProducts();
      $('checkoutOverlay').style.display = 'none';
      $('successOverlay').style.display = 'flex';
      ['f_name', 'f_whatsapp', 'f_shop', 'f_phone', 'f_address'].forEach((id) => $(id).value = '');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Place Order';
    }
  });

  $('successCloseBtn').addEventListener('click', () => $('successOverlay').style.display = 'none');

  loadStoreInfo();
  loadProducts();
})();
