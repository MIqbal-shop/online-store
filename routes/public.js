const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireCustomer } = require('../auth');

// GET /api/store-info - branding shown on the storefront (name, tagline,
// logo). Public because the storefront itself needs it before any login.
router.get('/store-info', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT store_name, tagline, logo_image FROM store_settings WHERE id=1');
    res.json({ store: rows[0] || { store_name: 'IQBAL TRADER', tagline: '', logo_image: null } });
  } catch (err) { next(err); }
});

// GET /api/products - only what's marked active, newest first is less
// useful here than a stable order, so plain id order. Out-of-stock items
// still show (so the shop doesn't look shorter than it is) but come
// through flagged so the storefront can grey them out and block ordering.
router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name, packing_type, price, unit, price_carton, price_box, price_piece, image, description, in_stock, category, company FROM products WHERE active=true ORDER BY id');
    res.json({ products: rows });
  } catch (err) { next(err); }
});

// POST /api/orders - requires login now (see routes/customers.js). The
// shopper's identity is always pulled fresh from their saved account
// server-side rather than trusted from the request body - a logged-in
// shopper never has to retype their details on every order again.
// body: { items: [{ product_name, quantity, unit, price }], note }
router.post('/orders', requireCustomer, async (req, res, next) => {
  try {
    const { items, note } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty - add some products first.' });
    }

    const { rows: cRows } = await pool.query('SELECT * FROM customers WHERE id=$1', [req.customerId]);
    const customer = cRows[0];
    if (!customer) return res.status(404).json({ error: 'Account not found.' });
    if (customer.blocked) return res.status(403).json({ error: 'Your account has been disabled. Please contact us.' });

    const outOfStock = await pool.query(
      `SELECT name FROM products WHERE in_stock = FALSE AND name = ANY($1::text[])`,
      [items.map((it) => it.product_name || '')]
    );
    if (outOfStock.rows.length > 0) {
      return res.status(400).json({ error: `Some items in your cart are out of stock: ${outOfStock.rows.map(r => r.name).join(', ')}. Please remove them and try again.` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(
        `INSERT INTO orders (customer_id, customer_type, customer_name, shop_name, phone, whatsapp, address, status, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8) RETURNING id`,
        [customer.id, customer.customer_type, customer.name, customer.shop_name, customer.phone, customer.whatsapp, customer.address, (note || '').trim()]
      );
      const orderId = orderResult.rows[0].id;
      for (const it of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_name, quantity, unit, price) VALUES ($1,$2,$3,$4,$5)`,
          [orderId, it.product_name || '', Number(it.quantity) || 0, it.unit || '', Number(it.price) || 0]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, orderId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ---- Reviews (ratings/feedback) ----
// Public to READ (so shoppers can see what others think before ordering,
// even before logging in isn't possible here since the whole site is
// gated - but no harm keeping these open). Posting a review still
// requires a logged-in account, same as placing an order.

// GET /api/reviews/summary - average rating + count per product, one query
// for the whole storefront so product tiles can show stars without an
// extra request per product.
router.get('/reviews/summary', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT product_id, ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS count
       FROM reviews WHERE target_type='product' AND product_id IS NOT NULL AND hidden=false
       GROUP BY product_id`
    );
    const summary = {};
    for (const r of rows) summary[r.product_id] = { avg_rating: Number(r.avg_rating), count: Number(r.count) };
    res.json({ summary });
  } catch (err) { next(err); }
});

// GET /api/reviews?product_id=5  OR  /api/reviews?general=1
router.get('/reviews', async (req, res, next) => {
  try {
    const { product_id, general } = req.query;
    let rows;
    if (general) {
      ({ rows } = await pool.query(
        `SELECT * FROM reviews WHERE target_type='general' AND hidden=false ORDER BY created_at DESC LIMIT 200`
      ));
    } else if (product_id) {
      ({ rows } = await pool.query(
        `SELECT * FROM reviews WHERE target_type='product' AND product_id=$1 AND hidden=false ORDER BY created_at DESC LIMIT 200`,
        [product_id]
      ));
    } else {
      return res.status(400).json({ error: 'product_id or general is required.' });
    }
    res.json({ reviews: rows });
  } catch (err) { next(err); }
});

// POST /api/reviews - body: { target_type: 'product'|'general', product_id, rating, comment }
// Submitting again (same customer, same product / same general target)
// updates their existing review instead of creating a duplicate.
router.post('/reviews', requireCustomer, async (req, res, next) => {
  try {
    const { target_type, product_id, rating, comment } = req.body;
    const type = target_type === 'general' ? 'general' : 'product';
    const rNum = Number(rating);
    if (!rNum || rNum < 1 || rNum > 5) return res.status(400).json({ error: 'Please choose a rating from 1 to 5 stars.' });
    if (type === 'product' && !product_id) return res.status(400).json({ error: 'Missing product.' });

    const { rows: cRows } = await pool.query('SELECT name FROM customers WHERE id=$1', [req.customerId]);
    const customerName = cRows[0]?.name || 'Customer';
    const params = [type, type === 'product' ? product_id : null, req.customerId, customerName, rNum, (comment || '').trim()];

    // Two separate partial unique indexes (one per target_type), so the
    // ON CONFLICT inference clause has to be picked per-type rather than
    // shared - Postgres matches it against the index predicate literally.
    const upsertSql = type === 'product'
      ? `INSERT INTO reviews (target_type, product_id, customer_id, customer_name, rating, comment)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (customer_id, product_id) WHERE target_type='product'
         DO UPDATE SET rating=$5, comment=$6, customer_name=$4, created_at=NOW()
         RETURNING *`
      : `INSERT INTO reviews (target_type, product_id, customer_id, customer_name, rating, comment)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (customer_id) WHERE target_type='general'
         DO UPDATE SET rating=$5, comment=$6, customer_name=$4, created_at=NOW()
         RETURNING *`;
    const { rows } = await pool.query(upsertSql, params);
    res.json({ review: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/reviews/:id - a customer can remove their own review.
router.delete('/reviews/:id', requireCustomer, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM reviews WHERE id=$1 AND customer_id=$2', [req.params.id, req.customerId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
