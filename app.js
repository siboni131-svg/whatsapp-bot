const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

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

    // חיפוש לקוח
    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("phone", phone)
      .single();

    // אם לא קיים – ליצור חדש
    if (!customer) {
      const { data } = await supabase
        .from("customers")
        .insert([{ phone, step: "start" }])
        .select()
        .single();

      customer = data;
    }

    let nextStep = customer.step;
    let reply = "";

    // ===== ניהול שלבים =====

    if (customer.step === "start") {
      reply =
        "היי 🙌 ברוך הבא ל-Eden Limousine\n\n" +
        "מה התאריך של האירוע?";
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

      reply =
        "מעולה 🙌\nקיבלנו את כל הפרטים.\nנציג יחזור אליך בהקדם!";
      nextStep = "done";
    }

    await supabase
      .from("customers")
      .update({ step: nextStep })
      .eq("phone", phone);

    const url = `https://${GREEN_INSTANCE_ID}.api.greenapi.com/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    await axios.post(url, {
      chatId: chatId,
      message: reply,
    });

    res.status(200).json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
