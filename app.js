const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== ENV =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GREEN_API_URL = process.env.GREEN_API_URL; // לדוגמה: https://7105.api.greenapi.com
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase ENV variables");
  process.exit(1);
}
if (!GREEN_API_URL || !GREEN_API_TOKEN || !GREEN_INSTANCE_ID) {
  console.error("❌ Missing Green API ENV variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ===== helpers =====
function normalizeTo972(raw) {
  // input יכול להיות: "0501234567", "972501234567", "0501234567@c.us", "+972501234567"
  if (!raw) return "";

  let phone = String(raw).trim();

  // remove whatsapp suffix
  if (phone.includes("@")) phone = phone.split("@")[0];

  // keep only digits
  phone = phone.replace(/\D/g, "");

  // already starts with 972
  if (phone.startsWith("972")) return phone;

  // starts with 0 (ישראלי) -> replace 0 with 972
  if (phone.startsWith("0")) return "972" + phone.slice(1);

  // fallback: return as-is
  return phone;
}

function extractText(payload) {
  return (
    payload?.messageData?.textMessageData?.textMessage ||
    payload?.messageData?.extendedTextMessageData?.text ||
    payload?.messageData?.extendedTextMessage?.text ||
    ""
  );
}

async function sendGreenMessage(chatId, message) {
  const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
  return axios.post(url, { chatId, message });
}

app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    // ✅ 1) סינון: להגיב רק להודעות נכנסות אמיתיות
    if (payload?.typeWebhook !== "incomingMessageReceived") {
      return res.status(200).json({ ok: true, ignored: "not incomingMessageReceived" });
    }

    const chatId = payload?.senderData?.chatId;

    // ✅ 2) חסימת קבוצות/חוסר chatId
    if (!chatId || chatId.includes("@g.us")) {
      return res.status(200).json({ ok: true, ignored: "group or no chatId" });
    }

    // ✅ 3) חילוץ טלפון והמרה ל-972
    const senderRaw = payload?.senderData?.sender || payload?.senderData?.chatId || "";
    const phone972 = normalizeTo972(senderRaw);

    // ✅ 4) חילוץ טקסט
    const message = extractText(payload).trim();

    // אם אין טקסט — לא מנסים לענות (מונע 400)
    if (!message) {
      console.log("ℹ️ Incoming webhook without text. Skipping reply.");
      return res.status(200).json({ ok: true, ignored: "no text message" });
    }

    console.log("📩 Incoming:", { chatId, phone972, message });

    // ===== חיפוש לקוח =====
    let { data: customer, error: findErr } = await supabase
      .from("customers")
      .select("*")
      .eq("phone", phone972)
      .maybeSingle();

    if (findErr) {
      console.error("❌ Supabase find error:", findErr.message);
      return res.status(200).json({ ok: true }); // לא להפיל webhook
    }

    // אם לא קיים → ליצור
    if (!customer) {
      const { data: newCustomer, error: insertErr } = await supabase
        .from("customers")
        .insert([{ phone: phone972, step: "start" }])
        .select()
        .single();

      if (insertErr) {
        console.error("❌ Supabase insert error:", insertErr.message);
        return res.status(200).json({ ok: true });
      }

      customer = newCustomer;
    }

    let reply = "";
    let nextStep = customer.step;

    // ===== ניהול שלבים =====
    if (customer.step === "start") {
      reply = "היי 🙌 ברוך הבא ל-Eden Limousine\n\nמה התאריך של האירוע?";
      nextStep = "date";
    } else if (customer.step === "date") {
      await supabase.from("customers").update({ event_date: message }).eq("phone", phone972);
      reply = "איזה אירוע זה? (חתונה / בר מצווה / אחר)";
      nextStep = "event";
    } else if (customer.step === "event") {
      await supabase.from("customers").update({ event_type: message }).eq("phone", phone972);

      if (message.includes("חתונה")) {
        reply = "מזל טוב 🎉\nאיפה אוספים את החתן?";
      } else {
        reply = "מעולה 🙌\nאיפה האיסוף?";
      }
      nextStep = "pickup";
    } else if (customer.step === "pickup") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone972);
      reply = "לאן נוסעים?";
      nextStep = "destination";
    } else if (customer.step === "destination") {
      await supabase.from("customers").update({ destination: message }).eq("phone", phone972);
      reply = "מעולה 🙌 קיבלנו את כל הפרטים. נציג יחזור אליך בהקדם!";
      nextStep = "done";
    } else if (customer.step === "done") {
      reply = "כבר קיבלנו את הפרטים ✅\nאם תרצה להתחיל מחדש כתוב: התחלה";
      // אפשר גם לאפשר ריסט:
      if (message === "התחלה") {
        await supabase.from("customers").update({ step: "start" }).eq("phone", phone972);
        reply = "מעולה 👌 מתחילים מחדש.\nמה התאריך של האירוע?";
        nextStep = "date";
      } else {
        nextStep = "done";
      }
    } else {
      // fallback אם step לא מוכר
      reply = "היי 🙌 כתוב 'התחלה' כדי להתחיל.";
      nextStep = "start";
    }

    // ✅ 5) עדכון שלב
    await supabase.from("customers").update({ step: nextStep }).eq("phone", phone972);

    // ✅ 6) לא לשלוח הודעה ריקה אף פעם
    if (!reply || !reply.trim()) {
      console.log("⚠️ No reply text generated. Skipping send.");
      return res.status(200).json({ ok: true, skipped: "empty reply" });
    }

    // ✅ 7) שליחה ל-Green API
    try {
      await sendGreenMessage(chatId, reply);
      console.log("✅ Sent reply:", reply);
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      console.error("❌ Green API error:", status, data || e.message);
      // לא להפיל webhook
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Webhook fatal error:", err.message);
    return res.status(200).json({ ok: true }); // תמיד 200 ל-webhook
  }
});

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
