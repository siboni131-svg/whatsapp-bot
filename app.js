const express = require("express");
const app = express();

app.use(express.json());

app.post("/webhook", (req, res) => {
  console.log("הודעה נכנסה:", req.body);

  res.json({
    reply: "קיבלתי את ההודעה שלך 👍"
  });
});

app.listen(3000, () => {
  console.log("השרת רץ על פורט 3000");
})
