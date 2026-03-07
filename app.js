const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// חיבור לשירותים
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
        // ניקוי מספר הטלפון כדי שיתאים לפורמט ב-Supabase
        const phone = payload?.senderData?.sender.replace('@c.us', '') || ""; 
        const userMsg = payload?.messageData?.textMessageData?.textMessage || "";

        if (!userMsg) return res.sendStatus(200);

        // 1. חיפוש או יצירת לקוח בטבלה customers לפי השדות שלך
        let { data: customer } = await supabase.from("customers").select("*").eq("phone", phone).maybeSingle();
        
        if (!customer) {
            console.log("יצירת רשומה חדשה ללקוח...");
            const { data: newC, error: insErr } = await supabase.from("customers").insert([{ phone: phone, step: 'start' }]).select().single();
            if (insErr) throw insErr;
            customer = newC;
        }

        // 2. פרומפט ממוקד לשדות שלך: event_date, event_type, pickup_locatio, וכו'
        const prompt = `
        אתה העוזר האישי של "Eden Limousine". תהיה קצר, יוקרתי ואל תחפור.
        המטרה שלך היא לאסוף פרטים להזמנה בצורה עניינית.
        
        מידע קיים בטבלה: ${JSON.stringify(customer)}
        הודעת לקוח: "${userMsg}"
        
        הנחיות:
        - חלץ מידע לשדות הבאים בלבד: event_date, event_type, pickup_locatio, destination, customer_name.
        - אם חסר מידע, שאל שאלה אחת קצרה (למשל: "מה תאריך האירוע?").
        - אם מדובר ב"איסוף משולב", שאל בנפרד על מיקום החתן ומיקום הכלה.
        - בסיום, ציין שיש אלכוהול חופשי וצילום BTS לסטורי.

        החזר JSON בלבד:
        {
          "reply": "תשובה קצרה ללקוח",
          "updates": {
            "event_date": "ערך שחולץ או null",
            "event_type": "ערך שחולץ או null",
            "pickup_locatio": "ערך שחולץ או null",
            "step": "שם השלב הנוכחי"
          }
        }
        `;

        const result = await model.generateContent(prompt);
        const aiData = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());

        // 3. עדכון הטבלה לפי השדות הספציפיים שקיימים אצלך
        await supabase.from("customers").update(aiData.updates).eq("phone", phone);

        await sendMsg(chatId, aiData.reply);
        res.sendStatus(200);

    } catch (err) {
        console.error("שגיאה קריטית:", err);
        res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`בוט ה-VIP פועל על פורט ${PORT} 🚀`));
