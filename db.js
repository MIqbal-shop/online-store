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

  // Optional note a customer can attach at checkout (e.g. "deliver after 5pm").
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT DEFAULT ''`);

  // Lets the admin block a problem account from logging in, without
  // deleting their history.
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`);
}

module.exports = { pool, init };
