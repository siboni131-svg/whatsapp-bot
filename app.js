const express = require("express");
const app = express();

app.use(express.json());

// בדיקה שהשרת עובד
app.get("/", (req, res) => {
  res.send("השרת עובד בהצלחה 🚀");
});

// Webhook
app.post("/webhook", (req, res) => {
  console.log("הודעה נכנסה:", req.body);

  res.json({
    reply: "קיבלתי את ההודעה שלך 👍"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("השרת רץ על פורט " + PORT);
});