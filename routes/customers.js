const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../db');
const { hashPassword, makeSalt, verifyPassword, createSession, destroySession, requireCustomer } = require('../auth');
const { tryTemplateOrDrop } = require('../whatsapp');

const TPL_PASSWORD_RESET = process.env.WHATSAPP_TEMPLATE_PASSWORD_RESET || 'password_reset';
const TPL_PHONE_OTP = process.env.WHATSAPP_TEMPLATE_PHONE_OTP || 'phone_otp';
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes to enter the code
const OTP_RESEND_COOLDOWN_MS = 45 * 1000; // stops "Resend" being spammed (and racking up WhatsApp sends)

// Accepts a Pakistani mobile number in ANY of the common ways someone might
// type it - "03001234567", "3001234567", "923001234567", "+923001234567",
// with spaces/dashes in between - and returns it in ONE canonical form
// (03XXXXXXXXX) if and only if it's actually a valid-shaped mobile number.
// Returns null for anything else (too short, too long, landline-shaped,
// random junk). This alone only proves the NUMBER is shaped like a real
// Pakistani mobile number - it does NOT prove this particular person
// actually has that phone. That's what the OTP flow below (/send-otp,
// then signup requiring the matching code) is for: signup is rejected
// unless the code that arrived on THAT WhatsApp number is typed back in,
// which only someone with the phone in hand could do.
function normalizePakMobile(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(2);
  if (digits.startsWith('92') && digits.length === 12) digits = '0' + digits.slice(2);
  if (digits.length !== 11) return null;
  if (!digits.startsWith('03')) return null;
  return digits;
}

function publicFields(row) {
  return { id: row.id, name: row.name, shop_name: row.shop_name, phone: row.phone, whatsapp: row.whatsapp, address: row.address, customer_type: row.customer_type, account_type: row.account_type || 'business' };
}

// Short, easy-to-type temporary password: e.g. "K7QX9PLM"
function generateTempPassword() {
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
}

