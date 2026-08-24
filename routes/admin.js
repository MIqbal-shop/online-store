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
    const token = await createSession('admin');
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
    const token = await createSession('admin');
    res.json({ token });
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res) => {
  await destroySession(tokenFromReq(req));
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
    const { name, packing_type, price, unit, price_carton, price_box, price_piece, image, description, active } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Product ka naam likhna zaroori hai.' });
    const pt = ['single', 'carton_piece', 'carton_box_piece'].includes(packing_type) ? packing_type : 'single';
    if (pt === 'single' && (!unit || !String(unit).trim())) return res.status(400).json({ error: 'Please enter a unit name (e.g. piece, kg, dozen).' });
    if (pt === 'carton_piece' && (price_carton === '' || price_piece === '' || price_carton == null || price_piece == null)) {
      return res.status(400).json({ error: 'Please enter both Carton price and Piece price.' });
    }
    if (pt === 'carton_box_piece' && [price_carton, price_box, price_piece].some((v) => v === '' || v == null)) {
      return res.status(400).json({ error: 'Please enter Carton, Box, and Piece prices.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO products (name, packing_type, price, unit, price_carton, price_box, price_piece, image, description, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        name.trim(), pt,
        pt === 'single' ? Number(price) || 0 : 0, pt === 'single' ? String(unit).trim() : '',
        pt !== 'single' ? Number(price_carton) || 0 : null,
        pt === 'carton_box_piece' ? Number(price_box) || 0 : null,
        pt !== 'single' ? Number(price_piece) || 0 : null,
        image || null, description || '', active !== false,
      ]
    );
    res.json({ product: rows[0] });
  } catch (err) { next(err); }
});

router.put('/products/:id', async (req, res, next) => {
  try {
    const { name, packing_type, price, unit, price_carton, price_box, price_piece, image, description, active } = req.body;
    const pt = ['single', 'carton_piece', 'carton_box_piece'].includes(packing_type) ? packing_type : 'single';
    if (pt === 'single' && (!unit || !String(unit).trim())) return res.status(400).json({ error: 'Please enter a unit name (e.g. piece, kg, dozen).' });
    if (pt === 'carton_piece' && (price_carton === '' || price_piece === '' || price_carton == null || price_piece == null)) {
      return res.status(400).json({ error: 'Please enter both Carton price and Piece price.' });
    }
    if (pt === 'carton_box_piece' && [price_carton, price_box, price_piece].some((v) => v === '' || v == null)) {
      return res.status(400).json({ error: 'Please enter Carton, Box, and Piece prices.' });
    }
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, packing_type=$2, price=$3, unit=$4, price_carton=$5, price_box=$6, price_piece=$7, image=$8, description=$9, active=$10 WHERE id=$11 RETURNING *`,
      [
        name || '', pt,
        pt === 'single' ? Number(price) || 0 : 0, pt === 'single' ? String(unit).trim() : '',
        pt !== 'single' ? Number(price_carton) || 0 : null,
        pt === 'carton_box_piece' ? Number(price_box) || 0 : null,
        pt !== 'single' ? Number(price_piece) || 0 : null,
        image || null, description || '', active !== false, req.params.id,
      ]
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

// ---- Password reset requests (customer clicked "Forgot password") ----
// Shown in the admin panel so the owner can copy the temp password and
// forward it to the customer on WhatsApp themselves.

router.get('/password-resets', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM password_resets ORDER BY created_at DESC LIMIT 100');
    res.json({ resets: rows });
  } catch (err) { next(err); }
});

router.put('/password-resets/:id/sent', async (req, res, next) => {
  try {
    await pool.query('UPDATE password_resets SET sent=TRUE WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
