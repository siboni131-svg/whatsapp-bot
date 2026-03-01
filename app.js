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
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  // optional: set a custom fetch or other options here
});

// Middleware
app.use(express.json()); // parse application/json

// Basic healthcheck
app.get('/', (req, res) => {
  res.send('השרת עובד');
});

// Webhook endpoint
// Assumes Green API sends JSON body. Adjust parsing/field names if their payload differs.
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};

    /*
      Example Green API payloads vary; common fields:
      - sender (or from) / fromNumber
      - message text might be in message, body, text, or messageData.textMessageData.textMessage
      - media info might be in messageData.extendedTextMessage, messageData.media, or an array of attachments

      Below we attempt to extract common fields safely. If your actual Green API payload differs,
      update the extraction logic accordingly.
    */

    // Try several common places for "from" number:
    const fromCandidates = [
      payload.from,
      payload.sender,
      payload.fromNumber,
      payload.from_number,
      payload.chatId, // sometimes contains number@c.us
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

    // Try several common places for text body
    const bodyCandidates = [
      payload.body,
      payload.message,
      payload.text,
      payload?.message?.text,
      // Green API sometimes nests content; try typical paths:
      payload?.messageData?.textMessageData?.textMessage,
      payload?.messageData?.extendedTextMessage?.text,
      payload?.messageData?.textMessage,
    ];

    let bodyText = null;
    for (const b of bodyCandidates) {
      if (b && typeof b === 'string' && b.trim() !== '') {
        bodyText = b;
        break;
      }
      // sometimes text is an object with 'text' property
      if (b && typeof b === 'object') {
        if (typeof b.text === 'string' && b.text.trim() !== '') {
          bodyText = b.text;
          break;
        }
      }
    }

    // Try to detect media. We'll attempt to find a URL or file id in several common fields.
    const mediaCandidates = [
      payload.media, // simple
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

    // If attachments is an array, join URLs (or keep first)
    if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      // prefer URL-like items
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
      if (urls.length > 0) {
        mediaValue = urls.join(','); // store comma-separated list
      } else {
        // fallback to JSON stringify attachments
        mediaValue = JSON.stringify(payload.attachments);
      }
    } else {
      // try other candidates in order
      for (const m of mediaCandidates) {
        if (!m) continue;
        if (typeof m === 'string' && m.trim() !== '') {
          mediaValue = m;
          break;
        }
        if (Array.isArray(m) && m.length > 0) {
          // pick first URL-like entry or join them
          const urls = m.map(item => {
            if (!item) return null;
            if (typeof item === 'string') return item;
            if (item.url) return item.url;
            if (item.downloadUrl) return item.downloadUrl;
            if (item.fileUrl) return item.fileUrl;
            return null;
          }).filter(Boolean);
          if (urls.length > 0) {
            mediaValue = urls.join(',');
            break;
          }
        }
        if (typeof m === 'object') {
          // look for properties that might contain a URL/id
          const url = m.url || m.downloadUrl || m.fileUrl || m.id || m.mediaUrl;
          if (url) {
            mediaValue = String(url);
            break;
          }
          // otherwise, store JSON
          mediaValue = JSON.stringify(m);
          break;
        }
      }
    }

    // Normalize empty strings to null
    if (mediaValue === '' || mediaValue === '[]' || mediaValue === '{}') mediaValue = null;
    if (bodyText && bodyText.trim() === '') bodyText = null;

    // Ensure we have at least the from_number or something to store
    if (!from_number) {
      // If you prefer to reject when missing sender, change to 400
      console.warn('Webhook received without a recognizable sender:', JSON.stringify(payload));
      // still allow storing if body or media present? Here we'll reject.
      return res.status(400).json({ error: 'missing from number in payload' });
    }

    // Prepare row to insert
    const row = {
      id: undefined, // let DB generate uuid if default is set. If not, you can add require uuid here.
      from_number: from_number,
      body: bodyText || null,
      media: mediaValue || null,
      // created_at can be filled by DB default (now()); omit to let DB set it
    };

    // Insert into messages table
    const { data, error } = await supabase
      .from('messages')
      .insert([row]);

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'database_insert_failed', details: error.message || error });
    }

    // Successful insert
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

// Generic error handler (for errors thrown from middleware/routes)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal_server_error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
