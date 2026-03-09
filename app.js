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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ===== HELPERS =====

function normalizeTo972(raw) {
  if (!raw) return "";
  let phone = String(raw).trim();
  if (phone.includes("@")) phone = phone.split("@")[0];
  phone = phone.replace(/\D/g, "");
  if (phone.startsWith("972")) return phone;
  if (phone.startsWith("0")) return "972" + phone.slice(1);
  return phone;
}

function extractText(payload) {
  return (
    payload?.messageData?.textMessageData?.textMessage ||
    payload?.messageData?.extendedTextMessageData?.text ||
    ""
  );
}

async function sendGreenMessage(chatId, message) {

  if (!message || !message.trim()) {
    console.log("⚠️ message empty - skip send");
    return;
  }

  const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  return axios.post(url, {
    chatId,
    message
  });
}

// ===== FAQ =====

function handleFAQ(message) {

  const text = message.toLowerCase();

  if (text.includes("כמה מקומות")) {
    return `בלימוזינה שלנו יש מקום לעד 8 נוסעים בנוחות 🚘
כך שאפשר להתחיל את החגיגה כבר בדרך לאירוע 🎉`;
  }

  if (text.includes("כמה עולה") || text.includes("מחיר")) {
    return `המחיר משתנה לפי תאריך האירוע ומיקום האיסוף.

נשמח להכין עבורכם הצעת מחיר 😊
מה התאריך של האירוע?`;
  }

  if (text.includes("קריוקי")) {
    return `כן 😊 בלימוזינה יש מערכת קריוקי ומסכים 🎤`;
  }

  if (text.includes("שתייה")) {
    return `כן 🙂 בלימוזינה מחכה לכם:

🍾 שמפניה / וודקה
🥤 XL
🥂 שתייה קלה
🧊 קרח`;
  }

  if (text.includes("מוזיקה")) {
    return `בטח 🎶 יש מערכת מוזיקה איכותית ואפשר לחבר טלפון`;
  }

  if (text.includes("קישוט")) {
    return `כן 🎀 קישוט הרכב כלול במחיר`;
  }

  if (text.includes("צילומים")) {
    return `כן 📸 עושים עצירות לצילומים בדרך לאולם`;
  }

  return null;
}

// ===== ROOT =====

app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

// ===== WEBHOOK =====

app.post("/webhook", async (req, res) => {

  try {

    const payload = req.body;

    if (payload?.typeWebhook !== "incomingMessageReceived") {
      return res.status(200).json({ ok: true });
    }

    const chatId = payload?.senderData?.chatId;

    if (!chatId || chatId.includes("@g.us")) {
      return res.status(200).json({ ok: true });
    }

    const senderRaw = payload?.senderData?.sender;
    const phone972 = normalizeTo972(senderRaw);

    const message = extractText(payload).trim();

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    console.log("📩 Incoming:", message);

    // ===== FAQ =====

    const faqReply = handleFAQ(message);

    if (faqReply) {

      await sendGreenMessage(chatId, faqReply);

      return res.status(200).json({ ok: true });

    }

    // ===== CUSTOMER =====

    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("phone", phone972)
      .maybeSingle();

    if (!customer) {

      const { data: newCustomer } = await supabase
        .from("customers")
        .insert([{ phone: phone972, step: "start" }])
        .select()
        .single();

      customer = newCustomer;

    }

    let reply = "";
    let nextStep = customer.step;

    // ===== FLOW =====

    if (customer.step === "start") {

      reply = `שלום וברכה 👋

תודה שפנית ל-Eden Limousine 🚘✨

נשמח לקחת חלק ביום המיוחד שלכם
ולהפוך את הנסיעה לחוויה בלתי נשכחת 🎬

מה התאריך של האירוע? 📅`;

      nextStep = "date";

    }

    else if (customer.step === "date") {

      await supabase
        .from("customers")
        .update({ event_date: message })
        .eq("phone", phone972);

      reply = `מזל טוב! 🤵👰💍

את מי אוספים?

1️⃣ חתן
2️⃣ כלה
3️⃣ חתן וכלה`;

      nextStep = "pickupWho";

    }

    else if (customer.step === "pickupWho") {

      reply = `מאיפה האיסוף? 📍
(עיר או כתובת כללית)`;

      nextStep = "pickup";

    }

    else if (customer.step === "pickup") {

      await supabase
        .from("customers")
        .update({ pickup_location: message })
        .eq("phone", phone972);

      reply = "מה שם האולם או גן האירועים? 🏛";

      nextStep = "destination";

    }

    else if (customer.step === "destination") {

      await supabase
        .from("customers")
        .update({ destination: message })
        .eq("phone", phone972);

      reply = "על איזה שם לרשום את ההזמנה?";

      nextStep = "name";

    }

    else if (customer.step === "name") {

      await supabase
        .from("customers")
        .update({ customer_name: message })
        .eq("phone", phone972);

      reply = `תודה רבה ${message}! 🙌

הפרטים נקלטו במערכת Eden Limousine 🚘✨

נציג מטעמנו יצור איתך קשר בהקדם 📞`;

      nextStep = "done";

    }

    await supabase
      .from("customers")
      .update({ step: nextStep })
      .eq("phone", phone972);

    await sendGreenMessage(chatId, reply);

    res.status(200).json({ ok: true });

  }

  catch (err) {

    console.error("Webhook error:", err.message);

    res.status(200).json({ ok: true });

  }

});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
