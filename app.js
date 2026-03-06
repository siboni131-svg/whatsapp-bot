const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// חיבור ל-Supabase ול-AI של גוגל
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// פרטי Green API
const GREEN_API_URL = process.env.GREEN_API_URL;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_INSTANCE_ID = process.env.GREEN_INSTANCE_ID;

async function sendMsg(chatId, message) {
    const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;
    return axios.post(url, { chatId, message });
}

app.post("/webhook", async (req, res) => {
    try {
        const payload = req.body;
        if (payload?.typeWebhook !== "incomingMessageReceived") return res.sendStatus(200);

        const chatId = payload?.senderData?.chatId;
        const phone = payload?.senderData?.sender || chatId;
        const userMsg = payload?.messageData?.textMessageData?.textMessage || "";

        if (!userMsg) return res.sendStatus(200);

        // שליפת מידע על הלקוח
        let { data: customer } = await supabase.from("customers").select("*").eq("phone", phone).maybeSingle();
        if (!customer) {
            const { data: newC } = await supabase.from("customers").insert([{ phone, data_json: {} }]).select().single();
            customer = newC;
        }

        // הנחיות ל-AI (System Prompt)
        const prompt = `
        אתה עוזר אישי יוקרתי של "Eden Limousine".
        המטרה שלך: לאסוף פרטים להזמנה בשיחה זורמת.
        פרטים נדרשים: תאריך, סוג אירוע, מיקום איסוף חתן, מיקום איסוף כלה (רק אם מדובר באיסוף משולב), צילומים, אולם ושם לקוח.
        
        מידע שנאסף עד כה: ${JSON.stringify(customer.data_json)}
        הודעת הלקוח: "${userMsg}"
        
        דגש: אם הלקוח אמר "איסוף משולב", עליך לשאול על כתובת החתן ואז על כתובת הכלה בנפרד. אל תדלג.
        בסיום, הצג סיכום הכולל אלכוהול חופשי וצילום סושיאל (BTS).
        
        החזר תשובה בפורמט JSON בלבד:
        {"reply": "התשובה ללקוח", "new_data": {"שדה": "ערך"}}
        `;

        const result = await model.generateContent(prompt);
        const aiData = JSON.parse(result.response.text().replace(/```json|```/g, ""));

        // עדכון נתונים ושליחה
        const updatedJson = { ...customer.data_json, ...aiData.new_data };
        await supabase.from("customers").update({ data_json: updatedJson }).eq("phone", phone);
        await sendMsg(chatId, aiData.reply);

        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.sendStatus(200);
    }
});

app.listen(process.env.PORT || 3000);
