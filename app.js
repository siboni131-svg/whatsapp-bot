const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== ENV =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GREEN_API_URL = process.env.GREEN_API_URL;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase ENV variables");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ===== Helpers =====
function isGroup(chatId) {
  return chatId && chatId.includes("@g.us");
}

function getText(payload) {
  return (
    payload?.messageData?.textMessageData?.textMessage ||
    payload?.messageData?.extendedTextMessage?.text ||
    ""
  ).trim();
}

function getPhone(payload) {
  let v = payload?.senderData?.sender || payload?.senderData?.chatId || "";
  if (v.includes("@")) v = v.split("@")[0];
  return v;
}

async function sendMessage(chatId, message) {
  const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
  await axios.post(url, { chatId, message });
}

// ===== Health check =====
app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    if (payload.typeWebhook !== "incomingMessageReceived") {
      return res.sendStatus(200);
    }

    const chatId = payload?.senderData?.chatId;
    if (!chatId || isGroup(chatId)) return res.sendStatus(200);

    const phone = getPhone(payload);
    const text = getText(payload);

    // איפוס ידני
    if (text === "תפריט" || text === "איפוס") {
      await supabase.from("customers").upsert([
        { phone, step: 1 }
      ], { onConflict: "phone" });

      await sendMessage(chatId, "התחלנו מחדש ✅\nמה התאריך של האירוע?");
      return res.sendStatus(200);
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    // משתמש חדש
    if (!customer) {
      await supabase.from("customers").insert([
        { phone, step: 1 }
      ]);

      await sendMessage(chatId, "היי 🙌\nמה התאריך של האירוע?");
      return res.sendStatus(200);
    }

    const step = customer.step || 1;

    // ===== שלבים =====

    // שלב 1 – תאריך
    if (step === 1) {
      await supabase.from("customers")
        .update({ event_date: text, step: 2 })
        .eq("phone", phone);

      await sendMessage(chatId, "איזה אירוע זה? (חתונה / יום הולדת / בר/בת מצווה / אחר)");
      return res.sendStatus(200);
    }

    // שלב 2 – סוג אירוע
    if (step === 2) {
      await supabase.from("customers")
        .update({ event_type: text, step: 3 })
        .eq("phone", phone);

      if (text.includes("חתונ")) {
        await sendMessage(chatId, "מזל טוב! 🎉😍");
      }

      await sendMessage(chatId, "מאיפה לאיפה נוסעים?");
      return res.sendStatus(200);
    }

    // שלב 3 – מאיפה לאיפה
    if (step === 3) {
      await supabase.from("customers")
        .update({ route_from_to: text, step: 4 })
        .eq("phone", phone);

      await sendMessage(chatId, "איפה אוספים את החתן/כלה?");
      return res.sendStatus(200);
    }

    // שלב 4 – איסוף חתן/כלה
    if (step === 4) {
      await supabase.from("customers")
        .update({ pickup_location: text, step: 5 })
        .eq("phone", phone);

      await sendMessage(chatId, "איפה יהיו הצילומים?");
      return res.sendStatus(200);
    }

    // שלב 5 – צילומים + סיכום
    if (step === 5) {
      await supabase.from("customers")
        .update({ photos_location: text, step: 6 })
        .eq("phone", phone);

      const { data: updated } = await supabase
        .from("customers")
        .select("*")
        .eq("phone", phone)
        .maybeSingle();

      const summary =
        `✅ קיבלנו את הפרטים:\n` +
        `📅 תאריך: ${updated?.event_date}\n` +
        `🎉 אירוע: ${updated?.event_type}\n` +
        `🛣️ מאיפה לאיפה: ${updated?.route_from_to}\n` +
        `📍 איסוף חתן/כלה: ${updated?.pickup_location}\n` +
        `📸 צילומים: ${updated?.photos_location}\n\n` +
        `נציג יחזור אליך עם הצעת מחיר בהקדם 🙌\n` +
        `להתחלה מחדש כתוב: תפריט`;

      await sendMessage(chatId, summary);
      return res.sendStatus(200);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