// POST /api/customers/signup
// body: { customer_type: 'new'|'old', account_type: 'business'|'personal', name, shop_name, phone, whatsapp, address, password }
// shop_name/phone/address only required when customer_type is 'new' - same
// rule the old per-order form used to apply, just asked once now. shop_name
// specifically is only required (and only meaningful) for a 'business'
// account - a 'personal' (home) account skips it entirely.
// POST /api/customers/send-otp - body: { whatsapp }
// Sends a 5-digit code to a WhatsApp number BEFORE an account is created
// with it - signup (below) then refuses to proceed unless that exact code
// is typed back in, so completing signup is proof the person actually has
// that phone, not just proof they can type an 11-digit number.
router.post('/send-otp', async (req, res, next) => {
  try {
    const whatsapp = normalizePakMobile(req.body.whatsapp);
    if (!whatsapp) return res.status(400).json({ error: 'Please enter a valid Pakistani mobile number (e.g. 03001234567).' });

    const existing = await pool.query('SELECT id FROM customers WHERE whatsapp=$1', [whatsapp]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this WhatsApp number already exists. Please log in instead.' });
    }

    const recent = await pool.query(
      `SELECT id FROM phone_otps WHERE whatsapp=$1 AND created_at > NOW() - INTERVAL '${OTP_RESEND_COOLDOWN_MS / 1000} seconds'`,
      [whatsapp]
    );
    if (recent.rows.length > 0) {
      return res.status(429).json({ error: 'Please wait a moment before requesting another code.' });
    }

    const otp = String(Math.floor(10000 + Math.random() * 90000)); // 5 digits, never starts with 0
    await pool.query('DELETE FROM phone_otps WHERE whatsapp=$1', [whatsapp]); // only the newest code for this number is ever valid
    await pool.query(
      `INSERT INTO phone_otps (whatsapp, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${OTP_TTL_MS / 1000} seconds')`,
      [whatsapp, otp]
    );

    const { rows: storeRows } = await pool.query('SELECT store_name FROM store_settings WHERE id=1');
    const storeName = storeRows[0]?.store_name || 'Our Store';
    const sent = await tryTemplateOrDrop(whatsapp, TPL_PHONE_OTP, [otp, storeName]);

    // Being honest with the frontend about delivery matters here (unlike
    // password reset, which has a manual admin fallback) - if WhatsApp
    // sending isn't configured/working yet, there is currently no other
    // way for this code to reach the customer, so signup would otherwise
    // hang forever waiting for a code that never arrives.
    if (!sent) {
      return res.status(503).json({ error: 'WhatsApp verification is not set up yet on this store - please contact us directly to create your account.' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/signup', async (req, res, next) => {
  try {
    const { customer_type, account_type, name, shop_name, phone, whatsapp, address, password, otp_code } = req.body;
    if (customer_type !== 'new' && customer_type !== 'old') {
      return res.status(400).json({ error: 'Please select whether you are a new or existing customer.' });
    }
    const accountType = account_type === 'personal' ? 'personal' : 'business';
    if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter your name.' });
    if (!whatsapp || !whatsapp.trim()) return res.status(400).json({ error: 'Please enter your WhatsApp number.' });
    const normalizedWhatsapp = normalizePakMobile(whatsapp);
    if (!normalizedWhatsapp) {
      return res.status(400).json({ error: 'Please enter a valid Pakistani mobile number (e.g. 03001234567).' });
    }
    let normalizedPhone = '';
    if (customer_type === 'new' && phone) {
      normalizedPhone = normalizePakMobile(phone);
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Please enter a valid Pakistani mobile number for Phone (e.g. 03001234567).' });
      }
    }
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (customer_type === 'new' && (!phone || !address)) {
      return res.status(400).json({ error: 'Phone number and address are required.' });
    }
    if (customer_type === 'new' && accountType === 'business' && !shop_name) {
      return res.status(400).json({ error: 'Shop name is required.' });
    }

    // Proof this WhatsApp number is actually reachable by whoever is
    // signing up - see POST /send-otp above. A code is single-use (deleted
    // the instant it's spent below) and only valid for OTP_TTL_MS, so it
    // can't be reused for a second account or replayed later.
    if (!otp_code || !String(otp_code).trim()) {
      return res.status(400).json({ error: 'Please enter the verification code sent to your WhatsApp.' });
    }
    const otpRow = await pool.query(
      `SELECT id FROM phone_otps WHERE whatsapp=$1 AND otp=$2 AND expires_at > NOW()`,
      [normalizedWhatsapp, String(otp_code).trim()]
    );
    if (otpRow.rows.length === 0) {
      return res.status(400).json({ error: 'That code is incorrect or has expired. Please request a new one.' });
    }

    const existing = await pool.query('SELECT id FROM customers WHERE whatsapp=$1', [normalizedWhatsapp]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this WhatsApp number already exists. Please log in instead.' });
    }

    const salt = makeSalt();
    const hash = hashPassword(password, salt);
    const { rows } = await pool.query(
      `INSERT INTO customers (customer_type, account_type, name, shop_name, phone, whatsapp, address, password_hash, password_salt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [customer_type, accountType, name.trim(), accountType === 'business' ? (shop_name || '').trim() : '', normalizedPhone, normalizedWhatsapp, (address || '').trim(), hash, salt]
    );
    await pool.query('DELETE FROM phone_otps WHERE id=$1', [otpRow.rows[0].id]); // one-time use - spent now
    const token = await createSession('customer', rows[0].id);
    res.json({ token, customer: publicFields(rows[0]) });
  } catch (err) { next(err); }
});

// POST /api/customers/login - body: { whatsapp, password }
router.post('/login', async (req, res, next) => {
  try {
    const { whatsapp, password } = req.body;
    const normalized = normalizePakMobile(whatsapp) || (whatsapp || '').trim();
    const { rows } = await pool.query('SELECT * FROM customers WHERE whatsapp=$1', [normalized]);
    const account = rows[0];
    if (!account || !verifyPassword(password || '', account.password_hash, account.password_salt)) {
      return res.status(401).json({ error: 'WhatsApp number or password is incorrect.' });
    }
    if (account.blocked) {
      return res.status(403).json({ error: 'Your account has been disabled. Please contact us.' });
    }
    const token = await createSession('customer', account.id);
    res.json({ token, customer: publicFields(account) });
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res) => {
  await destroySession((req.headers.authorization || '').replace('Bearer ', '').trim());
  res.json({ ok: true });
});

router.get('/me', requireCustomer, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers WHERE id=$1', [req.customerId]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    if (rows[0].blocked) return res.status(403).json({ error: 'Your account has been disabled. Please contact us.' });
    res.json({ customer: publicFields(rows[0]) });
  } catch (err) { next(err); }
});

// GET /api/customers/me/orders - the shopper's own order history, newest
// first, each with its line items - powers the storefront's "My Orders".
router.get('/me/orders', requireCustomer, async (req, res, next) => {
  try {
    const { rows: orders } = await pool.query('SELECT * FROM orders WHERE customer_id=$1 ORDER BY order_date DESC', [req.customerId]);
    const { rows: items } = await pool.query(
      `SELECT oi.* FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.customer_id=$1 ORDER BY oi.id`,
      [req.customerId]
    );
    const byOrder = {};
    for (const it of items) { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); }
    res.json({ orders: orders.map(o => ({ ...o, items: byOrder[o.id] || [] })) });
  } catch (err) { next(err); }
});

// PUT /api/customers/me - lets a shopper fix their shop name / phone /
// address later. WhatsApp number is not editable here since it is the
// login identifier - changing it would need its own verification step.
router.put('/me', requireCustomer, async (req, res, next) => {
  try {
    const { name, shop_name, phone, address } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Please enter your name.' });
    let normalizedPhone = '';
    if (phone) {
      normalizedPhone = normalizePakMobile(phone);
      if (!normalizedPhone) return res.status(400).json({ error: 'Please enter a valid Pakistani mobile number for Phone (e.g. 03001234567).' });
    }
    const { rows } = await pool.query(
      `UPDATE customers SET name=$1, shop_name=$2, phone=$3, address=$4 WHERE id=$5 RETURNING *`,
      [name.trim(), (shop_name || '').trim(), normalizedPhone, (address || '').trim(), req.customerId]
    );
    res.json({ customer: publicFields(rows[0]) });
  } catch (err) { next(err); }
});

// PUT /api/customers/me/password - change password from inside the account
// (Settings). Requires the current password so a stolen/left-open session
// can't be used to lock the real owner out.
router.put('/me/password', requireCustomer, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password) return res.status(400).json({ error: 'Please enter your current password.' });
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const { rows } = await pool.query('SELECT * FROM customers WHERE id=$1', [req.customerId]);
    const account = rows[0];
    if (!account || !verifyPassword(current_password, account.password_hash, account.password_salt)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const salt = makeSalt();
    const hash = hashPassword(new_password, salt);
    await pool.query('UPDATE customers SET password_hash=$1, password_salt=$2 WHERE id=$3', [hash, salt, req.customerId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/customers/forgot-password - body: { whatsapp }
// A plain (non-hashed) password is never stored anywhere, so the original
// password can't be recovered or sent back - instead this generates a new
// temporary password and saves it. It shows up in the admin panel under
// Settings -> Password Resets, so the store owner can forward it to the
// customer on WhatsApp themselves.
// Always returns the same generic message, whether or not the number is
// registered, so this can't be used to check which numbers have accounts.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const whatsapp = normalizePakMobile(req.body.whatsapp) || (req.body.whatsapp || '').trim();
    if (!whatsapp) return res.status(400).json({ error: 'Please enter your WhatsApp number.' });

    const { rows } = await pool.query('SELECT * FROM customers WHERE whatsapp=$1', [whatsapp]);
    const account = rows[0];
    // Only ever creates a request (and only ever appears in the admin's
    // Password Resets list) when this WhatsApp number matches a real,
    // non-blocked account - a random/unregistered number produces nothing
    // for the admin to see, so there's nothing to accidentally hand out.
    if (account && !account.blocked) {
      // A short cooldown stops the same number from being spammed to keep
      // invalidating the real owner's password over and over.
      const recent = await pool.query(
        `SELECT id FROM password_resets WHERE customer_id=$1 AND created_at > NOW() - INTERVAL '5 minutes'`,
        [account.id]
      );
      if (recent.rows.length === 0) {
        const tempPassword = generateTempPassword();
        const salt = makeSalt();
        const hash = hashPassword(tempPassword, salt);
        await pool.query('UPDATE customers SET password_hash=$1, password_salt=$2 WHERE id=$3', [hash, salt, account.id]);
        await pool.query(
          `INSERT INTO password_resets (customer_id, whatsapp, customer_name, temp_password) VALUES ($1,$2,$3,$4)`,
          [account.id, account.whatsapp, account.name, tempPassword]
        );
        // Try to deliver it automatically first (see whatsapp.js for the
        // exact template to create in Meta's WhatsApp Manager) - the row
        // just inserted above stays either way, as a record AND as a
        // fallback the Admin Portal's "Password Resets" list can still show
        // (marked "sent" or not) in case the automatic send fails for this
        // number for any reason.
        const { rows: storeRows } = await pool.query('SELECT store_name FROM store_settings WHERE id=1');
        const storeName = storeRows[0]?.store_name || 'Our Store';
        const sent = await tryTemplateOrDrop(account.whatsapp, TPL_PASSWORD_RESET, [tempPassword, storeName]);
        if (sent) {
          await pool.query(`UPDATE password_resets SET sent=true WHERE customer_id=$1 AND temp_password=$2`, [account.id, tempPassword]);
        }
      }
    }
    res.json({ ok: true, message: 'If this WhatsApp number has an account, a new password is ready - our team will send it to you on WhatsApp shortly.' });
  } catch (err) { next(err); }
});

// ---- Favorites / Wishlist ----

// GET /api/customers/me/favorites - product ids the shopper has saved,
// plus the full product rows (only active ones - a favorite pointing at a
// since-removed product just quietly stops showing up).
router.get('/me/favorites', requireCustomer, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id
       WHERE f.customer_id=$1 AND p.active=true ORDER BY f.created_at DESC`,
      [req.customerId]
    );
    res.json({ products: rows });
  } catch (err) { next(err); }
});

// POST /api/customers/me/favorites - body: { product_id }
router.post('/me/favorites', requireCustomer, async (req, res, next) => {
  try {
    const productId = Number(req.body.product_id);
    if (!productId) return res.status(400).json({ error: 'Missing product.' });
    await pool.query(
      `INSERT INTO favorites (customer_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.customerId, productId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/customers/me/favorites/:productId
router.delete('/me/favorites/:productId', requireCustomer, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM favorites WHERE customer_id=$1 AND product_id=$2', [req.customerId, req.params.productId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
