const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// חיבור לסופאבייס (מגיע ממשתני סביבה ב-Render)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// בדיקת שרת עובד
app.get("/", (req, res) => {
  res.send("השרת עובד בהצלחה ✅");
});

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("הודעה נכנסה:", req.body);

  try {
    // לדוגמה: שמירה לטבלה בשם messages
    const from_number = req.body.senderData?.sender || null;
    const text = req.body.messageData?.textMessageData?.textMessage || null;

    const { error } = await supabase.from("messages").insert([
      {
        from_number,
        text,
        raw: req.body, // חשוב: בעמודה raw צריך להיות JSONB בסופאבייס
      },
    ]);

    if (error) console.log("Supabase insert error:", error);

    return res.json({ reply: "קיבלתי את ההודעה שלך 👍" });
  } catch (e) {
    console.log("Webhook error:", e);
    return res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("השרת רץ על פורט " + PORT);
});
