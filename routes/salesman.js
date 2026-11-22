const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const router = express.Router();

// Salesman mobile app backend. This server is only a "post-box": the DMS
// pushes snapshots (stock, customers, sales...) here and pulls submitted
// items (sales, requests, payments) back, see salesmanSync.js in the DMS.
// Only NEW tables (sm_*) are created; no existing table is touched.
const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS sm_accounts (id INTEGER PRIMARY KEY, name TEXT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT);
  CREATE TABLE IF NOT EXISTS sm_snapshot (salesman_id INTEGER, kind TEXT, data JSONB, updated_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (salesman_id, kind));
  ALTER TABLE sm_accounts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'salesman';
  CREATE TABLE IF NOT EXISTS sm_outbox (id SERIAL PRIMARY KEY, salesman_id INTEGER, type TEXT, payload JSONB, client_ref TEXT UNIQUE, status TEXT DEFAULT 'new', result JSONB, created_at TIMESTAMP DEFAULT NOW());
`).catch((e) => console.error('sm tables:', e.message));

async function apiKey() {
  const { rows } = await pool.query('SELECT api_key FROM admin_auth WHERE id=1');
  return rows[0] && rows[0].api_key;
}
const sign = (p, key) => p + '.' + crypto.createHmac('sha256', key + ':sm').update(p).digest('hex');
async function feedAuth(req, res, next) {
  try {
    const k = await apiKey(), t = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!k || t !== k) return res.status(401).json({ error: 'Invalid API key' });
    await ready; next();
  } catch (e) { next(e); }
}
async function smAuth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '').trim(), i = t.lastIndexOf('.');
    const k = await apiKey();
    if (i < 0 || !k || sign(t.slice(0, i), k) !== t) return res.status(401).json({ error: 'Login dobara karein.' });
    const d = JSON.parse(Buffer.from(t.slice(0, i), 'base64url').toString());
    if (d.exp < Date.now()) return res.status(401).json({ error: 'Login dobara karein.' });
    req.sm = d; await ready; next();
  } catch (e) { res.status(401).json({ error: 'Login dobara karein.' }); }
}

// ---- Salesman app ----
const tries = new Map();
router.post('/login', async (req, res, next) => {
  try {
    await ready;
    const u = String(req.body.username || '').trim().toLowerCase(), key = req.ip + u;
    const t = (tries.get(key) || []).filter((x) => Date.now() - x < 600000);
    if (t.length >= 8) return res.status(429).json({ error: 'Bohat koshishein. 10 minute baad try karein.' });
    const { rows } = await pool.query('SELECT * FROM sm_accounts WHERE lower(username)=$1', [u]);
    const a = rows[0];
    const ok = a && (() => {
      const x = Buffer.from(crypto.scryptSync(String(req.body.password || ''), a.password_salt, 64).toString('hex'), 'hex'), y = Buffer.from(a.password_hash, 'hex');
      return x.length === y.length && crypto.timingSafeEqual(x, y);
    })();
    if (!ok) { t.push(Date.now()); tries.set(key, t); return res.status(401).json({ error: 'Username ya password ghalat hai.' }); }
    const role = a.role === 'manager' ? 'manager' : 'salesman';
    const want = req.body.role === 'manager' ? 'manager' : req.body.role === 'salesman' ? 'salesman' : null;
    if (want && want !== role) return res.status(403).json({ error: role === 'manager' ? 'Yeh Manager ka account hai. Wapas ja kar "Manager" chunein.' : 'Yeh Salesman ka account hai. Wapas ja kar "Salesman" chunein.' });
    const p = Buffer.from(JSON.stringify({ id: a.id, role, exp: Date.now() + 30 * 864e5 })).toString('base64url');
    res.json({ token: sign(p, await apiKey()), name: a.name, role });
  } catch (e) { next(e); }
});

router.get('/me/data', smAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT kind, data, updated_at FROM sm_snapshot WHERE salesman_id IN ($1, 0) AND kind <> \'biz\'', [req.sm.id]);
    const out = {};
    rows.forEach((r) => { out[r.kind] = { data: r.data, updated_at: r.updated_at }; });
    const ob = await pool.query("SELECT id, type, payload, status, CASE WHEN type='report' THEN NULL ELSE result END AS result, created_at FROM sm_outbox WHERE salesman_id=$1 ORDER BY id DESC LIMIT 40", [req.sm.id]);
    res.json({ kinds: out, outbox: ob.rows });
  } catch (e) { next(e); }
});

router.post('/submit', smAuth, async (req, res, next) => {
  try {
    const { type, payload, client_ref } = req.body;
    const allowed = req.sm.role === 'manager' ? ['confirm_sale', 'reject_sale', 'req_approve', 'req_reject', 'm_customer', 'm_payment', 'm_sale', 'm_return', 'report'] : ['sale', 'request', 'payment'];
    if (!allowed.includes(type) || !payload || !client_ref) return res.status(400).json({ error: 'Galat data.' });
    if (type === 'report') await pool.query("DELETE FROM sm_outbox WHERE type='report' AND created_at < NOW() - INTERVAL '1 hour'");
    const ins = await pool.query('INSERT INTO sm_outbox (salesman_id, type, payload, client_ref) VALUES ($1,$2,$3,$4) ON CONFLICT (client_ref) DO NOTHING RETURNING id', [req.sm.id, type, payload, String(client_ref)]);
    res.json({ ok: true, id: ins.rows[0] && ins.rows[0].id });
  } catch (e) { next(e); }
});

// Business name + logo for the PDF letterhead (kept out of /me/data because the logo is large).
router.get('/biz', smAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT data FROM sm_snapshot WHERE salesman_id=0 AND kind='biz'");
    res.json(rows[0] ? rows[0].data : {});
  } catch (e) { next(e); }
});

// Result of a report the manager asked for (the DMS runs it and sends it back).
router.get('/result/:id', smAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT status, result FROM sm_outbox WHERE id=$1 AND salesman_id=$2', [Number(req.params.id) || 0, req.sm.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Nahi mila.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Manager only: customers who signed up on the website and have not yet entered
// their phone-verification code (same list the DMS Verifications page shows).
// Read straight from this site's own database, so it works with the laptop off.
router.get('/m/verifications', smAuth, async (req, res, next) => {
  try {
    if (req.sm.role !== 'manager') return res.status(403).json({ error: 'Sirf Manager ke liye.' });
    const { rows } = await pool.query(`SELECT id, name, shop_name, whatsapp, phone, verification_code, verification_expires_at,
      (verification_expires_at < NOW()) AS expired FROM customers WHERE verified = FALSE AND verification_code IS NOT NULL ORDER BY id DESC`);
    res.json({ customers: rows });
  } catch (e) { next(e); }
});

// ---- DMS side (same API key as the order feed) ----
router.post('/feed/sync', feedAuth, async (req, res, next) => {
  try {
    const { accounts = [], snapshots = [] } = req.body;
    for (const a of accounts) {
      await pool.query(`INSERT INTO sm_accounts (id, name, username, password_hash, password_salt, role) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name=$2, username=$3, password_hash=$4, password_salt=$5, role=$6`, [a.id, a.name, a.username, a.password_hash, a.password_salt, a.role === 'manager' ? 'manager' : 'salesman']);
    }
    await pool.query('DELETE FROM sm_accounts WHERE NOT (id = ANY($1::int[]))', [accounts.map((a) => a.id)]);
    for (const s of snapshots) {
      await pool.query(`INSERT INTO sm_snapshot (salesman_id, kind, data, updated_at) VALUES ($1,$2,$3,NOW())
        ON CONFLICT (salesman_id, kind) DO UPDATE SET data=$3, updated_at=NOW()`, [s.salesman_id, s.kind, JSON.stringify(s.data)]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.get('/feed/outbox', feedAuth, async (req, res, next) => {
  try { res.json({ items: (await pool.query("SELECT id, salesman_id, type, payload FROM sm_outbox WHERE status='new' ORDER BY id")).rows }); } catch (e) { next(e); }
});
router.put('/feed/outbox/:id/ack', feedAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE sm_outbox SET status=$1, result=$2 WHERE id=$3', [req.body.ok ? 'done' : 'failed', JSON.stringify(req.body.result || {}), req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
