// ============================================================================
// WhatsApp sending - Meta WhatsApp Cloud API (official, free tier).
//
// Needs two environment variables set on your hosting (Render/Vercel/etc):
//   WHATSAPP_TOKEN     - the permanent access token from your Meta app
//   WHATSAPP_PHONE_ID  - the "Phone number ID" of your WhatsApp sender number
//
// Until both are set, this just logs the message to the server console
// instead of failing - so the rest of the "forgot password" flow (a new
// password IS generated and saved) keeps working while you finish setup.
//
// One-time setup on Meta's side (do this once):
//   1. Go to developers.facebook.com -> "My Apps" -> Create App -> choose
//      "Business" type.
//   2. In the app dashboard, add the "WhatsApp" product.
//   3. Under WhatsApp > API Setup you get a temporary access token and a
//      "Phone number ID" for a free test number - good enough to try this
//      out immediately.
//   4. For real customers (not just test numbers you add manually), you
//      need to verify a business and get a permanent token - Meta's
//      WhatsApp > API Setup page walks through this with your own number.
//   5. Copy the token and phone number ID into WHATSAPP_TOKEN and
//      WHATSAPP_PHONE_ID as environment variables wherever this app is
//      hosted, then redeploy. No code changes needed after that.
// ============================================================================

async function sendWhatsAppMessage(toWhatsAppNumber, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.log(`[whatsapp:not-configured] Would send to ${toWhatsAppNumber}: ${message}`);
    return false; // not actually delivered yet - env vars missing
  }

  // Cloud API expects the number in international format with no leading
  // "+", spaces, or dashes (e.g. 923001234567). We strip everything except
  // digits; if the stored number doesn't already start with a country code,
  // add your local one here (this defaults to Pakistan, 92, dropping a
  // leading 0 - change if your customers are elsewhere).
  let digits = toWhatsAppNumber.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: digits,
      type: 'text',
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('WhatsApp send failed: ' + errText);
  }
  return true;
}

module.exports = { sendWhatsAppMessage };
