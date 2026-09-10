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
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || 'আপনার_গুগল_শিটের_ওয়েব_অ্যাপ_ইউআরএল_এখানে_দিন';

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

        // মেসেজ থেকে টেক্সট বের করা
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

        // ==========================================
        // ১. সরাসরি কোড থেকে রুল-বেসড ফিল্টারিং (জেমিনাই কল হবে না, ফ্রি কোটা বাঁচবে)
        // ==========================================
        const textLower = msg_body.toLowerCase().trim();

        if (['hello', 'hi', 'হাই', 'হ্যালো', 'সালাম', 'assalamu alaikum', 'আসসালামু আলাইকুম'].some(w => textLower === w)) {
            await sock.sendMessage(senderJid, { 
                text: "ওয়ালাইকুম আসসালাম। ডা. দেবজ্যোতি দত্তের চেম্বারে আপনাকে স্বাগতম। সিরিয়াল নিতে চাইলে রোগীর নাম ও মোবাইল নাম্বার লিখে মেসেজ দিন। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)" 
            });
            return;
        }

        if (textLower.includes('ফি') || textLower.includes('fee') || textLower.includes('টাকা') || textLower.includes('খরচ') || textLower.includes('cost') || textLower.includes('price') || textLower.includes('fees')) {
            await sock.sendMessage(senderJid, { 
                text: "ডা. দেবজ্যোতি দত্তের প্রথম ভিজিট ফি ১০০০ টাকা এবং ফলোআপ ৬০০ টাকা। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)" 
            });
            return;
        }

        if (textLower.includes('কোথায়') || textLower.includes('ঠিকানা') || textLower.includes('location') || textLower.includes('চেম্বার') || textLower.includes('address')) {
            await sock.sendMessage(senderJid, { 
                text: "চেম্বারের ঠিকানা: ২/১, জাহেদা ভিলা, শ্যামলী কল্যাণ সমিতি, শ্যামলী, ঢাকা-১২০৭।\nগুগল ম্যাপ লিঙ্ক: https://maps.app.goo.gl/NgPzAZamW3Ucy8799" 
            });
            return;
        }

        if (textLower.includes('অনলাইন') || textLower.includes('online')) {
            await sock.sendMessage(senderJid, { 
                text: "অনলাইনে দেখাতে চাইলে +8801953950500 এই নাম্বারে হোয়াটসঅ্যাপে মেসেজ করে জানান।" 
            });
            return;
        }

        // ==========================================
        // ২. সিরিয়াল ও জটিল মেসেজের জন্য জেমিনাই এআই কল
        // ==========================================
        try {
            const now = new Date();
            const todayStr = now.toLocaleDateString('bn-BD', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                timeZone: 'Asia/Dhaka' 
            });

            /*
              👉 প্রতি সপ্তাহে শুধু নিচের এই কনফিগারেশন পরিবর্তন করবেন:
            */
            const currentWeekConfig = {
                fridayAvailable: false,   // শুক্রবারে বসবেন কি না (true / false)
                saturdayAvailable: true,  // শনিবারে বসবেন কি না (true / false)
                fridayDate: "11/09/2026",
                saturdayDate: "12/09/2026"
            };

            const promptText = `System: You are an intelligent medical assistant for Dr. Debajyoti Datta.
Today is: ${todayStr}.

Schedule for this week:
- Friday (${currentWeekConfig.fridayDate}): ${currentWeekConfig.fridayAvailable ? "Available (সকাল ৯টা - সন্ধ্যা ৫টা)" : "OFF (বসবেন না)"}
- Saturday (${currentWeekConfig.saturdayDate}): ${currentWeekConfig.saturdayAvailable ? "Available (সকাল ৯টা - সন্ধ্যা ৫টা)" : "OFF (বসবেন না)"}
- Online consultation: Mon-Thu (Contact: +8801953950500)
- Fees: 1st visit 1000 TK, Follow-up 600 TK. Location: শ্যামলী ২/১ জাহেদা ভিলা।

Rules for JSON Response:
1. If patient asks for Friday, but Friday is OFF:
   Return: {"action": "reply", "message": "ডা. দেবজ্যোতি দত্ত এই সপ্তাহে শুক্রবারে চেম্বারে বসছেন না, তিনি শুধুমাত্র শনিবার (${currentWeekConfig.saturdayDate}) বসবেন। আপনি কি শনিবারে দেখাতে চান? জানালে সিরিয়াল বুক করে দিচ্ছি।"}

2. If patient asks for Saturday, but Saturday is OFF:
   Return: {"action": "reply", "message": "ডা. দেবজ্যোতি দত্ত এই সপ্তাহে শনিবারে বসছেন না, তিনি শুধুমাত্র শুক্রবার (${currentWeekConfig.fridayDate}) বসবেন। আপনি কি শুক্রবারে দেখাতে চান?"}

3. If patient wants to book, but hasn't provided Name & Phone:
   Return: {"action": "reply", "message": "অ্যাপয়েন্টমেন্টের জন্য অনুগ্রহ করে রোগীর নাম এবং মোবাইল নাম্বারটি দিন। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)"}

4. If patient provides Name, Phone, and the requested day is VALID and CONFIRMED:
   Determine the targetDate (${currentWeekConfig.saturdayAvailable && !currentWeekConfig.fridayAvailable ? currentWeekConfig.saturdayDate : currentWeekConfig.fridayDate})
   Return: {"action": "book", "name": "Patient Name", "phone": "Patient Phone", "date": "Target Date"}

5. FAQ (Fee/Location/Timing):
   Return: {"action": "reply", "message": "Helpful response in Bengali."}

User message: ${msg_body}`;

            let response;
            try {
                response = await ai.models.generateContent({
                    model: 'gemini-3.6-flash',
                    contents: promptText
                });
            } catch (err) {
                console.warn('Retrying Gemini API once...', err.message);
                await new Promise(res => setTimeout(res, 1000));
                response = await ai.models.generateContent({
                    model: 'gemini-3.6-flash',
                    contents: promptText
                });
            }

            let rawText = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(rawText);

            let finalReply = "";

            if (aiData.action === 'ignore') {
                return;
            } else if (aiData.action === 'reply') {
                finalReply = aiData.message;
            } else if (aiData.action === 'book') {
                const sheetResponse = await axios.post(GOOGLE_SHEET_URL, {
                    name: aiData.name,
                    phone: aiData.phone,
                    date: aiData.date
                });
                finalReply = sheetResponse.data.replyMessage;
            }

            if (finalReply) {
                await sock.sendMessage(senderJid, { text: finalReply });
            }

        } catch (error) {
            console.error('Error processing message:', error.message);
            
            // স্মার্ট ফলব্যাক
            const textLower = msg_body.toLowerCase();
            let fallbackReply = "ডা. দেবজ্যোতি দত্তের চেম্বারে আপনাকে স্বাগতম। বিস্তারিত জানতে বা অ্যাপয়েন্টমেন্ট নিতে রোগীর নাম ও মোবাইল নাম্বার দিয়ে মেসেজ করুন।";
            if (textLower.includes('ফি') || textLower.includes('fee') || textLower.includes('টাকা')) {
                fallbackReply = "ডা. দেবজ্যোতি দত্তের প্রথম ভিজিট ফি ১০০০ টাকা এবং ফলোআপ ৬০০ টাকা। (বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।)";
            } else if (textLower.includes('কোথায়') || textLower.includes('ঠিকানা')) {
                fallbackReply = "চেম্বারের ঠিকানা: ২/১, জাহেদা ভিলা, শ্যামলী কল্যাণ সমিতি, শ্যামলী, ঢাকা-১২০৭।";
            }
            await sock.sendMessage(senderJid, { text: fallbackReply });
        }
    });
}

startSock();