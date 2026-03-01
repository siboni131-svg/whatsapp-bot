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
      // אם כתב טקסט חופשי במקום מספר
      return t;
  }
}

function buildFinalMessage({ name, date, eventType, pickupText, destination }) {
  return (
    `תודה רבה, ${name}! 🙌\n\n` +
    `הפרטים שלך נקלטו בהצלחה במערכת Eden Limousine 🚘✨\n\n` +
    `📅 תאריך: ${date}\n` +
    `🎉 אירוע: ${eventType}\n` +
    `📍 ${pickupText}\n` +
    `🏛 יעד/אולם: ${destination}\n\n` +
    `להלן מה שכלול בלימוזינה שלנו:\n\n` +
    `📺 2 מסכי צפייה\n` +
    `📍 אינטרנט קבוע\n` +
    `🎤 קריוקי\n` +
    `🍾 שמפניה / וודקה\n` +
    `🫗 אקס ל\n` +
    `🧊 קרח\n` +
    `🥂 שתייה קלה מכל הסוגים\n` +
    `📸 צילום סושיאל בלימוזינה\n` +
    `👨‍✈️ נהג צמוד\n` +
    `🎀 קישוט ידיות הרכב\n\n` +
    `נציג מטעמנו יצור איתך קשר בהקדם לאישור סופי ולסגירת הפרטים 📞\n\n` +
    `אנו מזמינים אותך לעקוב אחרינו ברשתות החברתיות:\n` +
    `📸 אינסטגרם: https://www.instagram.com/edenlimousine\n` +
    `🎵 טיק טוק: https://www.tiktok.com/@edenlimousine\n\n` +
    `אם יש לך שאלות נוספות — אני כאן 😊`
  );
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

    if (!message) {
      console.log("ℹ️ Incoming webhook without text. Skipping reply.");
      return res.status(200).json({ ok: true, ignored: "no text message" });
    }

    console.log("📩 Incoming:", { chatId, phone972, message });

    // ===== חיפוש/יצירת לקוח =====
    let { data: customer, error: findErr } = await supabase
      .from("customers")
      .select("*")
      .eq("phone", phone972)
      .maybeSingle();

    if (findErr) {
      console.error("❌ Supabase find error:", findErr.message);
      return res.status(200).json({ ok: true });
    }

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

    // ===== RESET =====
    if (message === "התחלה") {
      await supabase
        .from("customers")
        .update({
          step: "start",
          event_date: null,
          event_type: null,
          pickup_who: null,
          pickup_location: null,
          pickup1_location: null,
          pickup2_location: null,
          destination: null,
          customer_name: null,
        })
        .eq("phone", phone972);

      await sendGreenMessage(
        chatId,
        "מעולה 👌 מתחילים מחדש.\n\nמה התאריך של האירוע?\nלדוגמא: 01/01/2026"
      );
      return res.status(200).json({ ok: true, reset: true });
    }

    let reply = "";
    let nextStep = customer.step;

    // ===== ניהול שלבים =====
    if (customer.step === "start") {
      reply =
        "שלום וברכה! 👋\n" +
        "תודה שפנית ל-Eden Limousine 🚘✨\n\n" +
        "מה התאריך של האירוע שלכם?\n" +
        "לדוגמא: 01/01/2026";
      nextStep = "date";
    }

    else if (customer.step === "date") {
      await supabase.from("customers").update({ event_date: message }).eq("phone", phone972);

      reply =
        "תודה! קיבלתי ✅\n\n" +
        "איזה סוג אירוע זה?\n" +
        "1️⃣ חתונה 💍\n" +
        "2️⃣ בר/בת מצווה 🎉\n" +
        "3️⃣ יום הולדת 🎂\n" +
        "4️⃣ נשף 🎓\n" +
        "5️⃣ אירוע מיוחד ⭐\n" +
        "6️⃣ נציג אנושי 📞";
      nextStep = "event";
    }

    else if (customer.step === "event") {
      const eventType = eventFromChoice(message);

      // 6 = נציג
      if (eventType === "נציג") {
        reply = "מעולה 👌\nנציג מטעמנו יחזור אליך בהקדם 📞";
        nextStep = "done";
      } else {
        await supabase.from("customers").update({ event_type: eventType }).eq("phone", phone972);

        if (eventType === "חתונה") {
          reply =
            "מזל טוב! 🎉💍\n" +
            "אנחנו מתרגשים לקחת חלק ביום המיוחד שלכם ✨🚘\n\n" +
            "את מי אוספים?\n" +
            "1️⃣ חתן\n" +
            "2️⃣ כלה\n" +
            "3️⃣ חתן וכלה";
          nextStep = "wedding_pickwho";
        } else {
          reply = "מעולה 🙌\nמאיפה האיסוף? (עיר או כתובת כללית)";
          nextStep = "pickup";
        }
      }
    }

    // חתונה: מי אוספים
    else if (customer.step === "wedding_pickwho") {
      const choice = String(message).trim();
      if (!["1", "2", "3"].includes(choice)) {
        reply = "כדי שנמשיך, שלחו רק 1, 2 או 3 🙏";
        nextStep = "wedding_pickwho";
      } else {
        await supabase.from("customers").update({ pickup_who: choice }).eq("phone", phone972);

        if (choice === "1") {
          reply = "מעולה 🙌\nמאיפה אוספים את החתן? (עיר או כתובת כללית)";
        } else if (choice === "2") {
          reply = "מעולה 🙌\nמאיפה אוספים את הכלה? (עיר או כתובת כללית)";
        } else {
          reply = "מעולה 🙌\nמאיפה אוספים את החתן? (עיר או כתובת כללית)";
        }
        nextStep = "wedding_pickup1";
      }
    }

    // חתונה: איסוף ראשון
    else if (customer.step === "wedding_pickup1") {
      await supabase.from("customers").update({ pickup1_location: message }).eq("phone", phone972);

      const who = customer.pickup_who;
      if (who === "3") {
        reply = "ומאיפה אוספים את הכלה? (עיר או כתובת כללית)";
        nextStep = "wedding_pickup2";
      } else {
        reply = "מה שם האולם / גן האירועים ובאיזו עיר הוא נמצא? (לדוגמה: דימול באשדוד)";
        nextStep = "destination";
      }
    }

    // חתונה: איסוף שני (רק אם בחרו שניהם)
    else if (customer.step === "wedding_pickup2") {
      await supabase.from("customers").update({ pickup2_location: message }).eq("phone", phone972);

      reply = "מה שם האולם / גן האירועים ובאיזו עיר הוא נמצא? (לדוגמה: דימול באשדוד)";
      nextStep = "destination";
    }

    // לא חתונה: איסוף
    else if (customer.step === "pickup") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone972);

      reply = "לאן נוסעים? (שם האולם / עיר יעד)";
      nextStep = "destination";
    }

    // יעד/אולם
    else if (customer.step === "destination") {
      await supabase.from("customers").update({ destination: message }).eq("phone", phone972);

      reply =
        "מעולה 🙌 קיבלתי את כל הפרטים.\n\n" +
        "לצורך הכנת הצעת מחיר מסודרת, על איזה שם לרשום? 😊";
      nextStep = "name";
    }

    // שם להצעת מחיר + הודעה סופית ארוכה
    else if (customer.step === "name") {
      await supabase.from("customers").update({ customer_name: message }).eq("phone", phone972);

      // שליפה מחדש כדי להיות בטוחים שהכל עדכני
      const { data: freshCustomer } = await supabase
        .from("customers")
        .select("*")
        .eq("phone", phone972)
        .maybeSingle();

      const name = freshCustomer?.customer_name || message;
      const date = freshCustomer?.event_date || "";
      const eventType = freshCustomer?.event_type || "";
      const destination = freshCustomer?.destination || "";

      let pickupText = "";
      if (eventType === "חתונה") {
        const who = freshCustomer?.pickup_who;
        const p1 = freshCustomer?.pickup1_location || "";
        const p2 = freshCustomer?.pickup2_location || "";

        if (who === "1") pickupText = `איסוף חתן: ${p1}`;
        else if (who === "2") pickupText = `איסוף כלה: ${p1}`;
        else pickupText = `איסוף חתן: ${p1}\n📍 איסוף כלה: ${p2}`;
      } else {
        pickupText = `איסוף: ${freshCustomer?.pickup_location || ""}`;
      }

      reply = buildFinalMessage({ name, date, eventType, pickupText, destination });
      nextStep = "done";
    }

    else if (customer.step === "done") {
      reply =
        "כבר קיבלנו את הפרטים ✅\n" +
        "אם תרצה להתחיל מחדש כתוב: התחלה";
      nextStep = "done";
    }

    else {
      reply = "היי 🙌 כתוב 'התחלה' כדי להתחיל.";
      nextStep = "start";
    }

    // ✅ עדכון שלב
    await supabase.from("customers").update({ step: nextStep }).eq("phone", phone972);

    // ✅ לא לשלוח הודעה ריקה
    if (!reply || !reply.trim()) {
      console.log("⚠️ No reply text generated. Skipping send.");
      return res.status(200).json({ ok: true, skipped: "empty reply" });
    }

    // ✅ שליחה ל-Green API
    try {
      await sendGreenMessage(chatId, reply);
      console.log("✅ Sent reply:", reply);
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      console.error("❌ Green API error:", status, data || e.message);
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
