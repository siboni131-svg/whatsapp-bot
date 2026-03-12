const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

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
    payload?.messageData?.extendedTextMessage?.text ||
    payload?.messageData?.conversation ||
    ""
  );

}


async function sendGreenMessage(chatId, message) {

  if (!message || !message.trim()) {

    console.log("⚠️ message empty - skip send");
    return;

  }

  const url =
    `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  await axios.post(url, { chatId, message });

}


// ===== FAQ =====

function handleFAQ(message) {

  const text = message.toLowerCase();

  if (text.includes("כמה מקומות")) {
    return `בלימוזינה שלנו יש מקום לעד 8 נוסעים בנוחות 🚘`;
  }

  if (text.includes("כמה עולה") || text.includes("מחיר")) {
    return `המחיר משתנה לפי תאריך האירוע ומיקום האיסוף.
מה התאריך של האירוע?`;
  }

  if (text.includes("קריוקי")) {
    return `כן 😊 בלימוזינה יש מערכת קריוקי 🎤`;
  }

  if (text.includes("שתייה")) {
    return `כן 🙂 בלימוזינה מחכה לכם:
🍾 שמפניה
🥤 שתייה קלה
🧊 קרח`;
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

    const faqReply = handleFAQ(message);

    if (faqReply) {

      await sendGreenMessage(chatId, faqReply);
      return res.status(200).json({ ok: true });

    }


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

      reply = `שלום וברכה! 👋

איזה כיף שפנית אלינו ל-Eden Limousine 🚘✨  
אנחנו כאן כדי להפוך את היום שלכם לבלתי נשכח – בסטייל של הוליווד! 🎬🌟  

נשמח לקחת חלק ביום המיוחד שלכם.

מה התאריך של האירוע? 📅💍`;

      nextStep = "date";

    }


    else if (customer.step === "date") {

      await supabase
        .from("customers")
        .update({ event_date: message })
        .eq("phone", phone972);

      reply = `תאריך מעולה! 📅 ${message}  
זמן מושלם לחגיגה יוקרתית ☀️✨  
רשמתי לי במערכת! ✅

בחרו את סוג האירוע 👇

1️⃣ חתונה יוקרתית 💍  
2️⃣ בר/בת מצווה מהסרטים 🎉  
3️⃣ יום הולדת VIP 🎂  
4️⃣ נשף סיום נוצץ 🎓  
5️⃣ אירוע מיוחד ⭐  
6️⃣ לדבר עם נציג אנושי 📞`;

      nextStep = "event";

    }


    else if (customer.step === "event") {

      reply = `קולולולו! מזל טוב! 🎉💍  
שתהיה בשעה טובה! 🤵👰✨  

את מי אנחנו אוספים?

1️⃣ רק את החתן 🤵‍♂️  
2️⃣ רק את הכלה 👰‍♀️  
3️⃣ חתן וכלה 🤵‍♂️↔️👰‍♀️`;

      nextStep = "pickupWho";

    }


    else if (customer.step === "pickupWho") {

      reply = `מאיפה אוספים את החתן? 🤵‍♂️📍  
(עיר או כתובת כללית)`;

      nextStep = "pickupGroom";

    }


    else if (customer.step === "pickupGroom") {

      await supabase
        .from("customers")
        .update({ pickup_groom: message })
        .eq("phone", phone972);

      reply = `ומאיפה אוספים את הכלה? 👰‍♀️📍`;

      nextStep = "pickupBride";

    }


    else if (customer.step === "pickupBride") {

      await supabase
        .from("customers")
        .update({ pickup_bride: message })
        .eq("phone", phone972);

      reply = `נהדר! ✨

איפה תרצו לעשות את הצילומים לפני ההגעה לאולם? 📸  
אפשר לשלוח שם מקום או כתובת.

ואם עדיין לא החלטתם – כתבו "לא יודעים".`;

      nextStep = "photos";

    }


    else if (customer.step === "photos") {

      await supabase
        .from("customers")
        .update({ photo_location: message })
        .eq("phone", phone972);

      reply = `מה שם האולם או גן האירועים ובאיזו עיר הוא נמצא? 🏛`;

      nextStep = "hall";

    }


    else if (customer.step === "hall") {

      await supabase
        .from("customers")
        .update({ destination: message })
        .eq("phone", phone972);

      reply = `על איזה שם לרשום את ההזמנה? 😊`;

      nextStep = "name";

    }


    else if (customer.step === "name") {

      await supabase
        .from("customers")
        .update({ customer_name: message })
        .eq("phone", phone972);

      const { data: freshCustomer } = await supabase
        .from("customers")
        .select("*")
        .eq("phone", phone972)
        .maybeSingle();


      reply = `נעים מאוד, ${message}! 👋  
איזה כיף שיש לנו את כל הפרטים.

━━━━━━━━━━━━━━━

📅 תאריך האירוע: ${freshCustomer.event_date}  
📍 איסוף חתן: ${freshCustomer.pickup_groom}  
📍 איסוף כלה: ${freshCustomer.pickup_bride}  

📸 לוקיישן לצילומים: ${freshCustomer.photo_location}  
🏛 יעד: ${freshCustomer.destination}

━━━━━━━━━━━━━━━

שתדעו מה מחכה לכם בנסיעה המלכותית שלנו... 💎  
חוויה ברמה של 5 כוכבים! ⭐⭐⭐⭐⭐

מה מחכה לכם בתוך הלימוזינה המפוארת שלנו? 🥂🍾

🍸 אלכוהול חופשי ואיכותי  
וודקה, וויסקי ושמפניה קרה לאורך כל הדרך.

🤳 צילום סושיאל (BTS)  
הנהג מתעד רגעים מיוחדים מהנסיעה לסטורי מושלם.

🥤 בר שתייה  
שתייה קלה ומים מינרליים קרים.

🎶 מערכת סאונד מטורפת  
בלוטוס פתוח למוזיקה שלכם.

✨ תאורת LED ואווירה  
מועדון פרטי על גלגלים.

🛋 מושבי עור יוקרתיים  
נוחות מקסימלית ומרחב מפנק.

🤫 פרטיות מלאה  
חלונות מושחרים ומחיצה ביניכם לבין הנהג.

━━━━━━━━━━━━━━━

נציג מטעמנו יחזור אליכם בהקדם לאישור ההזמנה ולסגירת הפרטים 📞✨`;

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
