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
