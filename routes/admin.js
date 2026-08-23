const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { hashPassword, makeSalt, verifyPassword, makeApiKey, createSession, destroySession, tokenFromReq, requireAdmin } = require('../auth');

// GET /api/admin/setup-status - the admin panel checks this first to decide
// whether to show "create your account" or the normal login form.
router.get('/setup-status', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id FROM admin_auth WHERE id=1');
    res.json({ needsSetup: rows.length === 0 });
  } catch (err) { next(err); }
});

// POST /api/admin/setup - one-time only, body: { username, password }.
// Refuses if an account already exists (use /login after that).
router.post('/setup', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username aur kam se kam 6 characters ka password zaroori hai.' });
    }
    const existing = await pool.query('SELECT id FROM admin_auth WHERE id=1');
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Account pehle hi ban chuka hai - Login karein.' });
    }
    const salt = makeSalt();
    const hash = hashPassword(password, salt);
    const apiKey = makeApiKey();
    await pool.query(
      'INSERT INTO admin_auth (id, username, password_hash, password_salt, api_key) VALUES (1,$1,$2,$3,$4)',
      [username.trim(), hash, salt, apiKey]
    );
    const token = createSession();
    res.json({ token });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM admin_auth WHERE id=1');
    const account = rows[0];
    if (!account || account.username !== (username || '').trim() || !verifyPassword(password || '', account.password_hash, account.password_salt)) {
      return res.status(401).json({ error: 'Username ya password ghalat hai.' });
    }
    const token = createSession();
    res.json({ token });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  destroySession(tokenFromReq(req));
  res.json({ ok: true });
});

router.use(requireAdmin);

// ---- Store branding (name, tagline, logo) ----

router.put('/store-info', async (req, res, next) => {
  try {
    const { store_name, tagline, logo_image } = req.body;
    if (!store_name || !store_name.trim()) return res.status(400).json({ error: 'Store name is required.' });
    await pool.query(
      `UPDATE store_settings SET store_name=$1, tagline=$2, logo_image=$3 WHERE id=1`,
      [store_name.trim(), tagline || '', logo_image || null]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Products (admin manages its own catalogue, independent of the DMS) ----

router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json({ products: rows });
  } catch (err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try {
    const { name, price, unit, image, description, active } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Product ka naam likhna zaroori hai.' });
    const { rows } = await pool.query(
      `INSERT INTO products (name, price, unit, image, description, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), Number(price) || 0, unit || '', image || null, description || '', active !== false]
    );
    res.json({ product: rows[0] });
  } catch (err) { next(err); }
});

router.put('/products/:id', async (req, res, next) => {
  try {
    const { name, price, unit, image, description, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, price=$2, unit=$3, image=$4, description=$5, active=$6 WHERE id=$7 RETURNING *`,
      [name || '', Number(price) || 0, unit || '', image || null, description || '', active !== false, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product nahi mila.' });
    res.json({ product: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Orders (admin's own view - the DMS separately pulls a copy via /feed) ----

router.get('/orders', async (req, res, next) => {
  try {
    const { rows: orders } = await pool.query('SELECT * FROM orders ORDER BY order_date DESC');
    const { rows: items } = await pool.query('SELECT * FROM order_items ORDER BY id');
    const byOrder = {};
    for (const it of items) { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); }
    res.json({ orders: orders.map(o => ({ ...o, items: byOrder[o.id] || [] })) });
  } catch (err) { next(err); }
});

router.put('/orders/:id/cancel', async (req, res, next) => {
  try {
    await pool.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- API key (this is what gets pasted into the DMS's Settings -> Online Store) ----

router.get('/api-key', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT api_key FROM admin_auth WHERE id=1');
    res.json({ api_key: rows[0]?.api_key || '' });
  } catch (err) { next(err); }
});

router.post('/api-key/regenerate', async (req, res, next) => {
  try {
    const newKey = makeApiKey();
    await pool.query('UPDATE admin_auth SET api_key=$1 WHERE id=1', [newKey]);
    res.json({ api_key: newKey });
  } catch (err) { next(err); }
});

module.exports = router;
