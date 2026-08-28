// ============================================================================
// Uploads product photos to Supabase Storage instead of saving them as
// base64 text directly in the database. Storing raw base64 in Postgres was
// making every page load fetch several MB of text on every request - this
// keeps the database small/fast and serves photos from Supabase's own CDN
// instead. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as
// environment variables (Project Settings -> API Keys in Supabase - use
// the SECRET key, not the publishable one, since uploading needs full
// access to the bucket).
// ============================================================================

const BUCKET = 'product-images';

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Image upload is not configured yet - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables.');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

// Accepts a data URL (what the browser's FileReader produces, e.g.
// "data:image/png;base64,....") and uploads it, returning a public URL.
async function uploadImage(dataUrl, filenameHint = 'image') {
  const { url, key } = getConfig();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('That file does not look like a valid image.');
  const mime = match[1];
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  const buffer = Buffer.from(match[2], 'base64');

  // Vercel's serverless functions cap the whole request body at ~4.5MB,
  // and base64 text is ~33% bigger than the original file, so the raw
  // photo itself needs to stay well under that or the upload request
  // gets rejected before this code even runs.
  const MAX_BYTES = 3 * 1024 * 1024; // 3MB safety cap per photo
  if (buffer.length > MAX_BYTES) throw new Error('That image is too large (max 3MB). Please choose a smaller photo, or compress it first.');

  const safeName = String(filenameHint).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'image';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}.${ext}`;

  const resp = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Image upload failed (${resp.status}). ${text.slice(0, 200)}`);
  }
  return `${url}/storage/v1/object/public/${BUCKET}/${path}`;
}

module.exports = { uploadImage };
