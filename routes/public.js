const express = require('express');
const router = express.Router();
const { pool } = require('../db');

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
    const { rows } = await pool.query('SELECT id, name, price, unit, image, description FROM products WHERE active=true ORDER BY id');
    res.json({ products: rows });
  } catch (err) { next(err); }
});

// POST /api/orders - body:
// {
//   customer_type: 'new' | 'old',
//   customer_name, shop_name, phone, whatsapp, address,   -- shop_name/phone/address only required when 'new'
//   items: [{ product_name, quantity, unit, price }]
// }
router.post('/orders', async (req, res, next) => {
  try {
    const { customer_type, customer_name, shop_name, phone, whatsapp, address, items } = req.body;

    if (customer_type !== 'new' && customer_type !== 'old') {
      return res.status(400).json({ error: 'Bataiye aap purane customer hain ya naye.' });
    }
    if (!customer_name || !customer_name.trim()) {
      return res.status(400).json({ error: 'Naam likhna zaroori hai.' });
    }
    if (!whatsapp || !whatsapp.trim()) {
      return res.status(400).json({ error: 'WhatsApp number likhna zaroori hai.' });
    }
    if (customer_type === 'new' && (!shop_name || !phone || !address)) {
      return res.status(400).json({ error: 'Naye customer ke liye shop ka naam, phone number, aur address zaroori hai.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart khali hai - pehle kuch products add karein.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(
        `INSERT INTO orders (customer_type, customer_name, shop_name, phone, whatsapp, address, status)
         VALUES ($1,$2,$3,$4,$5,$6,'new') RETURNING id`,
        [customer_type, customer_name.trim(), (shop_name || '').trim(), (phone || '').trim(), whatsapp.trim(), (address || '').trim()]
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
