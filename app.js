// app.js
// Node.js + Express webhook that writes incoming Green API WhatsApp messages to Supabase
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

app.get('/', (req, res) => res.send('השרת עובד ✅'));

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('Webhook received:', JSON.stringify(payload));

    // ✅ Green API (לפי הדוגמה שלך) השולח נמצא ב senderData.sender / senderData.chatId
    const fromCandidates = [
      payload?.senderData?.sender,
      payload?.senderData?.chatId,
      payload?.from,
      payload?.sender,
      payload?.fromNumber,
      payload?.from_number,
      payload?.chatId,
      payload?.message?.from,
    ];

    let from_number = null;
    for (const c of fromCandidates) {
      if (c) {
        from_number = String(c);
        break;
      }
    }

    if (from_number && from_number.includes('@')) {
      from_number = from_number.split('@')[0];
    }

    // ✅ טקסט (לפי הדוגמה שלך): messageData.textMessageData.textMessage
    const bodyCandidates = [
      payload?.messageData?.textMessageData?.textMessage,
      payload?.body,
      payload?.message,
      payload?.text,
      payload?.message?.text,
    ];

    let bodyText = null;
    for (const b of bodyCandidates) {
      if (typeof b === 'string' && b.trim() !== '') {
        bodyText = b;
        break;
      }
    }

    // מדיה (אופציונלי)
    let mediaValue = null;

    if (!from_number) {
      console.warn('No sender found in payload:', JSON.stringify(payload));
      return res.status(400).json({ error: 'missing from number in payload' });
    }

    const row = {
      from_number,
      body: bodyText || null,
      media: mediaValue,
      // created_at נשאיר ל-DB (default now())
    };

    const { data, error } = await supabase
      .from('messages')
      .insert([row])
      .select(); // כדי שיחזיר את הרשומה

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({
        error: 'database_insert_failed',
        details: error.message || error,
      });
    }

    return res.status(201).json({ ok: true, inserted: data });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
