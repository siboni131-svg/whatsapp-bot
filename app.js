const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// חיבור לשירותים דרך משתני הסביבה ב-Render
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// הגדרת המודל בגרסה יציבה למניעת שגיאות 404
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const GREEN_API_URL = process.env.GREEN_API_URL;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

// פונקציה לשליחת הודעה לווטסאפ
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
        // ניקוי מספר הטלפון כדי להתאים לטבלה ב-Supabase
        const phone = payload?.senderData?.sender.replace('@c.us', '') || ""; 
        const userMsg = payload?.messageData?.textMessageData?.textMessage || "";

        if (!userMsg) return res.sendStatus(200);

        // 1. חיפוש לקוח קיים ב-Supabase כדי לדעת מה כבר שאלנו
        let { data: customer } = await supabase.from("customers").select("*").eq("phone", phone).maybeSingle();
        
        // אם הלקוח לא קיים, יוצרים שורה חדשה בטבלה
        if (!customer) {
            const { data: newC, error: insErr } = await supabase.from("customers").insert([{ phone: phone, step: 'start' }]).select().single();
            if (insErr) throw insErr;
            customer = newC;
        }

        // 2. הפרומפט ל-AI: שימוש במידע מהטבלה כדי למנוע "חפירות"
        const prompt = `
        אתה העוזר של "Eden Limousine". תהיה יוקרתי, תכליתי ואל תחפור.
        המטרה: לאסוף פרטי הזמנה (תאריך, אירוע, איסוף, יעד, שם).
        
        מידע קיים בטבלה: ${JSON.stringify(customer)}
        הודעת לקוח: "${userMsg}"
        
        הנחיות:
        - שאל שאלה אחת קצרה בכל פעם.
        - אם המידע כבר קיים בטבלה (ב-JSON לעיל), אל תשאל עליו שוב!
        - בסיום, ציין שיש אלכוהול חופשי וצילום BTS לסטורי.

        החזר JSON בלבד:
        {
          "reply": "תשובה קצרה ללקוח",
          "updates": {
            "event_date": "ערך או null",
            "event_type": "ערך או null",
            "pickup_locatio": "ערך או null",
            "customer_name": "ערך או null",
            "step": "שם השלב הבא"
          }
        }
        `;

        const result = await model.generateContent(prompt);
        const aiData = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());

        // 3. עדכון העמודות הספציפיות בטבלה שלך ב-Supabase
        await supabase.from("customers").update({
            event_date: aiData.updates.event_date || customer.event_date,
            event_type: aiData.updates.event_type || customer.event_type,
            pickup_locatio: aiData.updates.pickup_locatio || customer.pickup_locatio,
            customer_name: aiData.updates.customer_name || customer.customer_name,
            step: aiData.updates.step || customer.step
        }).eq("phone", phone);

        await sendMsg(chatId, aiData.reply);
        res.sendStatus(200);

    } catch (err) {
        console.error("Critical Error:", err);
        res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`בוט ה-VIP פועל על פורט ${PORT} 🚀`));
