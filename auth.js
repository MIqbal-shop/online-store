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

// In-memory sessions, same trade-off as the DMS: everyone re-logs-in if the
// process restarts. Fine for a single-admin storefront.
const sessions = new Map();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}
function isValidSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}
function destroySession(token) {
  sessions.delete(token);
}
function tokenFromReq(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim();
}
function requireAdmin(req, res, next) {
  if (!isValidSession(tokenFromReq(req))) return res.status(401).json({ error: 'Login required' });
  next();
}

module.exports = {
  hashPassword, makeSalt, verifyPassword, makeApiKey,
  createSession, isValidSession, destroySession, tokenFromReq, requireAdmin,
};
