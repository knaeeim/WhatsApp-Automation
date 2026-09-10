const express = require('express');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// মেটা Webhook ভেরিফিকেশন রাউট (Meta API-এর রিকোয়ারমেন্ট)
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// ইনকামিং মেসেজ রিসিভ এবং জেমিনাই এর উত্তর পাঠানো
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0]?.changes?.[0]?.value;
        if (entry?.messages) {
            const phone_number_id = entry.metadata.phone_number_id;
            const from = entry.messages[0].from;
            const msg_body = entry.messages[0].text.body;

            try {
                // জেমিনাই থেকে রেসপন্স জেনারেট
                const response = await ai.models.generateContent({
                    model: 'gemini-3.6-flash',
                    contents: `System: You are an assistant for a medical clinic. Give short, polite answers. User: ${msg_body}`
                });
                const aiReply = response.text;

                // হোয়াটসঅ্যাপে মেসেজ পাঠানো
                await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v19.0/${phone_number_id}/messages`,
                    headers: { 
                        Authorization: `Bearer ${process.env.META_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        messaging_product: 'whatsapp',
                        to: from,
                        text: { body: aiReply }
                    }
                });
            } catch (error) {
                console.error('Error:', error);
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));