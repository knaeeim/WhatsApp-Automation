const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running smoothly!');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || 'আপনার_গুগল_শিটের_ওয়েব_অ্যাপ_ইউআরএল_এখানে_দিন';

const knownNumbers = ['8801712854941']; 

async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`;
            console.log('\n=========================================================');
            console.log('Baileys QR কোড স্ক্যান করতে নিচের লিংকে ক্লিক করুন:');
            console.log(qrUrl);
            console.log('=========================================================\n');
        }

        if (connection === 'open') {
            console.log('WhatsApp Bot is Ready and Connected via Baileys!');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                startSock();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const senderNumber = senderJid.split('@')[0];

        if (senderJid.endsWith('@g.us') || knownNumbers.includes(senderNumber)) {
            return;
        }

        const content = msg.message;
        const msg_body = content.conversation || 
                         content.extendedTextMessage?.text || 
                         content.imageMessage?.caption || 
                         content.videoMessage?.caption ||
                         content.ephemeralMessage?.message?.conversation ||
                         content.ephemeralMessage?.message?.extendedTextMessage?.text;

        if (!msg_body) {
            console.log("টেক্সট পাওয়া যায়নি বা এটি অন্য কোনো ফরম্যাটের মেসেজ।");
            return;
        }

        console.log("রিসিভড মেসেজ:", msg_body);

        try {
            const todayDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });

            const promptText = `System: You are a polite and expert assistant for Md Khairul Bashar's medical clinic. Analyze the user's message and respond ONLY in valid JSON format.
            Current Date: ${todayDate}
            
            Clinic Info:
            - Schedule: এই সপ্তাহে শুধুমাত্র শনিবার সকাল ৯টা থেকে সন্ধ্যা ৫টা পর্যন্ত অফলাইন চেম্বার। সোম থেকে বৃহস্পতিবার অনলাইন।
            - Fee: প্রথম ভিজিট ১০০০ টাকা, ফলোআপ ৬০০ টাকা।
            - Location: চেম্বারের ঠিকানা: ২/১, জাহেদা ভিলা, শ্যামলী কল্যাণ সমিতি, শ্যামলী, ঢাকা-১২০৭। 
            
            Rules:
            1. Unrelated message: {"action": "ignore"}
            2. FAQ / Schedule asking: {"action": "reply", "message": "ডা. দেবজ্যোতি দত্ত এই সপ্তাহে শুধুমাত্র শনিবার সকাল ৯টা থেকে সন্ধ্যা ৫টা পর্যন্ত চেম্বারে বসবেন। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)"}
            3. Online consultation: {"action": "reply", "message": "অনলাইনে দেখাতে চাইলে +8801953950500 এই নাম্বারে হোয়াটসঅ্যাপে জানান।"}
            4. Booking without name/phone: {"action": "reply", "message": "অ্যাপয়েন্টমেন্ট নিতে অনুগ্রহ করে রোগীর নাম এবং মোবাইল নাম্বারটি দিন। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)"}
            5. Booking with BOTH name and phone: {"action": "book", "name": "Patient Name", "phone": "Patient Phone"}

            User Message: ${msg_body}`;

            // 503 বা হাই ডিমান্ড আসলে ব্যাকআপ মডেল দিয়ে হ্যান্ডেল করার ফাংশন
            let response;
            try {
                response = await ai.models.generateContent({
                    model: 'gemini-3.6-flash',
                    contents: promptText
                });
            } catch (err) {
                console.warn('gemini-3.6-flash busy (503), switching to fallback model...');
                response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: promptText
                });
            }

            let rawText = response.text.trim();
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(rawText);

            let finalReply = "";

            if (aiData.action === 'ignore') {
                return;
            } else if (aiData.action === 'reply') {
                finalReply = aiData.message;
            } else if (aiData.action === 'book') {
                const sheetResponse = await axios.post(GOOGLE_SHEET_URL, {
                    name: aiData.name,
                    phone: aiData.phone
                });
                finalReply = sheetResponse.data.replyMessage;
            }

            if (finalReply) {
                await sock.sendMessage(senderJid, { text: finalReply });
            }

        } catch (error) {
            console.error('Final Error handler:', error.message);
            
            // কোনো কারণে সব মডেল ফেইল করলেও ইউজার যেন রেসপন্স পায়
            await sock.sendMessage(senderJid, { 
                text: "ডা. দেবজ্যোতি দত্তের চেম্বারে আপনাকে স্বাগতম। অ্যাপয়েন্টমেন্ট বা সিরিয়ালের জন্য অনুগ্রহ করে রোগীর নাম ও মোবাইল নাম্বারটি দিন। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)" 
            });
        }
    });
}

startSock();