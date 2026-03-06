const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// --- חיבור לשירותים (וודא שהמפתחות מוגדרים ב-Render) ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
        const phone = payload?.senderData?.sender || chatId;
        const userMsg = payload?.messageData?.textMessageData?.textMessage || "";

        if (!userMsg) return res.sendStatus(200);

        // 1. שליפת לקוח מ-Supabase בצורה בטוחה (תיקון שגיאת ה-null)
        let { data: customer, error: fetchError } = await supabase
            .from("customers")
            .select("*")
            .eq("phone", phone)
            .maybeSingle();

        // 2. אם הלקוח לא קיים, ניצור שורה חדשה בטבלה
        if (!customer) {
            console.log("New customer detected, creating record...");
            const { data: newC, error: insertError } = await supabase
                .from("customers")
                .insert([{ phone, data_json: {} }])
                .select()
                .single();
            
            if (insertError) {
                console.error("Supabase Insert Error:", insertError);
                return res.sendStatus(200);
            }
            customer = newC;
        }

        const existingData = customer.data_json || {};

        // 3. הגדרת הפרומפט ל-AI (הנחיות לניהול השיחה)
        const prompt = `
        אתה עוזר אישי יוקרתי ומכירתי של חברת "Eden Limousine".
        המטרה שלך: לאסוף פרטים להזמנה בשיחה זורמת ונעימה.
        
        פרטים שצריך לאסוף: תאריך, סוג אירוע, מיקום איסוף חתן, מיקום איסוף כלה (רק אם הלקוח ביקש איסוף משולב), מיקום צילומים, שם אולם ושם לקוח.
        
        מידע שנאסף כבר: ${JSON.stringify(existingData)}
        הודעת הלקוח כרגע: "${userMsg}"
        
        דגשים חשובים:
        - אם הלקוח ציין "איסוף משולב", עליך לשאול מאיפה אוספים את החתן, ולאחר מכן לשאול מאיפה אוספים את הכלה. אל תדלג על אף אחד מהם.
        - כשהשיחה מסתיימת וכל הפרטים קיימים, הצג את סיכום ההזמנה והדגש שיש אלכוהול חופשי (וודקה, וויסקי, שמפניה קרה) וצילום סושיאל (BTS) לסטורי מושלם.
        
        ענה תמיד בפורמט JSON נקי בלבד:
        {
          "reply": "התשובה שתישלח ללקוח בווטסאפ",
          "new_data": {"שם_שדה": "ערך_שחולץ"}
        }
        `;

        // 4. קריאה ל-Gemini AI
        const result = await model.generateContent(prompt);
        const rawText = result.response.text().replace(/```json|```/g, "").trim();
        const aiData = JSON.parse(rawText);

        // 5. עדכון הנתונים חזרה ל-Supabase
        const updatedJson = { ...existingData, ...aiData.new_data };
        await supabase.from("customers").update({ data_json: updatedJson }).eq("phone", phone);

        // 6. שליחת התשובה ללקוח בווטסאפ
        await sendMsg(chatId, aiData.reply);

        res.sendStatus(200);
    } catch (err) {
        console.error("Critical Error in Webhook:", err);
        res.sendStatus(200); // מחזירים 200 כדי למנוע לופים של שגיאות מ-GreenAPI
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VIP Bot is running on port ${PORT} 🚀`));
