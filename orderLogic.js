const { pool } = require('./db');

// ============================================================================
// Confirming / cancelling an order, shared by:
//   - routes/admin.js   (Admin Portal buttons, session auth)
//   - routes/feed.js    (DMS app, api_key auth)
//
// Both write to the SAME orders/order_items table in the SAME database, so
// whichever side confirms or cancels an order first is simply what sticks -
// the other side sees the updated status/quantities the next time it reads
// (Admin Portal on its next page load, DMS on its next periodic sync pull).
// That's what keeps the two "in sync" without any special messaging between
// the two apps - there's one source of truth, and two front doors to it.
// ============================================================================

// money() only used for building the WhatsApp text below.
function money(n) {
  return 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

function buildChangeNoticeMessage({ storeName, customerName, orderedLines, confirmedLines, total }) {
  return (
    `Assalam o Alaikum ${customerName}!\n\n` +
    `${storeName} ki taraf se: aap ne yeh order diya tha -\n${orderedLines}\n\n` +
    `Hum filhaal itna bhej sakte hain -\n${confirmedLines}\n\n` +
    `Naya total: ${money(total)}\n\n` +
    `Kya yeh aapko manzoor hai? Please tasdeeq kar dein.`
  );
}

// confirmOrder(orderId, itemUpdates, confirmedVia)
//   itemUpdates: optional array of { id, confirmed_quantity } - one entry
//   per order_item the caller wants to set a different quantity for. Any
//   item NOT listed (or the whole array omitted) just gets
//   confirmed_quantity = its original quantity, i.e. "given exactly as
//   ordered" - this is the common case and needs no special handling from
//   either caller.
//   confirmedVia: 'admin' | 'dms' - who pressed the button, for reference.
//
// Returns null if the order doesn't exist, otherwise:
//   { order, items, altered, whatsapp: { phone, message } | null }
// whatsapp is only present when at least one item's quantity was actually
// changed - that's the "let the customer know" WhatsApp notice both the
// Admin Portal and the DMS can offer to send right after confirming.
async function confirmOrder(orderId, itemUpdates, confirmedVia) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: orderRows } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    const order = orderRows[0];
    if (!order) { await client.query('ROLLBACK'); return null; }

    const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [orderId]);
    const updateMap = {};
    for (const u of (itemUpdates || [])) {
      if (u && u.id != null) updateMap[u.id] = u.confirmed_quantity;
    }

    let altered = false;
    const finalItems = [];
    for (const it of items) {
      let confirmedQty = Number(it.quantity);
      if (Object.prototype.hasOwnProperty.call(updateMap, it.id) && updateMap[it.id] !== '' && updateMap[it.id] != null) {
        const requested = Number(updateMap[it.id]);
        if (!Number.isNaN(requested) && requested >= 0) confirmedQty = requested;
      }
      if (confirmedQty !== Number(it.quantity)) altered = true;
      await client.query('UPDATE order_items SET confirmed_quantity=$1 WHERE id=$2', [confirmedQty, it.id]);
      finalItems.push({ ...it, confirmed_quantity: confirmedQty });
    }

    const { rows: updatedOrderRows } = await client.query(
      `UPDATE orders SET status='confirmed', altered=$1, confirmed_via=$2, confirmed_at=NOW() WHERE id=$3 RETURNING *`,
      [altered, confirmedVia, orderId]
    );
    await client.query('COMMIT');

    let whatsapp = null;
    if (altered) {
      const { rows: storeRows } = await pool.query('SELECT store_name FROM store_settings WHERE id=1');
      const storeName = storeRows[0]?.store_name || 'Our Store';
      const orderedLines = finalItems.map((it) => `- ${it.product_name}: ${it.quantity} ${it.unit || ''}`.trim()).join('\n');
      const confirmedLines = finalItems.map((it) => `- ${it.product_name}: ${it.confirmed_quantity} ${it.unit || ''}`.trim()).join('\n');
      const total = finalItems.reduce((s, it) => s + Number(it.confirmed_quantity) * Number(it.price), 0);
      whatsapp = {
        phone: order.whatsapp,
        message: buildChangeNoticeMessage({ storeName, customerName: order.customer_name, orderedLines, confirmedLines, total }),
      };
    }

    return { order: updatedOrderRows[0], items: finalItems, altered, whatsapp };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// cancelOrder(orderId, confirmedVia) - no quantity questions here, just a
// status flip. Returns the updated order row, or null if it doesn't exist.
async function cancelOrder(orderId, confirmedVia) {
  const { rows } = await pool.query(
    `UPDATE orders SET status='cancelled', confirmed_via=$1, confirmed_at=NOW() WHERE id=$2 RETURNING *`,
    [confirmedVia, orderId]
  );
  return rows[0] || null;
}

module.exports = { confirmOrder, cancelOrder };
