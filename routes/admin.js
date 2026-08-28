const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { hashPassword, makeSalt, verifyPassword, makeApiKey, createSession, destroySession, tokenFromReq, requireAdmin } = require('../auth');
const { sendWhatsAppMessage } = require('../whatsapp');
const { confirmOrder, cancelOrder, setReview, clearReview } = require('../orderLogic');
const { uploadImage } = require('../storage');

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

// PUT /api/admin/password - change the admin's own login password.
// Requires the current password so a stolen/left-open session can't be
// used to lock the real owner out.
router.put('/password', async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password) return res.status(400).json({ error: 'Please enter your current password.' });
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const { rows } = await pool.query('SELECT * FROM admin_auth WHERE id=1');
    const account = rows[0];
    if (!account || !verifyPassword(current_password, account.password_hash, account.password_salt)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    const salt = makeSalt();
    const hash = hashPassword(new_password, salt);
    await pool.query('UPDATE admin_auth SET password_hash=$1, password_salt=$2 WHERE id=1', [hash, salt]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/admin/orders/history-count - how many confirmed+cancelled
// orders currently exist, for the Delete Order History confirmation UI.
router.get('/orders/history-count', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) c FROM orders WHERE status IN ('confirmed','cancelled')`);
    res.json({ count: Number(rows[0].c) });
  } catch (err) { next(err); }
});

// POST /api/admin/orders/delete-history - body: { password, confirm: 'DELETE' }
// Permanently deletes every CONFIRMED and CANCELLED order (order_items go
// too, via ON DELETE CASCADE) - orders still waiting in the Orders tab
// (status='new') are left untouched. Requires re-entering the admin login
// password plus typing DELETE, same as the DMS's own reset flow, since
// this is irreversible. Purely local to this database - it has no effect
// on the DMS's own copy of these same orders, which keeps its own history
// independently and can be cleared there separately.
router.post('/orders/delete-history', async (req, res, next) => {
  try {
    const { password, confirm } = req.body;
    if (confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE in the confirmation box.' });
    const { rows } = await pool.query('SELECT * FROM admin_auth WHERE id=1');
    const account = rows[0];
    if (!account || !verifyPassword(password || '', account.password_hash, account.password_salt)) {
      return res.status(400).json({ error: 'Password is incorrect.' });
    }
    const result = await pool.query(`DELETE FROM orders WHERE status IN ('confirmed','cancelled')`);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) { next(err); }
});

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

// POST /api/admin/upload-image - body: { data: "data:image/...;base64,...", filename }
// Takes a photo the admin panel already read into base64 and stores it in
// Supabase Storage instead, returning a public URL to save on the product
// (see storage.js for why).
router.post('/upload-image', async (req, res, next) => {
  try {
    const { data, filename } = req.body;
    if (!data) return res.status(400).json({ error: 'No image data provided.' });
    const url = await uploadImage(data, filename || 'product');
    res.json({ url });
  } catch (err) { next(err); }
});

// POST /api/admin/migrate-images - one-time cleanup: any product (or the
// store logo) still holding an old base64 image directly in the database
// gets it uploaded to Supabase Storage instead, with the column swapped
// over to the resulting URL. Safe to run more than once - anything already
// migrated (doesn't start with "data:") is simply skipped.
router.post('/migrate-images', async (req, res, next) => {
  try {
    const results = { products_migrated: 0, logo_migrated: false, errors: [] };

    const { rows: products } = await pool.query(`SELECT id, name, image, images FROM products WHERE image LIKE 'data:%'`);
    for (const p of products) {
      try {
        const url = await uploadImage(p.image, p.name || `product-${p.id}`);
        const existingImages = Array.isArray(p.images) ? p.images.filter((u) => typeof u === 'string' && !u.startsWith('data:')) : [];
        const newImages = [url, ...existingImages];
        await pool.query('UPDATE products SET image=$1, images=$2 WHERE id=$3', [url, JSON.stringify(newImages), p.id]);
        results.products_migrated++;
      } catch (e) {
        results.errors.push(`Product #${p.id}: ${e.message}`);
      }
    }

    const { rows: settingsRows } = await pool.query(`SELECT logo_image FROM store_settings WHERE id=1 AND logo_image LIKE 'data:%'`);
    if (settingsRows.length > 0) {
      try {
        const url = await uploadImage(settingsRows[0].logo_image, 'store-logo');
        await pool.query('UPDATE store_settings SET logo_image=$1 WHERE id=1', [url]);
        results.logo_migrated = true;
      } catch (e) {
        results.errors.push(`Store logo: ${e.message}`);
      }
    }

    res.json({ ok: true, ...results });
  } catch (err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try {
    const { name, packing_type, price, unit, price_carton, price_box, price_piece, image, images, description, active, category, company, in_stock } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Product ka naam likhna zaroori hai.' });
    const pt = ['single', 'carton_piece', 'carton_box_piece', 'box_piece'].includes(packing_type) ? packing_type : 'single';
    if (pt === 'single' && (!unit || !String(unit).trim())) return res.status(400).json({ error: 'Please enter a unit name (e.g. piece, kg, dozen).' });
    if (pt === 'carton_piece' && (price_carton === '' || price_piece === '' || price_carton == null || price_piece == null)) {
      return res.status(400).json({ error: 'Please enter both Carton price and Piece price.' });
    }
    if (pt === 'carton_box_piece' && [price_carton, price_box, price_piece].some((v) => v === '' || v == null)) {
      return res.status(400).json({ error: 'Please enter Carton, Box, and Piece prices.' });
    }
    if (pt === 'box_piece' && (price_box === '' || price_piece === '' || price_box == null || price_piece == null)) {
      return res.status(400).json({ error: 'Please enter both Box price and Piece price.' });
    }
    const usesCarton = pt === 'carton_piece' || pt === 'carton_box_piece';
    const usesBox = pt === 'carton_box_piece' || pt === 'box_piece';
    const imgList = Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u.trim()) : [];
    const { rows } = await pool.query(
      `INSERT INTO products (name, packing_type, price, unit, price_carton, price_box, price_piece, image, images, description, active, category, company, in_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        name.trim(), pt,
        pt === 'single' ? Number(price) || 0 : 0, pt === 'single' ? String(unit).trim() : '',
        usesCarton ? Number(price_carton) || 0 : null,
        usesBox ? Number(price_box) || 0 : null,
        pt !== 'single' ? Number(price_piece) || 0 : null,
        (imgList[0] || image || null), JSON.stringify(imgList), description || '', active !== false,
        (category || '').trim(), (company || '').trim(), in_stock !== false,
      ]
    );
    res.json({ product: rows[0] });
  } catch (err) { next(err); }
});

router.put('/products/:id', async (req, res, next) => {
  try {
    const { name, packing_type, price, unit, price_carton, price_box, price_piece, image, images, description, active, category, company, in_stock } = req.body;
    const pt = ['single', 'carton_piece', 'carton_box_piece', 'box_piece'].includes(packing_type) ? packing_type : 'single';
    if (pt === 'single' && (!unit || !String(unit).trim())) return res.status(400).json({ error: 'Please enter a unit name (e.g. piece, kg, dozen).' });
    if (pt === 'carton_piece' && (price_carton === '' || price_piece === '' || price_carton == null || price_piece == null)) {
      return res.status(400).json({ error: 'Please enter both Carton price and Piece price.' });
    }
    if (pt === 'carton_box_piece' && [price_carton, price_box, price_piece].some((v) => v === '' || v == null)) {
      return res.status(400).json({ error: 'Please enter Carton, Box, and Piece prices.' });
    }
    if (pt === 'box_piece' && (price_box === '' || price_piece === '' || price_box == null || price_piece == null)) {
      return res.status(400).json({ error: 'Please enter both Box price and Piece price.' });
    }
    const usesCarton = pt === 'carton_piece' || pt === 'carton_box_piece';
    const usesBox = pt === 'carton_box_piece' || pt === 'box_piece';
    const imgList = Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u.trim()) : [];
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, packing_type=$2, price=$3, unit=$4, price_carton=$5, price_box=$6, price_piece=$7, image=$8, images=$9, description=$10, active=$11, category=$12, company=$13, in_stock=$14 WHERE id=$15 RETURNING *`,
      [
        name || '', pt,
        pt === 'single' ? Number(price) || 0 : 0, pt === 'single' ? String(unit).trim() : '',
        usesCarton ? Number(price_carton) || 0 : null,
        usesBox ? Number(price_box) || 0 : null,
        pt !== 'single' ? Number(price_piece) || 0 : null,
        (imgList[0] || image || null), JSON.stringify(imgList), description || '', active !== false,
        (category || '').trim(), (company || '').trim(), in_stock !== false, req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product nahi mila.' });
    res.json({ product: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/admin/products/:id/stock - body: { in_stock: true|false }
// Quick toggle for the "In stock" / "Out of stock" buttons in the product
// list, without needing to open the full edit form.
router.put('/products/:id/stock', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE products SET in_stock=$1 WHERE id=$2 RETURNING *',
      [req.body.in_stock !== false, req.params.id]
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
//
// The main Orders tab only ever shows orders still awaiting a decision
// (status='new') so it doesn't pile up forever. Once the admin confirms or
// cancels an order it disappears from here and moves into History, which
// can be filtered by date/month/year.

router.get('/orders', async (req, res, next) => {
  try {
    const { rows: orders } = await pool.query(`SELECT * FROM orders WHERE status='new' ORDER BY order_date DESC`);
    const { rows: items } = await pool.query(
      `SELECT oi.* FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status='new' ORDER BY oi.id`
    );
    const byOrder = {};
    for (const it of items) { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); }
    res.json({ orders: orders.map(o => ({ ...o, items: byOrder[o.id] || [] })) });
  } catch (err) { next(err); }
});

// GET /api/admin/orders/history?start=2026-08-01&end=2026-08-31 - all
// confirmed or cancelled orders within an inclusive date range. With no
// range given, returns the full history.
router.get('/orders/history', async (req, res, next) => {
  try {
    const { start, end } = req.query;
    const conditions = [`status IN ('confirmed','cancelled')`];
    const params = [];
    if (start && end) {
      params.push(start, end);
      conditions.push(`order_date >= $1::date AND order_date < ($2::date + INTERVAL '1 day')`);
    }
    const { rows: orders } = await pool.query(
      `SELECT * FROM orders WHERE ${conditions.join(' AND ')} ORDER BY order_date DESC`, params
    );
    const orderIds = orders.map(o => o.id);
    let items = [];
    if (orderIds.length > 0) {
      const r = await pool.query(`SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id`, [orderIds]);
      items = r.rows;
    }
    const byOrder = {};
    for (const it of items) { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); }
    res.json({ orders: orders.map(o => ({ ...o, items: byOrder[o.id] || [] })) });
  } catch (err) { next(err); }
});

// PUT /api/admin/orders/:id/confirm - body (optional): { items: [{ id, confirmed_quantity }] }
// Leave items out (or leave any item unlisted) to confirm it exactly as
// ordered. List an item with a different confirmed_quantity to send less
// than what was ordered - the response's `altered` flag and `whatsapp`
// object (present only when something actually changed) let the caller
// offer a ready-made "here's what we can actually send you" WhatsApp
// message to forward to the customer.
router.put('/orders/:id/confirm', async (req, res, next) => {
  try {
    const result = await confirmOrder(req.params.id, req.body.items || [], 'admin');
    if (!result) return res.status(404).json({ error: 'Order not found.' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/orders/:id/cancel', async (req, res, next) => {
  try {
    const order = await cancelOrder(req.params.id, 'admin');
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true, order });
  } catch (err) { next(err); }
});

// PUT /api/admin/orders/:id/set-review - body: { items: [{ id, review_quantity }] }
// Marks the order "under review": doesn't touch status, just records what
// was proposed to the customer so both the Admin Portal and the DMS show
// the same "under review" box with the same numbers, from here until
// someone actually confirms or cancels it.
router.put('/orders/:id/set-review', async (req, res, next) => {
  try {
    const result = await setReview(req.params.id, req.body.items || []);
    if (!result) return res.status(404).json({ error: 'Order not found.' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/admin/orders/:id/clear-review - discard a pending review without confirming/cancelling.
router.put('/orders/:id/clear-review', async (req, res, next) => {
  try {
    const order = await clearReview(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true, order });
  } catch (err) { next(err); }
});

// ---- Dashboard (simple sales snapshot) ----
// GET /api/admin/dashboard?start=2026-08-01&end=2026-08-31 - stats for an
// inclusive date range (Today / a specific date / a month / a year, from
// the admin panel's period filter). With no range given, falls back to the
// last 30 days. "Pending orders" is always a live, unfiltered count - it's
// today's workload, not history.
router.get('/dashboard', async (req, res, next) => {
  try {
    const { start, end } = req.query;
    const hasRange = start && end;
    const dateCond = hasRange
      ? `order_date >= $1::date AND order_date < ($2::date + INTERVAL '1 day')`
      : `order_date >= NOW() - INTERVAL '30 days'`;
    const rangeParams = hasRange ? [start, end] : [];

    const { rows: totals } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='new') AS pending_orders,
        COUNT(*) FILTER (WHERE status='confirmed' AND ${dateCond}) AS confirmed_count,
        COUNT(*) FILTER (WHERE status='cancelled' AND ${dateCond}) AS cancelled_count
      FROM orders
    `, rangeParams);
    const { rows: revenue } = await pool.query(`
      SELECT COALESCE(SUM(oi.price * COALESCE(oi.confirmed_quantity, oi.quantity)), 0) AS total
      FROM order_items oi JOIN orders o ON oi.order_id = o.id
      WHERE o.status='confirmed' AND ${dateCond.replace(/order_date/g, 'o.order_date')}
    `, rangeParams);
    const { rows: topProducts } = await pool.query(`
      SELECT oi.product_name, SUM(COALESCE(oi.confirmed_quantity, oi.quantity)) AS total_qty
      FROM order_items oi JOIN orders o ON oi.order_id = o.id
      WHERE o.status='confirmed' AND ${dateCond.replace(/order_date/g, 'o.order_date')}
      GROUP BY oi.product_name ORDER BY total_qty DESC LIMIT 5
    `, rangeParams);
    res.json({
      pending_orders: Number(totals[0].pending_orders),
      confirmed_count: Number(totals[0].confirmed_count),
      cancelled_count: Number(totals[0].cancelled_count),
      revenue: Number(revenue[0].total),
      top_products: topProducts,
    });
  } catch (err) { next(err); }
});

// ---- Customers ----

router.get('/customers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.shop_name, c.phone, c.whatsapp, c.address, c.customer_type, c.blocked,
        c.pending_deletion, c.deletion_requested_at,
        COUNT(o.id) AS order_count
      FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
      GROUP BY c.id ORDER BY c.id DESC
    `);
    res.json({ customers: rows });
  } catch (err) { next(err); }
});

router.put('/customers/:id/block', async (req, res, next) => {
  try {
    await pool.query('UPDATE customers SET blocked=$1 WHERE id=$2', [req.body.blocked !== false, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Delete a customer (mandatory 48-hour cool-off, see db.js) ----

// Step 1: start the 48-hour countdown. Can be called again to just refresh
// the timestamp (rare - the UI never needs to, but it's harmless).
router.put('/customers/:id/schedule-delete', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE customers SET pending_deletion=true, deletion_requested_at=NOW() WHERE id=$1 RETURNING id, pending_deletion, deletion_requested_at',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer nahi mila.' });
    res.json({ customer: rows[0] });
  } catch (err) { next(err); }
});

// Cancel a pending deletion - available at any point, before or after the
// 48 hours have passed.
router.put('/customers/:id/cancel-delete', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE customers SET pending_deletion=false, deletion_requested_at=NULL WHERE id=$1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer nahi mila.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Step 2: the actual delete. Rejected unless a deletion was requested AND
// at least 48 hours have passed - enforced here, not just in the UI, so
// there's never a way to skip the cool-off. Removes the customer, which
// cascades to their orders/order_items/favorites/reviews; their order ids
// are tombstoned first so the DMS app's own next sync clears its copy too.
router.delete('/customers/:id', async (req, res, next) => {
  try {
    const { rows: found } = await pool.query(
      'SELECT id, pending_deletion, deletion_requested_at FROM customers WHERE id=$1',
      [req.params.id]
    );
    const customer = found[0];
    if (!customer) return res.status(404).json({ error: 'Customer nahi mila.' });
    if (!customer.pending_deletion || !customer.deletion_requested_at) {
      return res.status(400).json({ error: 'Deletion pehle schedule karein - "Delete customer" par tap karein.' });
    }
    const readyAt = new Date(customer.deletion_requested_at).getTime() + 48 * 60 * 60 * 1000;
    if (Date.now() < readyAt) {
      return res.status(400).json({ error: '48 hours abhi poore nahi huay - is dauran sirf cancel kiya ja sakta hai.' });
    }

    const { rows: orderIds } = await pool.query('SELECT id FROM orders WHERE customer_id=$1', [req.params.id]);
    if (orderIds.length) {
      await pool.query(
        `INSERT INTO deleted_order_ids (order_id, deleted_at)
         SELECT unnest($1::int[]), NOW() ON CONFLICT (order_id) DO NOTHING`,
        [orderIds.map((r) => r.id)]
      );
    }
    await pool.query('DELETE FROM customers WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Broadcast (send one message to every customer on WhatsApp) ----
//
// If WHATSAPP_TOKEN/WHATSAPP_PHONE_ID are configured (see whatsapp.js),
// this sends the message straight away via the Meta Cloud API. Either way
// it always returns the full customer list with a ready-made wa.me link
// per person, so the admin panel can show a "Send" WhatsApp button for
// anyone who wasn't auto-delivered (or for every customer, if the API
// isn't set up at all yet) - exactly like the existing password-reset
// WhatsApp buttons.
router.post('/broadcast', async (req, res, next) => {
  try {
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Please write a message first.' });

    const { rows: customers } = await pool.query(
      `SELECT id, name, whatsapp FROM customers WHERE blocked=false AND whatsapp IS NOT NULL AND whatsapp <> '' ORDER BY id`
    );

    const configured = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
    const results = [];
    for (const c of customers) {
      let sent = false;
      if (configured) {
        try { sent = await sendWhatsAppMessage(c.whatsapp, message); }
        catch (e) { console.error('[broadcast] failed for', c.whatsapp, e.message); }
      }
      results.push({ customer_id: c.id, name: c.name, whatsapp: c.whatsapp, sent });
    }
    res.json({ configured, total: customers.length, sent_count: results.filter(r => r.sent).length, results });
  } catch (err) { next(err); }
});

// ---- Reviews (moderation) ----

router.get('/reviews', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, p.name AS product_name
      FROM reviews r LEFT JOIN products p ON p.id = r.product_id
      ORDER BY r.created_at DESC LIMIT 300
    `);
    res.json({ reviews: rows });
  } catch (err) { next(err); }
});

router.delete('/reviews/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM reviews WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Hide/unhide - keeps the review on record but drops it from the
// storefront and from the average-rating calculation until unhidden.
router.put('/reviews/:id/hide', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE reviews SET hidden=$1 WHERE id=$2 RETURNING id, hidden',
      [req.body.hidden !== false, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Review nahi mila.' });
    res.json({ review: rows[0] });
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

// ---- Stock Alerts ("notify me when back in stock" requests) ----

router.get('/stock-notify-requests', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.*, p.name AS product_name, p.in_stock AS product_in_stock
      FROM stock_notify_requests n LEFT JOIN products p ON p.id = n.product_id
      ORDER BY n.notified ASC, (p.in_stock = true) DESC, n.created_at DESC
    `);
    res.json({ requests: rows });
  } catch (err) { next(err); }
});

router.put('/stock-notify-requests/:id/notified', async (req, res, next) => {
  try {
    await pool.query('UPDATE stock_notify_requests SET notified=$1 WHERE id=$2', [req.body.notified !== false, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/stock-notify-requests/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM stock_notify_requests WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
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
