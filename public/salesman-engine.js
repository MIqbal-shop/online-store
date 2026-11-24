/* Reports and Sales list that work without the DMS being open.
 *
 * The DMS sends a cleaned copy of its data (reports tables only, no logins) to the website
 * whenever it is open. This file downloads that copy onto the phone and runs the DMS's OWN report
 * code (vendor/dms-reports.js = backend/routes/reports.js, unchanged) on it using SQLite compiled
 * to WebAssembly (vendor/sql-wasm.*). Same code, same data => the same numbers as the DMS. */
(function (root) {
  const SALES_SQL = 'SELECT s.*, c.shop_name, sm.name as salesman_name FROM sales s LEFT JOIN customers c ON s.customer_id = c.id LEFT JOIN salesmen sm ON s.salesman_id = sm.id ORDER BY s.sale_date DESC, s.id DESC';
  const ITEMS_SQL = 'SELECT si.*, pr.name as product_name FROM sale_items si LEFT JOIN products pr ON si.product_id = pr.id WHERE sale_id=?';

  function createEngine(SQL, reportsSrc, roundSrc) {
    let cur = null, sdb = null;
    const adapt = (d) => ({
      prepare(sql) {
        const stmt = (p) => { const st = d.prepare(sql); if (p.length) st.bind(p.map((v) => (v === undefined ? null : v))); return st; };
        return {
          all: (...p) => { const st = stmt(p), out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; },
          get: (...p) => { const st = stmt(p), r = st.step() ? st.getAsObject() : undefined; st.free(); return r; },
          run: () => { throw new Error('read-only copy'); },
        };
      },
      exec: () => { throw new Error('read-only copy'); },
    });
    const load = (src, req) => { const m = { exports: {} }; new Function('require', 'module', 'exports', src)(req, m, m.exports); return m.exports; };
    const round = load(roundSrc, () => { throw new Error('no require'); });
    const dbProxy = { prepare: (sql) => cur.prepare(sql) };
    const routes = {}, router = { get: (p, fn) => { routes[p] = fn; }, post() {}, put() {}, delete() {} };
    load(reportsSrc, (n) => (n === 'express' ? { Router: () => router } : n === '../db' ? dbProxy : n === '../round' ? round : (() => { throw new Error('require ' + n); })()));
    return {
      open(bytes) { if (sdb) sdb.close(); sdb = new SQL.Database(bytes); cur = adapt(sdb); },
      report(name, query) {
        const fn = routes['/' + name]; if (!fn) throw new Error('Unknown report');
        let out; fn({ query: query || {} }, { json: (x) => { out = x; }, status() { return this; } });
        if (out && out.error) throw new Error(out.error);
        return JSON.parse(JSON.stringify(out));
      },
      salesList(start, end) { // the DMS Sales page: every sale in the range, with its items
        const rows = cur.prepare(SALES_SQL).all().filter((s) => { const d = String(s.sale_date || '').slice(0, 10); return d >= start && d <= end; }).slice(0, 500);
        return {
          start, end,
          rows: rows.map((s) => ({
            id: s.id, invoice_number: s.invoice_number, sale_date: s.sale_date, shop_name: s.shop_name, salesman_name: s.salesman_name,
            total_amount: s.total_amount, received_amount: s.received_amount, remaining_amount: s.remaining_amount, profit: s.profit,
            items: cur.prepare(ITEMS_SQL).all(s.id).map((i) => ({ product_name: i.product_name, unit_type: i.unit_type, quantity: i.quantity, selling_price: i.selling_price, discount: i.discount, total: i.total, profit: i.profit })),
          })),
        };
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createEngine };
  if (!root.document) return;

  // ---- Browser side: download the data copy, keep it on the phone, open it ----
  let ENG = null, opened = '', info = null;
  const add = (src) => new Promise((ok, no) => { const t = document.createElement('script'); t.src = src; t.onload = ok; t.onerror = () => no(new Error('Reports ki files load nahi hui.')); document.head.appendChild(t); });
  const idb = () => new Promise((ok, no) => { const r = indexedDB.open('sm-data', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const idbGet = async (k) => { try { const d = await idb(); return await new Promise((ok) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } catch (e) { return null; } };
  const idbPut = async (k, v) => { try { const d = await idb(); await new Promise((ok) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch (e) { /* cache only */ } };
  const gunzip = (buf) => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();

  async function ensure(token) {
    if (!ENG) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Is phone ke browser mein reports nahi chal sakti. Chrome update karein.');
      await add('/vendor/sql-wasm.js');
      const SQL = await root.initSqlJs({ locateFile: (f) => '/vendor/' + f });
      const [rep, rnd] = await Promise.all([fetch('/vendor/dms-reports.js').then((r) => r.text()), fetch('/vendor/dms-round.js').then((r) => r.text())]);
      ENG = createEngine(SQL, rep, rnd);
    }
    let c = await idbGet('db');
    const H = { headers: { Authorization: 'Bearer ' + token } };
    if (navigator.onLine) {
      try {
        const vr = await fetch('/api/salesman/m/db/version', H), v = await vr.json();
        if (!vr.ok) { if (!c) throw new Error(v.error || 'Data abhi tayyar nahi.'); }
        else if (!c || c.sig !== v.sig) {
          const dr = await fetch('/api/salesman/m/db', H); if (!dr.ok) throw new Error('Data download nahi hua.');
          c = { sig: v.sig, updated_at: v.updated_at, bytes: new Uint8Array(await gunzip(await dr.arrayBuffer())) };
          await idbPut('db', c);
        }
      } catch (e) { if (!c) throw e; }
    }
    if (!c) throw new Error('Pehli baar internet chahiye taake data phone mein aa jaye.');
    if (opened !== c.sig) { ENG.open(c.bytes); opened = c.sig; }
    info = { sig: c.sig, updated_at: c.updated_at };
    return info;
  }
  root.SME = { ensure, info: () => info, report: (n, q) => ENG.report(n, q), salesList: (s, e) => ENG.salesList(s, e) };
})(typeof window !== 'undefined' ? window : globalThis);
