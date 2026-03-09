const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== ENV =====

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GREEN_API_URL = process.env.GREEN_API_URL;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase ENV");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// ===== helpers =====

function normalizeTo972(raw) {

  if (!raw) return "";

  let phone = String(raw).trim();

  if (phone.includes("@")) {
    phone = phone.split("@")[0];
  }

  phone = phone.replace(/\D/g, "");

  if (phone.startsWith("972")) return phone;

  if (phone.startsWith("0")) {
    return "972" + phone.slice(1);
  }

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

  const url =
    `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

  return axios.post(url, {
    chatId,
    message
  });
}

// ===== AI =====

async function askAI(message) {

  try {

    const response = await openai.responses.create({

      model: "gpt-4.1-mini",

      input: `
אתה נציג שירות של Eden Limousine.

החברה מספקת לימוזינות לאירועים:

חתונות
בר מצווה
ימי הולדת
נשפים

בלימוזינה יש:

2 מסכים
קריוקי
שמפניה
וודקה
שתייה קלה
קרח
צילום סושיאל
נהג צמוד

ענה בעברית בלבד.
ענה קצר וברור.

שאלת הלקוח:
${message}
`

    });

    return response.output_text;

  } catch (err) {

    console.error("AI error:", err.message);

    return "מצטערים, כרגע יש עומס במערכת. נציג יחזור אליך בהקדם.";

  }
}

// ===== test =====

app.get("/", (req, res) => {
  res.send("Server running");
});

// ===== webhook =====

app.post("/webhook", async (req, res) => {

  try {

    const payload = req.body;

    if (payload?.typeWebhook !== "incomingMessageReceived") {
      return res.sendStatus(200);
    }

    const chatId = payload?.senderData?.chatId;

    if (!chatId || chatId.includes("@g.us")) {
      return res.sendStatus(200);
    }

    const senderRaw =
      payload?.senderData?.sender ||
      payload?.senderData?.chatId ||
      "";

    const phone972 = normalizeTo972(senderRaw);

    const message = extractText(payload).trim();

    if (!message) {
      return res.sendStatus(200);
    }

    console.log("📩 Incoming:", phone972, message);

    // ===== find customer =====

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

    // ===== flow =====

    let reply = "";
    let nextStep = customer.step;

    if (customer.step === "start") {

      reply =
        "שלום וברכה 👋\n\n" +
        "ברוכים הבאים ל-Eden Limousine 🚘\n\n" +
        "מה התאריך של האירוע?";

      nextStep = "date";
    }

    else if (customer.step === "date") {

      await supabase
        .from("customers")
        .update({ event_date: message })
        .eq("phone", phone972);

      reply =
        "איזה סוג אירוע זה?\n\n" +
        "1 חתונה\n" +
        "2 בר מצווה\n" +
        "3 יום הולדת\n" +
        "4 נשף";

      nextStep = "event";
    }

    else if (customer.step === "event") {

      await supabase
        .from("customers")
        .update({ event_type: message })
        .eq("phone", phone972);

      reply = "מאיפה האיסוף?";

      nextStep = "pickup";
    }

    else if (customer.step === "pickup") {

      await supabase
        .from("customers")
        .update({ pickup_location: message })
        .eq("phone", phone972);

      reply = "לאן נוסעים? (שם האולם או העיר)";

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
        .update({
          customer_name: message
        })
        .eq("phone", phone972);

      reply =
        "תודה רבה 🙌\n\n" +
        "קיבלנו את הפרטים שלך.\n" +
        "נציג יחזור אליך בהקדם.";

      nextStep = "done";
    }

    else if (customer.step === "done") {

      const aiReply = await askAI(message);

      await sendGreenMessage(chatId, aiReply);

      return res.sendStatus(200);
    }

    await supabase
      .from("customers")
      .update({ step: nextStep })
      .eq("phone", phone972);

    await sendGreenMessage(chatId, reply);

    res.sendStatus(200);

  } catch (err) {

    console.error("Webhook error:", err.message);

    res.sendStatus(200);
  }
});

// ===== start =====

app.listen(PORT, () => {

  console.log("Server running on port", PORT);

});
