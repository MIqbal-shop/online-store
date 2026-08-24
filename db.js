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

  // Optional second unit/price for a product - e.g. sell by the carton AND
  // by the piece, each with its own rate. NULL price_2 means "no second
  // option", the storefront then only shows the one unit as before.
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_2 TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_2 NUMERIC`);
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
}

module.exports = { pool, init };
