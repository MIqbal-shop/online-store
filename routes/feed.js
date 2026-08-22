const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/orders/feed - called periodically by the DMS (see its
// backend/routes/onlineOrders.js /sync). Auth: Authorization: Bearer <api_key>
// (the key shown on this site's Admin -> Settings page).
//
// Always returns the last 60 days of orders, not just "new since last
// call" - order volume here is tiny (a handful a day), so resending
// everything recent is cheap, and it means the DMS side (which dedupes by
// id and only re-applies real status changes) never needs this endpoint to
// track per-caller sync state. Simpler and harder to get wrong.
router.get('/', async (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const { rows: accRows } = await pool.query('SELECT api_key FROM admin_auth WHERE id=1');
    const apiKey = accRows[0]?.api_key;
    if (!apiKey || token !== apiKey) return res.status(401).json({ error: 'Invalid API key' });

    const { rows: orders } = await pool.query(
      `SELECT * FROM orders WHERE order_date >= (NOW() - INTERVAL '60 days')::timestamp ORDER BY order_date DESC`
    );
    const { rows: items } = await pool.query(
      `SELECT oi.* FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.order_date >= (NOW() - INTERVAL '60 days')::timestamp`
    );
    const byOrder = {};
    for (const it of items) { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); }

    res.json({
      orders: orders.map(o => ({
        id: o.id,
        customer_type: o.customer_type,
        customer_name: o.customer_name,
        shop_name: o.shop_name,
        phone: o.phone,
        whatsapp: o.whatsapp,
        address: o.address,
        status: o.status,
        order_date: o.order_date,
        items: (byOrder[o.id] || []).map(it => ({ product_name: it.product_name, quantity: it.quantity, unit: it.unit, price: it.price })),
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
