const { Pool } = require('pg');

// ============================================================================
// Uses Postgres (meant to be a free Supabase project), NOT a local SQLite
// file like the DMS uses - a Render *free* web service has NO persistent
// disk, so any local file (including a SQLite .db file) is wiped every time
// the service redeploys, restarts, or wakes up from sleep. A real hosted
// database is the only way orders/products actually survive on the free
// tier. Set DATABASE_URL (Supabase gives you this) as an environment
// variable - see README.md for exact steps.
// ============================================================================

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set - the app cannot start without it. See README.md.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase's pooled connection requires SSL; rejectUnauthorized:false is
  // the standard/expected setting for their managed certs.
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY DEFAULT 1,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      api_key TEXT NOT NULL,
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL DEFAULT 0,
      unit TEXT DEFAULT '',
      image TEXT,
      description TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_type TEXT,
      customer_name TEXT,
      shop_name TEXT,
      phone TEXT,
      whatsapp TEXT,
      address TEXT,
      status TEXT DEFAULT 'new',
      order_date TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      product_name TEXT,
      quantity NUMERIC,
      unit TEXT,
      price NUMERIC
    )
  `);
  // Real shopper accounts - signed up once, logged in on every future visit.
  // customer_type is asked at sign-up (are you already one of our
  // distributor's customers, or brand new to us) and reused for every
  // order after that, instead of being asked again each time.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      customer_type TEXT DEFAULT 'new',
      name TEXT NOT NULL,
      shop_name TEXT,
      phone TEXT,
      whatsapp TEXT UNIQUE NOT NULL,
      address TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Orders now link back to the account that placed them (their profile is
  // still snapshotted onto customer_name/shop_name/etc at order time, so a
  // later profile edit never rewrites order history).
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)`);

  // Login sessions live here, NOT in server memory - this app runs on
  // serverless (Vercel), where each request can land on a different,
  // independent instance with its own blank memory. A token created by one
  // instance would be invisible to another, so "logged in" would randomly
  // flicker to "please log in again". Storing sessions in Postgres means
  // every instance checks the same source of truth.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      kind TEXT NOT NULL,           -- 'admin' | 'customer'
      subject_id INTEGER,           -- customer id (null for the single admin account)
      expires_at TIMESTAMP NOT NULL
    )
  `);

  // Optional multi-level packing for a product - mirrors how the DMS
  // itself thinks about stock: a product can be sold as a single simple
  // unit, OR as Carton+Pieces, OR as Carton+Box+Pieces, each level with its
  // own price. packing_type picks which of these applies; the unused price
  // columns for whichever mode isn't selected just stay NULL.
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS packing_type TEXT DEFAULT 'single'`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_carton NUMERIC`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_box NUMERIC`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_piece NUMERIC`);
  // Superseded by packing_type/price_carton/price_box/price_piece above -
  // drop if they exist from an earlier version of this schema.
  await pool.query(`ALTER TABLE products DROP COLUMN IF EXISTS unit_2`);
  await pool.query(`ALTER TABLE products DROP COLUMN IF EXISTS price_2`);
  // Store branding - editable from the admin panel (Settings tab), so the
  // shop name/tagline/logo can be changed any time without touching code.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      store_name TEXT DEFAULT 'IQBAL TRADER',
      tagline TEXT DEFAULT 'Order directly from your shop',
      logo_image TEXT,
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
  const seed = await pool.query('SELECT id FROM store_settings WHERE id=1');
  if (seed.rows.length === 0) {
    await pool.query(`INSERT INTO store_settings (id, store_name, tagline) VALUES (1, 'IQBAL TRADER', 'Order directly from your shop')`);
  }

  // Forgot-password requests - a customer can't recover their old password
  // (only a secure hash of it is ever stored), so "forgot password" instead
  // generates a new temporary one here. Since there's no WhatsApp API wired
  // up, the admin sees it in the panel and forwards it to the customer
  // manually (Settings -> Password Resets).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      whatsapp TEXT NOT NULL,
      customer_name TEXT,
      temp_password TEXT NOT NULL,
      sent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // In-stock toggle (admin flips this per product - no numeric quantity
  // tracking, just "can customers order this right now or not") and an
  // optional category, used for the storefront's search/filter bar.
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS in_stock BOOLEAN DEFAULT TRUE`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`);
  // Brand / manufacturer name (e.g. "Bona Papa") - separate from category
  // (e.g. "Diapers") so the storefront can filter by either one.
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS company TEXT DEFAULT ''`);

  // Optional note a customer can attach at checkout (e.g. "deliver after 5pm").
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT DEFAULT ''`);

  // Lets the admin block a problem account from logging in, without
  // deleting their history.
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`);

  // Wishlist - a simple join table, one row per (customer, product) they've
  // saved. No extra columns needed; the primary key doubles as the
  // "already saved?" check.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (customer_id, product_id)
    )
  `);

  // Ratings/reviews - covers a specific product (product_id set) as well as
  // general feedback about the service/website as a whole (target_type
  // 'general', product_id null). customer_name is snapshotted at review
  // time so it still reads fine even if the account is later renamed.
  // Each customer can leave only ONE review per product, and only one
  // general review - submitting again edits their existing one instead of
  // piling up duplicates (enforced by the two partial unique indexes below).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      target_type TEXT NOT NULL DEFAULT 'product', -- 'product' | 'general'
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      customer_name TEXT,
      rating INTEGER NOT NULL,
      comment TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_customer_product
    ON reviews (customer_id, product_id) WHERE target_type = 'product'
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_general_per_customer
    ON reviews (customer_id) WHERE target_type = 'general'
  `);

  // ---- Order confirmation with quantity adjustments, kept in sync across
  // whichever side confirms it (Admin Portal here, or the DMS app later) ----
  //
  // quantity on order_items always stays exactly what the customer asked
  // for - it's never overwritten, so "what did they order" is never lost.
  // confirmed_quantity is filled in ONLY at confirm time: normally it's set
  // equal to quantity (nothing changed), but if the shop can't fully cover
  // an item, it's set to whatever amount is actually being sent instead.
  // Any difference between quantity and confirmed_quantity is what
  // "altered" on the order flags, and it's what the bill and the WhatsApp
  // change-notice message are built from - never the original ordered
  // amount. NULL means "not confirmed yet".
  await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS confirmed_quantity NUMERIC`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS altered BOOLEAN DEFAULT FALSE`);
  // confirmed_via records which system actually pressed the confirm/cancel
  // button ('admin' = Admin Portal, 'dms' = the DMS app) purely for
  // reference - either one is equally able to do it, and whichever happens
  // first is simply what sticks, since both write to this same table.
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_via TEXT`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP`);

  // "Under review" - a not-yet-decided staging step: staff proposed some
  // (possibly adjusted) quantities and messaged the customer about them,
  // but haven't actually confirmed the order yet. review_quantity is what
  // was proposed; it's separate from confirmed_quantity, which only gets
  // set once the order is genuinely finalized. Kept in this same database
  // (not just one app's local state) so it's visible - and settable -
  // from both the Admin Portal and the DMS app equally, same as
  // confirm/cancel already are.
  await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS review_quantity NUMERIC`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_pending BOOLEAN DEFAULT FALSE`);

  // ---- Customer deletion, with a mandatory 48-hour cool-off ----
  //
  // Deleting a customer account is a two-step, admin-only action:
  //   1. Admin requests deletion -> pending_deletion=true, deletion_requested_at=NOW().
  //      Admin can cancel this at any time (clears both fields again).
  //   2. Only once 48 hours have passed does the actual DELETE endpoint do
  //      anything - it's rejected outright before that, even if called
  //      directly. There's no auto-delete: after the 48 hours the admin
  //      panel simply stops offering "Cancel" and instead asks for one
  //      final Yes/No, and nothing is removed until that Yes actually
  //      happens.
  // Deleting the customer row cascades (via the FK below) to their orders,
  // order_items, favorites, and reviews - on both this site AND the DMS
  // app, since the DMS only ever mirrors what this database has.
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS pending_deletion BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP`);

  // orders.customer_id originally had no ON DELETE behaviour (NO ACTION),
  // which would block deleting a customer who has any order history.
  // Re-create the constraint with CASCADE so removing the customer removes
  // their orders (and, via order_items' own CASCADE, their order lines)
  // in one step.
  await pool.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_id_fkey`);
  await pool.query(`ALTER TABLE orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`);

  // Tombstone of recently-deleted order ids - the DMS app only ever PULLS
  // from /api/orders/feed (it never gets pushed to), so without this it
  // would keep whatever copy of a deleted order it already synced. The
  // feed route includes recent entries from here so the DMS can remove its
  // own local copy on its very next sync. 60 days matches the feed's own
  // order window, so this never needs pruning beyond that.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deleted_order_ids (
      order_id INTEGER PRIMARY KEY,
      deleted_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Admin can hide a review (e.g. abusive, spam, or just unfair) without
  // permanently deleting it - hidden ones are excluded from the storefront
  // and from the average-rating calculation, but stay visible to the admin
  // so they can be unhidden later. A separate, permanent Delete is still
  // available too.
  await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE`);
}

module.exports = { pool, init };
