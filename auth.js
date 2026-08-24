const crypto = require('crypto');
const { pool } = require('./db');

// scrypt is built into Node - no extra dependency, same approach the DMS
// backend already uses for its own logins.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function verifyPassword(password, hash, salt) {
  const check = hashPassword(password, salt);
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function makeApiKey() {
  return crypto.randomBytes(24).toString('hex');
}

// ============================================================================
// Sessions live in Postgres (see db.js "sessions" table), not in server
// memory. This app runs on serverless hosting (Vercel) where consecutive
// requests can each land on a totally separate, independent instance - an
// in-memory Map would only be visible to whichever instance created it,
// making logins randomly "disappear" on the very next request. A shared
// database table is the only reliable place for this on serverless.
// ============================================================================
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function createSession(kind, subjectId = null) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query('INSERT INTO sessions (token, kind, subject_id, expires_at) VALUES ($1,$2,$3,$4)', [token, kind, subjectId, expiresAt]);
  return token;
}
async function getSession(token, kind) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT * FROM sessions WHERE token=$1 AND kind=$2', [token, kind]);
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
    return null;
  }
  return row;
}
async function destroySession(token) {
  await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
}

function tokenFromReq(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim();
}
async function requireAdmin(req, res, next) {
  try {
    const session = await getSession(tokenFromReq(req), 'admin');
    if (!session) return res.status(401).json({ error: 'Login required' });
    next();
  } catch (err) { next(err); }
}
async function requireCustomer(req, res, next) {
  try {
    const session = await getSession(tokenFromReq(req), 'customer');
    if (!session) return res.status(401).json({ error: 'Please log in first.' });
    req.customerId = session.subject_id;
    next();
  } catch (err) { next(err); }
}

module.exports = {
  hashPassword, makeSalt, verifyPassword, makeApiKey,
  createSession, destroySession, tokenFromReq, requireAdmin, requireCustomer,
};
