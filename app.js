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
    payload?.messageData?.extendedTextMessage?.text ||
    ""
  );
}

async function sendGreenMessage(chatId, message) {
  const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
  return axios.post(url, { chatId, message });
}

function eventFromChoice(text) {
  const t = String(text || "").trim();
  switch (t) {
    case "1":
      return "חתונה";
    case "2":
      return "בר/בת מצווה";
    case "3":
      return "יום הולדת";
    case "4":
      return "נשף";
    case "5":
      return "אירוע מיוחד";
    case "6":
      return "נציג";
    default:
      return t;
  }
}

function buildFinalMessages({ name, date, eventType, pickupText, destination, photos }) {
  // הודעה ראשונה – סיכום ההזמנה
  const summary = 
    `🎉 שלום ${name}!\n\n` +
    `תודה שפניתם ל-Eden Limousine 🚘✨\n\n` +
    `📅 תאריך האירוע: ${date}\n` +
    `🎈 סוג האירוע: ${eventType}\n` +
    `📍 איסוף: ${pickupText}\n` +
    (destination ? `🏛 יעד/הורדה: ${destination}\n` : "") +
    (photos !== undefined ? `האם היו צילומים לאירוע? ${photos}\n` : "") +
    `\nבין השירותים שלנו:\n` +
    `- 2 מסכי צפייה\n` +
    `- אינטרנט מהיר\n` +
    `- קריוקי מהנה\n` +
    `- שתייה קלה ומוגזת\n` +
    `- צילום סושיאל בלימוזינה\n` +
    `- נהג צמוד\n` +
    `- קישוט ידיות הרכב`;

  // הודעה שנייה – קריאה לעקוב + נציג
  const followup = 
    `📸 עקוב אחרינו ברשתות החברתיות:\n` +
    `Instagram: https://www.instagram.com/edenlimousine\n` +
    `TikTok: https://www.tiktok.com/@edenlimousine\n\n` +
    `נציג מטעמנו יצור איתך קשר בקרוב 📞`;

  return [summary, followup];
}

app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    if (payload?.typeWebhook !== "incomingMessageReceived") {
      return res.status(200).json({ ok: true, ignored: "not incomingMessageReceived" });
    }

    const chatId = payload?.senderData?.chatId;
    if (!chatId || chatId.includes("@g.us")) {
      return res.status(200).json({ ok: true, ignored: "group or no chatId" });
    }

    const senderRaw = payload?.senderData?.sender || payload?.senderData?.chatId || "";
    const phone972 = normalizeTo972(senderRaw);
    const message = extractText(payload).trim();
    if (!message) return res.status(200).json({ ok: true, ignored: "no text message" });

    console.log("📩 Incoming:", { chatId, phone972, message });

    // ===== חיפוש/יצירת לקוח =====
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

    // ===== RESET =====
    if (message === "התחלה") {
      await supabase
        .from("customers")
        .update({
          step: "start",
          event_date: null,
          event_type: null,
          pickup_location: null,
          destination: null,
          customer_name: null,
        })
        .eq("phone", phone972);

      await sendGreenMessage(chatId, "מעולה 👌 מתחילים מחדש.\n\nמה התאריך של האירוע?");
      return res.status(200).json({ ok: true, reset: true });
    }

    let reply = "";
    let nextStep = customer.step;

    // ===== ניהול שלבים =====
    if (customer.step === "start") {
      reply = "שלום וברכה! 👋\nמה התאריך של האירוע שלכם? (לדוגמה: 01/01/2026)";
      nextStep = "date";
    }
    else if (customer.step === "date") {
      await supabase.from("customers").update({ event_date: message }).eq("phone", phone972);
      reply = "איזה סוג אירוע זה?\n1️⃣ חתונה 💍\n2️⃣ בר/בת מצווה 🎉\n3️⃣ יום הולדת 🎂\n4️⃣ נשף 🎓\n5️⃣ אירוע מיוחד ⭐\n6️⃣ נציג אנושי 📞";
      nextStep = "event";
    }
    else if (customer.step === "event") {
      const eventType = eventFromChoice(message);
      if (eventType === "נציג") {
        reply = "מעולה 👌 נציג מטעמנו יחזור אליך בהקדם 📞";
        nextStep = "done";
      } else {
        await supabase.from("customers").update({ event_type: eventType }).eq("phone", phone972);
        if (eventType === "חתונה") {
          reply = "מזל טוב! 🎉💍 מי אוספים?\n1️⃣ חתן\n2️⃣ כלה\n3️⃣ חתן וכלה";
          nextStep = "wedding_pickwho";
        } else {
          reply = "מעולה 🙌 מאיפה האיסוף? (עיר או כתובת כללית)";
          nextStep = "pickup";
        }
      }
    }
    else if (customer.step === "wedding_pickwho") {
      const choice = String(message).trim();
      if (!["1","2","3"].includes(choice)) {
        reply = "שלחו רק 1, 2 או 3 🙏";
        nextStep = "wedding_pickwho";
      } else {
        await supabase.from("customers").update({ pickup_who: choice }).eq("phone", phone972);
        reply = choice === "1" ? "איפה האיסוף של החתן?" :
                choice === "2" ? "איפה האיסוף של הכלה?" :
                "איפה האיסוף של החתן והכלה?";
        nextStep = "wedding_pickup1";
      }
    }
    else if (customer.step === "wedding_pickup1") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone972);
      reply = "מה שם האולם / גן האירועים ובאיזו עיר הוא נמצא?";
      nextStep = "destination";
    }
    else if (customer.step === "pickup") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone972);
      reply = "מה שם האולם / עיר יעד?";
      nextStep = "destination";
    }
    else if (customer.step === "destination") {
      await supabase.from("customers").update({ destination: message }).eq("phone", phone972);
      reply = "על איזה שם להכין את הצעת המחיר? 😊";
      nextStep = "name";
    }
    else if (customer.step === "name") {
      await supabase.from("customers").update({ customer_name: message }).eq("phone", phone972);

      const { data: freshCustomer } = await supabase
        .from("customers")
        .select("*")
        .eq("phone", phone972)
        .maybeSingle();

      const name = freshCustomer?.customer_name || message;
      const date = freshCustomer?.event_date || "";
      const eventType = freshCustomer?.event_type || "";
      const pickupText = freshCustomer?.pickup_location || "";
      const destination = freshCustomer?.destination || "";
      const photos = eventType === "חתונה" ? freshCustomer?.photos || "לא היה" : undefined;

      const [summary, followup] = buildFinalMessages({ name, date, eventType, pickupText, destination, photos });

      // שליחת שתי הודעות נפרדות
      try { await sendGreenMessage(chatId, summary); } catch(e){console.error(e);}
      try { await sendGreenMessage(chatId, followup); } catch(e){console.error(e);}

      nextStep = "done";
      return res.status(200).json({ ok: true });
    }
    else if (customer.step === "done") {
      reply = "כבר קיבלנו את הפרטים ✅ אם תרצה להתחיל מחדש כתוב: התחלה";
      nextStep = "done";
    }
    else {
      reply = "היי 🙌 כתוב 'התחלה' כדי להתחיל.";
      nextStep = "start";
    }

    // עדכון שלב
    await supabase.from("customers").update({ step: nextStep }).eq("phone", phone972);

    if (reply && reply.trim()) {
      try { await sendGreenMessage(chatId, reply); } catch(e){console.error(e);}
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Webhook fatal error:", err.message);
    return res.status(200).json({ ok: true });
  }
});

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
