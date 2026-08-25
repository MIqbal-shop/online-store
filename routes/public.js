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
    const { rows } = await pool.query('SELECT id, name, packing_type, price, unit, price_carton, price_box, price_piece, image, description, in_stock, category FROM products WHERE active=true ORDER BY id');
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

module.exports = router;
