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
  console.error("Missing Supabase ENV variables");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    const chatId = payload?.senderData?.chatId;

    // חסימת קבוצות
    if (!chatId || chatId.includes("@g.us")) {
      return res.status(200).json({ ok: true });
    }

    let phone = payload?.senderData?.sender;

    if (phone.includes("@")) {
      phone = phone.split("@")[0];
    }

    const message =
      payload?.messageData?.textMessageData?.textMessage ||
      payload?.messageData?.extendedTextMessage?.text ||
      "";

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
    }

    else if (customer.step === "date") {
      await supabase
        .from("customers")
        .update({ event_date: message })
        .eq("phone", phone);

      reply = "איזה אירוע זה? (חתונה / בר מצווה / אחר)";
      nextStep = "event";
    }

    else if (customer.step === "event") {
      await supabase
        .from("customers")
        .update({ event_type: message })
        .eq("phone", phone);

      if (message.includes("חתונה")) {
        reply = "מזל טוב 🎉\nאיפה אוספים את החתן?";
      } else {
        reply = "מעולה 🙌\nאיפה האיסוף?";
      }

      nextStep = "pickup";
    }

    else if (customer.step === "pickup") {
      await supabase
        .from("customers")
        .update({ pickup_location: message })
        .eq("phone", phone);

      reply = "לאן נוסעים?";
      nextStep = "destination";
    }

    else if (customer.step === "destination") {
      await supabase
        .from("customers")
        .update({ destination: message })
        .eq("phone", phone);

      reply = "מעולה 🙌 קיבלנו את כל הפרטים. נציג יחזור אליך בהקדם!";
      nextStep = "done";
    }

    // עדכון שלב
    await supabase
      .from("customers")
      .update({ step: nextStep })
      .eq("phone", phone);

    // ===== שליחת הודעה ל-WhatsApp =====
    const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    await axios.post(url, {
      chatId: chatId,
      message: reply,
    });

    res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
