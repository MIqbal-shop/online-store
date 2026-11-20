/* Admin UI extras: toasts, list search/filters, dashboard analytics. Reads existing endpoints only (no backend change). */
(function () {
  const tok = () => localStorage.getItem('admin_token') || '';
  const get = (u) => fetch(u, { headers: { Authorization: 'Bearer ' + tok() } }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => 'Rs ' + Math.round(n).toLocaleString('en-US');
  const day = (d) => new Date(d).toLocaleDateString('en-CA');
  const bill = (o) => (o.items || []).reduce((s, i) => s + (i.confirmed_quantity != null ? Number(i.confirmed_quantity) : Number(i.quantity)) * Number(i.price), 0);

  // Toast notifications replace the browser alert() popups
  const tw = document.createElement('div'); tw.id = 'toasts'; document.body.appendChild(tw);
  window.alert = (m) => {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; tw.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4200);
  };

  // Search (all list pages) + status filter (order history)
  const lists = { productsList: 'products', ordersList: 'orders', historyList: 'order history', customersList: 'customers', reviewsAdminList: 'reviews', stockAlertsList: 'stock alerts', verificationsList: 'verifications', resetsList: 'password resets' };
  Object.keys(lists).forEach((id) => {
    const box = document.getElementById(id); if (!box) return;
    const bar = document.createElement('div'); bar.className = 'filter-bar';
    bar.innerHTML = '<input type="search" placeholder="Search ' + lists[id] + '…">' + (id === 'historyList' ? '<select><option value="">All statuses</option><option>Confirmed</option><option>Cancelled</option></select>' : '');
    box.parentNode.insertBefore(bar, box);
    const q = bar.querySelector('input'), s = bar.querySelector('select');
    const apply = () => {
      const t = q.value.toLowerCase(), st = s ? s.value.toLowerCase() : '';
      [...box.children].forEach((r) => {
        if (r.classList.contains('empty-note')) return;
        const x = r.textContent.toLowerCase();
        r.style.display = x.includes(t) && (!st || x.includes(st)) ? '' : 'none';
      });
    };
    q.addEventListener('input', apply); if (s) s.addEventListener('change', apply);
    new MutationObserver(apply).observe(box, { childList: true });
  });


  // Order History: export all confirmed/cancelled orders to a CSV file (Excel-friendly)
  const hb = document.getElementById('historyList');
  if (hb) {
    const bar = hb.previousElementSibling, btn = document.createElement('button');
    btn.className = 'btn btn-ghost'; btn.textContent = 'Export CSV';
    btn.addEventListener('click', async () => {
      try {
        const d = await get('/api/admin/orders/history');
        const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [['Order ID', 'Date', 'Customer', 'Status', 'Items', 'Total'].join(',')];
        (d.orders || []).forEach((o) => lines.push([o.id, day(o.order_date), o.customer_name, o.status, (o.items || []).map((i) => i.product_name + ' x ' + (i.confirmed_quantity != null ? i.confirmed_quantity : i.quantity)).join('; '), o.status === 'cancelled' ? 0 : bill(o)].map(q).join(',')));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = 'iqbal-trader-orders-' + day(new Date()) + '.csv'; a.click();
      } catch (e) { alert('Could not export orders.'); }
    });
    if (bar) bar.appendChild(btn);
  }

  // Dashboard analytics from real orders / products
  const anchor = document.getElementById('dashTopProducts'); if (!anchor) return;
  const wrap = document.createElement('div'); wrap.className = 'dash-extra';
  wrap.innerHTML = '<div class="card gc"><h4>Revenue · last 14 days</h4><div id="xRev" class="skel"></div></div><div class="card gc"><h4>Order trend · last 14 days</h4><div id="xTrend" class="skel"></div></div><div class="card gc"><h4>Recent pending orders</h4><div id="xRecent" class="skel"></div></div><div class="card gc"><h4>Latest activity</h4><div id="xAct" class="skel"></div></div><div class="card gc wide"><h4>Out-of-stock products</h4><div id="xStock" class="skel"></div></div>';
  anchor.parentNode.appendChild(wrap);
  const $ = (id) => document.getElementById(id);
  const empty = (t) => '<div class="empty-note">' + t + '</div>';
  const row = (a, b) => '<div class="mini-row"><span>' + a + '</span><span>' + b + '</span></div>';

  function chart(vals, labels, type) {
    const W = 560, H = 170, P = 22, max = Math.max(...vals, 1), n = vals.length, bw = (W - P * 2) / n;
    let g = '';
    if (type === 'bar') {
      vals.forEach((v, i) => { const h = (v / max) * (H - 50); g += '<rect x="' + (P + i * bw + 4) + '" y="' + (H - 26 - h) + '" width="' + (bw - 8) + '" height="' + Math.max(h, 1) + '" rx="4" fill="url(#gb)"><title>' + labels[i] + ': ' + money(v) + '</title></rect>'; });
    } else {
      const pts = vals.map((v, i) => [P + i * bw + bw / 2, H - 26 - (v / max) * (H - 50)]);
      g += '<polygon points="' + P + ',' + (H - 26) + ' ' + pts.map((p) => p.join(',')).join(' ') + ' ' + (W - P) + ',' + (H - 26) + '" fill="url(#ga)"/><polyline points="' + pts.map((p) => p.join(',')).join(' ') + '" fill="none" stroke="#22D3EE" stroke-width="2.2" stroke-linejoin="round"/>';
      pts.forEach((p, i) => { g += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.2" fill="#22D3EE"><title>' + labels[i] + ': ' + vals[i] + ' orders</title></circle>'; });
    }
    let x = ''; labels.forEach((l, i) => { if (i % 2 === 0) x += '<text x="' + (P + i * bw + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#8B98AE">' + l.slice(5) + '</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%"><defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B82F6"/><stop offset="1" stop-color="#3B82F6" stop-opacity=".25"/></linearGradient><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22D3EE" stop-opacity=".35"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></linearGradient></defs>' + g + x + '</svg>';
  }

  async function load() {
    const shell = $('adminShell'), tab = $('tab-dashboard');
    if (!tok() || !shell || shell.style.display === 'none' || tab.style.display === 'none') return;
    const end = new Date(), start = new Date(); start.setDate(end.getDate() - 13);
    try {
      const [h, p, pr] = await Promise.all([
        get('/api/admin/orders/history?start=' + day(start) + '&end=' + day(end)),
        get('/api/admin/orders'), get('/api/admin/products')]);
      const days = [], rev = {}, cnt = {};
      for (let i = 0; i < 14; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const k = day(d); days.push(k); rev[k] = 0; cnt[k] = 0; }
      const hist = h.orders || [];
      hist.forEach((o) => { const k = day(o.order_date); if (k in cnt) { cnt[k]++; if (o.status === 'confirmed') rev[k] += bill(o); } });
      $('xRev').className = ''; $('xTrend').className = '';
      $('xRev').innerHTML = chart(days.map((k) => rev[k]), days, 'bar');
      $('xTrend').innerHTML = chart(days.map((k) => cnt[k]), days, 'line');
      const pend = (p.orders || []).slice(0, 6);
      $('xRecent').className = ''; $('xRecent').innerHTML = pend.length ? pend.map((o) => row('<b>#' + o.id + '</b> ' + esc(o.customer_name), '<span class="pill-status pill-new">Pending</span>')).join('') : empty('No pending orders');
      $('xAct').className = ''; $('xAct').innerHTML = hist.length ? hist.slice(0, 6).map((o) => row(esc(o.customer_name) + ' <small>' + new Date(o.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</small>', o.status === 'cancelled' ? '<span class="pill-status pill-cancelled">Cancelled</span>' : '<span class="pill-status pill-confirmed">' + money(bill(o)) + '</span>')).join('') : empty('No activity in the last 14 days');
      const out = (pr.products || pr || []).filter((x) => x && x.in_stock === false).slice(0, 8);
      $('xStock').className = ''; $('xStock').innerHTML = out.length ? out.map((x) => row(esc(x.name), '<span class="pill-status pill-out">Out of stock</span>')).join('') : empty('All products are in stock');
    } catch (e) { /* not logged in yet or request failed - leave skeletons */ }
  }
  load(); setInterval(load, 30000);
  document.querySelectorAll('.admin-tab[data-tab="dashboard"]').forEach((b) => b.addEventListener('click', () => setTimeout(load, 50)));
  const lb = document.getElementById('loginSubmitBtn'); if (lb) lb.addEventListener('click', () => setTimeout(load, 1500));
})();
