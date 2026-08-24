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
// useful here than a stable order, so plain id order.
router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name, price, unit, unit_2, price_2, image, description FROM products WHERE active=true ORDER BY id');
    res.json({ products: rows });
  } catch (err) { next(err); }
});

// POST /api/orders - requires login now (see routes/customers.js). The
// shopper's identity is always pulled fresh from their saved account
// server-side rather than trusted from the request body - a logged-in
// shopper never has to retype their details on every order again.
// body: { items: [{ product_name, quantity, unit, price }] }
router.post('/orders', requireCustomer, async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty - add some products first.' });
    }

    const { rows: cRows } = await pool.query('SELECT * FROM customers WHERE id=$1', [req.customerId]);
    const customer = cRows[0];
    if (!customer) return res.status(404).json({ error: 'Account not found.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(
        `INSERT INTO orders (customer_id, customer_type, customer_name, shop_name, phone, whatsapp, address, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'new') RETURNING id`,
        [customer.id, customer.customer_type, customer.name, customer.shop_name, customer.phone, customer.whatsapp, customer.address]
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
