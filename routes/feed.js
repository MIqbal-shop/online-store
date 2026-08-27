const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { confirmOrder, cancelOrder, setReview, clearReview } = require('../orderLogic');

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
// id and only re-applies real changes) never needs this endpoint to track
// per-caller sync state. Simpler and harder to get wrong.
//
// Each item carries its own `id` (order_items.id on this side) - the DMS
// keeps that as remote_item_id so that when IT confirms/reviews an order,
// it knows exactly which item to update here - plus confirmed_quantity and
// review_quantity (both null until set by either side). Each order carries
// altered/confirmed_via/confirmed_at/review_pending - so a decision (or a
// review proposal) made on either side shows up on the other's very next
// sync.
router.get('/', async (req, res, next) => {
  try {
    if (!(await checkApiKey(req))) return res.status(401).json({ error: 'Invalid API key' });

    const { rows: orders } = await pool.query(
      `SELECT * FROM orders WHERE order_date >= (NOW() - INTERVAL '60 days')::timestamp ORDER BY order_date DESC`
    );
    const { rows: items } = await pool.query(
      `SELECT oi.* FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.order_date >= (NOW() - INTERVAL '60 days')::timestamp`
    );
    // Orders removed here (a customer was deleted) within the same 60-day
    // window - the DMS diffs this against its own local copies and drops
    // any it still has, so a deleted customer's history disappears there
    // too on its very next sync.
    const { rows: deletedRows } = await pool.query(
      `SELECT order_id FROM deleted_order_ids WHERE deleted_at >= (NOW() - INTERVAL '60 days')::timestamp`
    );
    const byOrder = {};
    for (const it of items) { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); }

    res.json({
      deleted_order_ids: deletedRows.map((r) => r.order_id),
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
        review_pending: o.review_pending,
        items: (byOrder[o.id] || []).map(it => ({
          id: it.id, product_name: it.product_name, quantity: it.quantity, unit: it.unit, price: it.price,
          confirmed_quantity: it.confirmed_quantity,
          review_quantity: it.review_quantity,
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
// back" step needed. Also clears any pending review, same as the Admin
// Portal's confirm does.
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

// PUT /api/orders/feed/:id/set-review - body: { items: [{ id, review_quantity }] }
// Lets the DMS mark an order "under review" here too, so the Admin Portal
// sees the exact same proposed numbers on its very next load - not just a
// local DMS-only state.
router.put('/:id/set-review', async (req, res, next) => {
  try {
    if (!(await checkApiKey(req))) return res.status(401).json({ error: 'Invalid API key' });
    const result = await setReview(req.params.id, req.body.items || []);
    if (!result) return res.status(404).json({ error: 'Order not found.' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/orders/feed/:id/clear-review - discard a pending review from the DMS side.
router.put('/:id/clear-review', async (req, res, next) => {
  try {
    if (!(await checkApiKey(req))) return res.status(401).json({ error: 'Invalid API key' });
    const order = await clearReview(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true, order });
  } catch (err) { next(err); }
});

module.exports = router;
