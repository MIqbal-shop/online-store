// ============================================================================
// WhatsApp sending - Meta WhatsApp Cloud API (official, free tier).
//
// Needs two environment variables set on your hosting (Render/Vercel/etc):
//   WHATSAPP_TOKEN     - the permanent access token from your Meta app
//   WHATSAPP_PHONE_ID  - the "Phone number ID" of your WhatsApp sender number
//
// Until both are set, this just logs the message to the server console
// instead of failing - so the rest of the flow (order confirmed, password
// generated, etc.) keeps working while you finish setup.
//
// IMPORTANT - why a plain text message alone isn't enough:
// WhatsApp only allows a business to send a free-form text message to a
// customer if that customer messaged the business's WhatsApp number within
// the last 24 hours. A customer who just placed an order on the website
// (without WhatsApp-ing you first) is OUTSIDE that window, so a plain text
// send to them FAILS every time - this is almost certainly the exact
// problem hit before. The fix, and what this file actually does now, is
// send an approved "Template" message instead - Meta lets those go to
// ANYONE, any time, specifically because they're pre-reviewed and can't be
// used for spam. sendWhatsAppTemplate() below is what order-confirmed,
// order-cancelled, and password-reset all use.
//
// One-time setup on Meta's side (do this once):
//   1. Go to developers.facebook.com -> "My Apps" -> Create App -> choose
//      "Business" type.
//   2. In the app dashboard, add the "WhatsApp" product.
//   3. Under WhatsApp > API Setup you get a temporary access token and a
//      "Phone number ID" for a free test number - good enough to try this
//      out immediately, but temporary tokens expire in 24 hours. For a
//      permanent token: WhatsApp > API Setup > "Configuration" ->
//      generate a permanent token via a System User (Meta's setup page
//      walks through this).
//   4. For real customers (not just test numbers you add manually), verify
//      a business under WhatsApp > API Setup - Meta's page walks through
//      this with your own number.
//   5. Copy the token and phone number ID into WHATSAPP_TOKEN and
//      WHATSAPP_PHONE_ID as environment variables wherever this app is
//      hosted, then redeploy.
//   6. Create the 3 message templates this app needs - WhatsApp Manager
//      (business.facebook.com/wa/manage) -> Account tools -> Message
//      Templates -> Create Template. Use CATEGORY "Utility" for all three
//      (order/account updates, not marketing - marketing templates cost
//      money per send, Utility ones are free and approve faster). Create
//      exactly these three, with exactly this body text (the {{1}}, {{2}}
//      placeholders must stay in this order - that's what the code below
//      fills in):
//
//        Name: order_confirmed          Language: English (or Urdu)
//        Body: Assalam o Alaikum {{1}}! Aapka order {{2}} confirm ho gaya hai. Total: {{3}}. Shukriya - {{4}}
//
//        Name: order_cancelled           Language: English (or Urdu)
//        Body: Assalam o Alaikum {{1}}! Maazrat, aapka order {{2}} cancel kar diya gaya hai. Zyada maloomat ke liye humein WhatsApp karein. - {{3}}
//
//        Name: order_updated             Language: English (or Urdu)
//        Body: {{1}}
//
//        Name: password_reset            Language: English (or Urdu)
//        Body: Aapka naya password hai: {{1}}. Login kar ke isay foran change kar lein. - {{2}}
//
//        Name: phone_otp                 Language: English (or Urdu)
//        Body: Aapka verification code hai: {{1}}. Ye code kisi se share na karein. - {{2}}
//
//      Submit each for review - Meta usually approves Utility templates
//      within a few minutes to a few hours. If one gets rejected, it's
//      almost always the wording (Meta dislikes anything that reads like
//      marketing) - simplify it and resubmit.
//   7. If you named your templates differently, or picked a different
//      language than English, set these optional env vars to match
//      (defaults shown):
//        WHATSAPP_TEMPLATE_ORDER_CONFIRMED=order_confirmed
//        WHATSAPP_TEMPLATE_ORDER_CANCELLED=order_cancelled
//        WHATSAPP_TEMPLATE_ORDER_UPDATED=order_updated
//        WHATSAPP_TEMPLATE_PASSWORD_RESET=password_reset
//        WHATSAPP_TEMPLATE_PHONE_OTP=phone_otp
//        WHATSAPP_TEMPLATE_LANGUAGE=en_US   (or whatever Meta shows for
//        the language you picked when creating the templates - "en_US" for
//        English (US), "en" for English, etc.)
// ============================================================================

function digitsFor(toWhatsAppNumber) {
  // Cloud API expects the number in international format with no leading
  // "+", spaces, or dashes (e.g. 923001234567). We strip everything except
  // digits; if the stored number doesn't already start with a country code,
  // add your local one here (this defaults to Pakistan, 92, dropping a
  // leading 0 - change if your customers are elsewhere).
  let digits = toWhatsAppNumber.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  return digits;
}

async function sendWhatsAppMessage(toWhatsAppNumber, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.log(`[whatsapp:not-configured] Would send to ${toWhatsAppNumber}: ${message}`);
    return false; // not actually delivered yet - env vars missing
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: digitsFor(toWhatsAppNumber),
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

// The one that actually works for a customer who hasn't messaged you
// recently - see the big comment above for why, and for the exact
// templates to create in Meta's WhatsApp Manager. bodyParams is a plain
// array of strings, filled into the template's {{1}}, {{2}}, ... in order.
async function sendWhatsAppTemplate(toWhatsAppNumber, templateName, bodyParams) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';

  if (!token || !phoneId) {
    console.log(`[whatsapp:not-configured] Would send template "${templateName}" to ${toWhatsAppNumber}:`, bodyParams);
    return false;
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: digitsFor(toWhatsAppNumber),
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // Common causes worth recognizing in your logs: template not approved
    // yet, template name/language doesn't match what you created, or the
    // number given has never messaged this WhatsApp number and also isn't
    // a valid WhatsApp account.
    throw new Error(`WhatsApp template "${templateName}" send failed: ` + errText);
  }
  return true;
}

// Best-effort wrapper for order/account events: tries the template send,
// swallows (logs) any failure instead of throwing, so a WhatsApp hiccup
// NEVER blocks the actual confirm/cancel/password-reset action it's
// attached to - the core action already succeeded in the database by the
// time this runs.
async function tryTemplateOrDrop(toWhatsAppNumber, templateName, bodyParams) {
  try {
    return await sendWhatsAppTemplate(toWhatsAppNumber, templateName, bodyParams);
  } catch (err) {
    console.error(`[whatsapp] ${templateName} to ${toWhatsAppNumber} failed (non-fatal):`, err.message);
    return false;
  }
}

module.exports = { sendWhatsAppMessage, sendWhatsAppTemplate, tryTemplateOrDrop };
