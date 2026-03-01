// app.js
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ====== ENV ======
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID; // לדוגמה: 7105448796

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase ENV variables");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ====== Health check ======
app.get("/", (req, res) => {
  res.send("השרת עובד ✅");
});

// ====== Webhook ======
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body || {};
    console.log("Webhook received:", JSON.stringify(payload));

    // ❌ חסימת הודעות מקבוצות
    const chatId = payload?.senderData?.chatId;
    if (chatId && chatId.includes("@g.us")) {
      console.log("⛔ הודעה מקבוצה - מתעלם");
      return res.status(200).json({ ok: true });
    }

    // ====== זיהוי שולח ======
    let from_number =
      payload?.senderData?.sender ||
      payload?.senderData?.chatId ||
      null;

    if (from_number && from_number.includes("@")) {
      from_number = from_number.split("@")[0];
    }

    if (!from_number) {
      return res.status(400).json({ error: "No sender found" });
    }

    // ====== זיהוי טקסט ======
    const body =
      payload?.messageData?.textMessageData?.textMessage ||
      payload?.messageData?.extendedTextMessage?.text ||
      null;

    // ====== שמירה למסד ======
    const { error } = await supabase
      .from("messages")
      .insert([
        {
          from_number,
          body,
          media: null,
        },
      ]);

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "DB insert failed" });
    }

    // ====== תשובה אוטומטית ======
    if (GREEN_API_TOKEN && GREEN_INSTANCE_ID) {
      const url = `https://${GREEN_INSTANCE_ID}.api.greenapi.com/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

      await axios.post(url, {
        chatId: payload.senderData.chatId,
        message: "קיבלנו את הפנייה שלך 🙌 נציג יחזור אליך בהקדם.",
      });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
