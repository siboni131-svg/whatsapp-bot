const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== ENV =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GREEN_API_URL = process.env.GREEN_API_URL; // דוגמה: https://7105.api.greenapi.com
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase ENV variables");
  process.exit(1);
}
if (!GREEN_API_URL || !GREEN_API_TOKEN || !GREEN_INSTANCE_ID) {
  console.error("Missing Green API ENV variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

// --- helper: normalize to 972xxxxxxxxx ---
function normalizeILPhone(phone) {
  if (!phone) return "";
  phone = String(phone).trim();

  // אם מגיע ככה: "9725xxxxxxx@c.us"
  if (phone.includes("@")) phone = phone.split("@")[0];

  // לנקות תווים
  phone = phone.replace(/[^\d]/g, "");

  // 0XXXXXXXXX -> 972XXXXXXXXX
  if (phone.startsWith("0")) phone = "972" + phone.slice(1);

  // כבר 972...
  if (phone.startsWith("972")) return phone;

  // אם הגיע בלי 0 ובלי 972 (למשל 5xxxxxxxx) -> 972 + זה
  if (phone.length === 9 && phone.startsWith("5")) return "972" + phone;

  return phone; // fallback
}

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    // ✅ להגיב רק על הודעה נכנסת
    if (payload?.typeWebhook && payload.typeWebhook !== "incomingMessageReceived") {
      return res.status(200).json({ ok: true });
    }

    let chatId = payload?.senderData?.chatId;

    // חסימת קבוצות
    if (!chatId || chatId.includes("@g.us")) {
      return res.status(200).json({ ok: true });
    }

    // sender יכול להגיע כ"9725...@c.us"
    let phoneRaw = payload?.senderData?.sender || chatId;
    const phone = normalizeILPhone(phoneRaw);

    const message =
      payload?.messageData?.textMessageData?.textMessage ||
      payload?.messageData?.extendedTextMessage?.text ||
      "";

    // אם אין טקסט, לא להגיב
    if (!message.trim()) {
      return res.status(200).json({ ok: true });
    }

    // ===== חיפוש לקוח =====
    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    // אם לא קיים → ליצור
    if (!customer) {
      const { data: newCustomer } = await supabase
        .from("customers")
        .insert([{ phone, step: "start" }])
        .select()
        .single();

      customer = newCustomer;
    }

    let reply = "";
    let nextStep = customer.step;

    // ===== ניהול שלבים =====
    if (customer.step === "start") {
      reply = "היי 🙌 ברוך הבא ל-Eden Limousine\n\nמה התאריך של האירוע?";
      nextStep = "date";
    } else if (customer.step === "date") {
      await supabase.from("customers").update({ event_date: message }).eq("phone", phone);
      reply = "איזה אירוע זה? (חתונה / בר מצווה / אחר)";
      nextStep = "event";
    } else if (customer.step === "event") {
      await supabase.from("customers").update({ event_type: message }).eq("phone", phone);
      reply = message.includes("חתונה") ? "מזל טוב 🎉\nאיפה אוספים את החתן?" : "מעולה 🙌\nאיפה האיסוף?";
      nextStep = "pickup";
    } else if (customer.step === "pickup") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone);
      reply = "לאן נוסעים?";
      nextStep = "destination";
    } else if (customer.step === "destination") {
      await supabase.from("customers").update({ destination: message }).eq("phone", phone);
      reply = "מעולה 🙌 קיבלנו את כל הפרטים. נציג יחזור אליך בהקדם!";
      nextStep = "done";
    } else if (customer.step === "done") {
      reply = "כבר קיבלנו את הפרטים ✅ אם תרצה להתחיל מחדש כתוב: התחלה";
      if (message.includes("התחלה")) {
        reply = "סבבה 🙌 מה התאריך של האירוע?";
        nextStep = "date";
      }
    }

    // עדכון שלב
    await supabase.from("customers").update({ step: nextStep }).eq("phone", phone);

    // ===== שליחת הודעה ל-WhatsApp =====
    const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    // ✅ chatId כבר בא נכון, אבל אם תרצה לשלוח לפי מספר:
    // const chatIdToSend = `${phone}@c.us`;

    await axios.post(url, {
      chatId: chatId,
      message: reply,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err.message);
    return res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
