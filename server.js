const express = require('express');
const cors = require('cors');
const path = require('path');
const { init } = require('./db');

const app = express();

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

app.use(cors());
app.use(express.json({ limit: '5mb' })); // raised for base64 product images

// Database setup runs once per process - works both for a long-running
// server (Render) and a serverless cold start (Vercel). Every request
// waits for it via this middleware, instead of only starting to accept
// traffic after init resolves (which doesn't apply on serverless anyway).
let initPromise = null;
app.use((req, res, next) => {
  if (!initPromise) initPromise = init().catch((err) => { initPromise = null; throw err; });
  initPromise.then(() => next()).catch(next);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/orders/feed', require('./routes/feed'));

// The customer storefront (public/index.html) and the owner's admin panel
// (public/admin.html) - plain HTML/CSS/JS, no build step, so deploying this
// is just "push the folder" with nothing to compile.
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error('[request error]', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Server mein kuch ghalat ho gaya.' });
});

// On Vercel (and similar serverless platforms) we just export the Express
// app - the platform's own runtime calls it directly as the request
// handler. Anywhere else (Render, or running locally), start a normal
// always-on server the usual way.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => console.log(`Online store running on port ${PORT}`));
}

module.exports = app;
