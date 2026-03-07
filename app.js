const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// חיבור לשירותים (וודא שהם מוגדרים ב-Environment Variables ב-Render)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const GREEN_API_URL = process.env.GREEN_API_URL;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

async function sendMsg(chatId, message) {
    const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
    try {
        return await axios.post(url, { chatId, message });
    } catch (err) {
        console.error("GreenAPI Error:", err.message);
    }
}

app.post("/webhook", async (req, res) => {
    try {
        const payload = req.body;
        if (payload?.typeWebhook !== "incomingMessageReceived") return res.sendStatus(200);

        const chatId = payload?.senderData?.chatId;
        const phone = payload?.senderData?.sender || chatId;
        const userMsg = payload?.messageData?.textMessageData?.textMessage || "";

        if (!userMsg) return res.sendStatus(200);

        // 1. טיפול בלקוח ב-Supabase (תיקון שגיאת PGRST204)
        let { data: customer } = await supabase.from("customers").select("*").eq("phone", phone).maybeSingle();
        
        if (!customer) {
            console.log("Creating new customer record...");
            const { data: newC, error: insErr } = await supabase.from("customers").insert([{ phone, data_json: {} }]).select().single();
            if (insErr) throw insErr;
            customer = newC;
        }

        const existingData = customer.data_json || {};

        // 2. הפרומפט המדויק: יוקרתי, קצר ולא חופר
        const prompt = `
        אתה העוזר של "Eden Limousine". תהיה יוקרתי, תכליתי ואל תחפור.
        המטרה: לאסוף פרטי הזמנה (תאריך, אירוע, איסוף חתן, איסוף כלה אם משולב, צילומים, אולם, שם).
        
        הנחיות אישיות:
        - בתחילת שיחה שאל רק: "שלום, במה אוכל לעזור לך היום?"
        - אל תיתן נאומים. שאל שאלה אחת בכל פעם.
        - אם ביקשו "איסוף משולב", שאל בנפרד על חתן ואז על כלה.
        - בסיום הכל, תן סיכום קצר וציין שיש אלכוהול חופשי וצילום BTS.
        
        מידע קיים: ${JSON.stringify(existingData)}
        הודעה מהלקוח: "${userMsg}"
        
        החזר JSON בלבד: {"reply": "טקסט קצר", "new_data": {}}
        `;

        const result = await model.generateContent(prompt);
        const rawText = result.response.text().replace(/```json|```/g, "").trim();
        const aiData = JSON.parse(rawText);

        // 3. עדכון בטוח
        const updatedJson = { ...existingData, ...aiData.new_data };
        await supabase.from("customers").update({ data_json: updatedJson }).eq("phone", phone);

        await sendMsg(chatId, aiData.reply);
        res.sendStatus(200);

    } catch (err) {
        console.error("Critical Error:", err);
        res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`בוט ה-VIP פועל על פורט ${PORT} 🚀`));
