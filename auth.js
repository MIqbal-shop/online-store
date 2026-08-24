const crypto = require('crypto');

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

// In-memory sessions, same trade-off either way: everyone re-logs-in if the
// process restarts (fine for a small storefront). Two independent stores -
// an admin token must never double as a customer token or vice versa, even
// though the underlying mechanism is identical.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function makeSessionStore() {
  const sessions = new Map();
  return {
    create(payload) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { expires: Date.now() + SESSION_TTL_MS, payload });
      return token;
    },
    get(token) {
      if (!token) return null;
      const entry = sessions.get(token);
      if (!entry) return null;
      if (Date.now() > entry.expires) { sessions.delete(token); return null; }
      return entry.payload;
    },
    destroy(token) { sessions.delete(token); },
  };
}
const adminSessions = makeSessionStore();
const customerSessions = makeSessionStore();

function tokenFromReq(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim();
}
function requireAdmin(req, res, next) {
  if (!adminSessions.get(tokenFromReq(req))) return res.status(401).json({ error: 'Login required' });
  next();
}
function requireCustomer(req, res, next) {
  const payload = customerSessions.get(tokenFromReq(req));
  if (!payload) return res.status(401).json({ error: 'Please log in first.' });
  req.customerId = payload.id;
  next();
}

module.exports = {
  hashPassword, makeSalt, verifyPassword, makeApiKey,
  adminSessions, customerSessions, tokenFromReq, requireAdmin, requireCustomer,
};
