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
    case "1": return "חתונה יוקרתית 💍";
    case "2": return "בר/בת מצווה מהסרטים 🎧";
    case "3": return "יום הולדת VIP 🎂";
    case "4": return "נשף סיום נוצץ 🎓";
    case "5": return "אירוע מיוחד ⭐";
    case "6": return "נציג";
    default: return t;
  }
}

function buildFinalMessages({ name }) {
  // הודעה ראשונה – פינוקים (ללא כיבוד קל)
  const summary = 
    `נעים מאוד, **${name}**! 👋 איזה כיף שיש לנו את כל הפרטים.\n\n` +
    `שתדע מה מחכה לכם בנסיעה המלכותית... 💎 רמה של 5 כוכבים! ⭐⭐⭐⭐⭐\n\n` +
    `**מה מחכה לכם בתוך הלימוזינה המפוארת שלנו?** 🥂🍾\n\n` +
    `* 🍸 **אלכוהול חופשי ואיכותי** – וודקה, וויסקי ושמפניה קרה לאורך כל הדרך!\n` +
    `* 🤳 **צילום סושיאל (BTS)** – הנהג שלנו מתעד לכם רגעים מטורפים מהנסיעה לסטורי מושלם!\n` +
    `* 🥤 **בר שתייה** – שתייה קלה ומים מינרליים קרים.\n` +
    `* 🎶 **מערכת סאונד מטורפת** – בלוטוס פתוח למוזיקה שלכם.\n` +
    `* ✨ **תאורת LED ואווירה** – מועדון פרטי על גלגלים.\n` +
    `* 🛋️ **נוחות מקסימלית** – מושבי עור יוקרתיים ומרווחים.\n` +
    `* 🤫 **פרטיות מלאה** – חלונות מושחרים ומחיצה ביניכם לבין הנהג.`;

  // הודעה שנייה – רשתות וחזרה של נציג
  const followup = 
    `**רוצים לראות איך זה נראה בלייב? עקבו אחרינו!** 👇✨\n\n` +
    `🌐 אתר: https://www.edenlimousine.co.il\n` +
    `📸 אינסטגרם: https://www.instagram.com/edenlimousine\n` +
    `🎥 טיקטוק: https://www.tiktok.com/@edenlimousine\n\n` +
    `**${name}, נציג שלנו כבר עובר על הנתונים ויחזור אליך כאן בצ'אט עם מחיר שאי אפשר לסרב לו!** 💎🔥`;

  return [summary, followup];
}

app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    if (payload?.typeWebhook !== "incomingMessageReceived") return res.status(200).send();

    const chatId = payload?.senderData?.chatId;
    if (!chatId || chatId.includes("@g.us")) return res.status(200).send();

    const senderRaw = payload?.senderData?.sender || chatId;
    const phone972 = normalizeTo972(senderRaw);
    const message = extractText(payload).trim();
    if (!message) return res.status(200).send();

    // חיפוש/יצירת לקוח
    let { data: customer } = await supabase.from("customers").select("*").eq("phone", phone972).maybeSingle();
    if (!customer) {
      const { data: newCust } = await supabase.from("customers").insert([{ phone: phone972, step: "start" }]).select().single();
      customer = newCust;
    }

    // RESET
    if (message === "התחלה") {
      await supabase.from("customers").update({ step: "start", event_date: null, event_type: null, pickup_location: null, destination: null, customer_name: null }).eq("phone", phone972);
      await sendGreenMessage(chatId, "מעולה 👌 מתחילים מחדש.\n\nמה התאריך של האירוע?");
      return res.status(200).send();
    }

    let reply = "";
    let nextStep = customer.step;

    if (customer.step === "start") {
      reply = "היי! איזה כיף שפנית אלינו! 👋🎊\nאנחנו כאן כדי להפוך את היום שלכם לבלתי נשכח, בסטייל של הוליווד! 🎬🌟\n\n**מה התאריך של האירוע?** 🗓️💖";
      nextStep = "date";
    } 
    else if (customer.step === "date") {
      await supabase.from("customers").update({ event_date: message }).eq("phone", phone972);
      reply = `תאריך מעולה! **${message}** – זמן מושלם לחגיגה יוקרתית. ☀️✨ רשמתי לי! ✅\n\n**מה אנחנו חוגגים?**\n1️⃣ חתונה יוקרתית 💍\n2️⃣ בר/בת מצווה מהסרטים 🎉\n3️⃣ יום הולדת VIP 🎂\n4️⃣ נשף סיום נוצץ 🎓\n5️⃣ אירוע מיוחד ⭐\n6️⃣ נציג אנושי 📞`;
      nextStep = "event";
    }
    else if (customer.step === "event") {
      const ev = eventFromChoice(message);
      if (ev === "נציג") {
        reply = "מעולה 👌 נציג מטעמנו יחזור אליך בהקדם 📞";
        nextStep = "done";
      } else {
        await supabase.from("customers").update({ event_type: ev }).eq("phone", phone972);
        if (ev.includes("חתונה")) {
          reply = "קולולולו! מזל טוב! 🎉💍 שיהיה בשעה טובה!\n\n**את מי אנחנו אוספים?**\n1️⃣ רק את החתן 🤵‍♂️\n2️⃣ רק את הכלה 👰‍♀️\n3️⃣ איסוף משולב (גם חתן וגם כלה בנפרד) 🤵‍♂️↔️👰‍♀️";
          nextStep = "wedding_pickwho";
        } else {
          reply = "מעולה 🙌 מאיפה האיסוף? (עיר או כתובת)";
          nextStep = "pickup";
        }
      }
    }
    else if (customer.step === "wedding_pickwho") {
      await supabase.from("customers").update({ pickup_who: message }).eq("phone", phone972);
      reply = (message === "3") ? "**OMG!!!** 🥂✨ איסוף משולב?? מטורף!\n\nמאיפה אוספים את החתן?" : "מאיפה האיסוף?";
      nextStep = "wedding_pickup1";
    }
    else if (customer.step === "wedding_pickup1") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone972);
      reply = "איפה מתוכננים להיות הצילומים? 📸🌟\n(או כתבו 'עדיין לא יודעים')";
      nextStep = "photos";
    }
    else if (customer.step === "photos") {
      await supabase.from("customers").update({ photos: message }).eq("phone", phone972);
      reply = "ומה שם האולם ובאיזו עיר הוא נמצא? 🏰🥂";
      nextStep = "destination";
    }
    else if (customer.step === "pickup") {
      await supabase.from("customers").update({ pickup_location: message }).eq("phone", phone972);
      reply = "מה שם האולם / עיר יעד? 🏰🥂";
      nextStep = "destination";
    }
    else if (customer.step === "destination") {
      await supabase.from("customers").update({ destination: message }).eq("phone", phone972);
      reply = "אנחנו כבר ממש בסוף! על איזה שם להכין את הצעת המחיר? ✍️✨";
      nextStep = "name";
    }
    else if (customer.step === "name") {
      await supabase.from("customers").update({ customer_name: message, step: "done" }).eq("phone", phone972);
      const [summary, followup] = buildFinalMessages({ name: message });
      await sendGreenMessage(chatId, summary);
      await sendGreenMessage(chatId, followup);
      return res.status(200).send();
    }
    else if (customer.step === "done") {
      reply = "הפרטים אצלנו ✅ נציג יחזור אליך בקרוב. (לשינוי כתוב 'התחלה')";
    }

    await supabase.from("customers").update({ step: nextStep }).eq("phone", phone972);
    if (reply) await sendGreenMessage(chatId, reply);

    return res.status(200).send();
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    return res.status(200).send();
  }
});

app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
