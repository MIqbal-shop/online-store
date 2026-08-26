const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { confirmOrder, cancelOrder } = require('../orderLogic');

// Shared by every route below: Authorization: Bearer <api_key>, the same
// key shown on this site's Admin -> Settings page and pasted into the
// DMS's Settings -> Online Store field.
async function checkApiKey(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const { rows } = await pool.query('SELECT api_key FROM admin_auth WHERE id=1');
  const apiKey = rows[0]?.api_key;
  return !!apiKey && token === apiKey;
}

// GET /api/orders/feed - called periodically by the DMS (see its
// backend/routes/onlineOrders.js /sync).
//
// Always returns the last 60 days of orders, not just "new since last
// call" - order volume here is tiny (a handful a day), so resending
// everything recent is cheap, and it means the DMS side (which dedupes by
// id and only re-applies real status changes) never needs this endpoint to
// track per-caller sync state. Simpler and harder to get wrong.
//
// Each item now also carries its own `id` (order_items.id on this side) -
// the DMS keeps that as remote_item_id so that when IT confirms an order
// with adjusted quantities, it knows exactly which item to update here,
// and confirmed_quantity (null until the order has been confirmed by
// either side), and each order carries altered/
// confirmed_via/confirmed_at - so if the Admin Portal confirmed an order
// with a reduced quantity, the DMS sees that adjustment on its very next
// sync, same as it would see a plain confirm.
router.get('/', async (req, res, next) => {
  try {
    if (!(await checkApiKey(req))) return res.status(401).json({ error: 'Invalid API key' });

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
        altered: o.altered,
        confirmed_via: o.confirmed_via,
        confirmed_at: o.confirmed_at,
        items: (byOrder[o.id] || []).map(it => ({
          id: it.id, product_name: it.product_name, quantity: it.quantity, unit: it.unit, price: it.price,
          confirmed_quantity: it.confirmed_quantity,
        })),
      })),
    });
  } catch (err) { next(err); }
});

// PUT /api/orders/feed/:id/confirm - lets the DMS app confirm an order
// itself (with the same optional per-item quantity adjustments the Admin
// Portal supports - body: { items: [{ id, confirmed_quantity }] }). Writes
// straight to the same orders/order_items table the Admin Portal reads, so
// the order shows as confirmed there immediately too - no separate "sync
// back" step needed.
router.put('/:id/confirm', async (req, res, next) => {
  try {
    if (!(await checkApiKey(req))) return res.status(401).json({ error: 'Invalid API key' });
    const result = await confirmOrder(req.params.id, req.body.items || [], 'dms');
    if (!result) return res.status(404).json({ error: 'Order not found.' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/orders/feed/:id/cancel - same idea for cancelling from the DMS.
router.put('/:id/cancel', async (req, res, next) => {
  try {
    if (!(await checkApiKey(req))) return res.status(401).json({ error: 'Invalid API key' });
    const order = await cancelOrder(req.params.id, 'dms');
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true, order });
  } catch (err) { next(err); }
});

module.exports = router;
