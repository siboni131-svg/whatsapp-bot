// app.js
// Node.js + Express webhook that writes incoming Green API WhatsApp messages to Supabase
// Expects environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Install dependencies:
//   npm install express @supabase/supabase-js

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required env vars early
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

// Supabase client using service_role key (has full DB permissions; keep secret)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Middleware
app.use(express.json()); // parse application/json

// Basic healthcheck
app.get('/', (req, res) => {
  res.send('השרת עובד');
});

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};

    // Log payload (optional) - can be noisy, comment out if too much
    console.log('Webhook received:', JSON.stringify(payload));

    // ✅ FIX: Green API sender is inside senderData.sender / senderData.chatId
    const fromCandidates = [
      payload?.senderData?.sender,
      payload?.senderData?.chatId,

      // fallbacks (in case payload format changes)
      payload.from,
      payload.sender,
      payload.fromNumber,
      payload.from_number,
      payload.chatId,
      payload?.message?.from,
    ];

    let from_number = null;
    for (const c of fromCandidates) {
      if (c) {
        from_number = String(c);
        break;
      }
    }

    // If chatId like "123456789@c.us", strip domain
    if (from_number && from_number.includes('@')) {
      from_number = from_number.split('@')[0];
    }

    // ✅ Green API text is usually here:
    // payload.messageData.textMessageData.textMessage
    const bodyCandidates = [
      payload?.messageData?.textMessageData?.textMessage,

      // fallbacks
      payload.body,
      payload.message,
      payload.text,
      payload?.message?.text,
      payload?.messageData?.extendedTextMessage?.text,
      payload?.messageData?.textMessage,
    ];

    let bodyText = null;
    for (const b of bodyCandidates) {
      if (b && typeof b === 'string' && b.trim() !== '') {
        bodyText = b;
        break;
      }
      if (b && typeof b === 'object') {
        if (typeof b.text === 'string' && b.text.trim() !== '') {
          bodyText = b.text;
          break;
        }
      }
    }

    // Try to detect media (optional)
    const mediaCandidates = [
      payload.media,
      payload.attachments,
      payload?.messageData?.imageMessage?.url,
      payload?.messageData?.videoMessage?.url,
      payload?.messageData?.documentMessage?.url,
      payload?.messageData?.audioMessage?.url,
      payload?.messageData?.stickerMessage?.url,
      payload?.messageData?.media,
      payload?.message?.media,
      payload?.files,
    ];

    let mediaValue = null;

    if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      const urls = payload.attachments
        .map(a => {
          if (!a) return null;
          if (typeof a === 'string') return a;
          if (a.url) return a.url;
          if (a.downloadUrl) return a.downloadUrl;
          if (a.fileUrl) return a.fileUrl;
          return null;
        })
        .filter(Boolean);

      mediaValue = urls.length > 0 ? urls.join(',') : JSON.stringify(payload.attachments);
    } else {
      for (const m of mediaCandidates) {
        if (!m) continue;

        if (typeof m === 'string' && m.trim() !== '') {
          mediaValue = m;
          break;
        }

        if (Array.isArray(m) && m.length > 0) {
          const urls = m
            .map(item => {
              if (!item) return null;
              if (typeof item === 'string') return item;
              if (item.url) return item.url;
              if (item.downloadUrl) return item.downloadUrl;
              if (item.fileUrl) return item.fileUrl;
              return null;
            })
            .filter(Boolean);

          if (urls.length > 0) {
            mediaValue = urls.join(',');
            break;
          }
        }

        if (typeof m === 'object') {
          const url = m.url || m.downloadUrl || m.fileUrl || m.id || m.mediaUrl;
          mediaValue = url ? String(url) : JSON.stringify(m);
          break;
        }
      }
    }

    // Normalize empty strings to null
    if (mediaValue === '' || mediaValue === '[]' || mediaValue === '{}') mediaValue = null;
    if (bodyText && bodyText.trim() === '') bodyText = null;

    // Must have sender
    if (!from_number) {
      console.warn('Webhook received without a recognizable sender:', JSON.stringify(payload));
      return res.status(400).json({ error: 'missing from number in payload' });
    }

    // Prepare row to insert
    const row = {
      // id: omitted -> let DB default gen_random_uuid() fill it
      from_number: from_number,
      body: bodyText || null,
      media: mediaValue || null,
      // created_at omitted -> let DB default now() fill it
    };

    const { data, error } = await supabase.from('messages').insert([row]).select();

    if (error) {
      console.error('Supabase insert error:', error);
      return res
        .status(500)
        .json({ error: 'database_insert_failed', details: error.message || String(error) });
    }

    return res.status(201).json({ ok: true, inserted: data });
  } catch (err) {
    console.error('Webhook processing error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

// Generic 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal_server_error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
