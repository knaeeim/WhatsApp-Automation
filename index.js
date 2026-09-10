const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const pino = require('pino');
const express = require('express'); // এক্সপ্রেস যোগ করা হলো
const axios = require('axios');
require('dotenv').config();

// রেন্ডারকে সন্তুষ্ট করার জন্য একটি ডামি ওয়েব সার্ভার
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

        const msg_body = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!msg_body) return;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: `System: You are a polite and expert assistant for Md Khairul Bashar's medical clinic. Analyze the user's message and respond ONLY in valid JSON format.
                
                Clinic Information:
                - Available Doctors & Schedule: 
                  1. ডা. দেবজ্যোতি দত্ত (শনি - সকাল ৯টা থেকে সন্ধ্যা ৫ টা)
                  2. এইটা ওনার পারসোনাল চেম্বার।
                - Consultation Fee: ১০০০ টাকা (প্রথম ভিজিট)। ফলোআপ ৬০০ টাকা।
                - Location: চেম্বারের ঠিকানা: ২/১, জাহেদা ভিলা, শ্যামলী কল্যাণ সমিতি, শ্যামলী, ঢাকা-১২০৭। 
                  গুগল ম্যাপ লিঙ্ক: https://maps.app.goo.gl/NgPzAZamW3Ucy8799
                - Services: বিভিন্ন রোগের চিকিৎসা, ডায়াবেটিস, গ্যাস্ট্রিক এবং রুটিন চেকআপ, সা‍র্জারির কোন বিষয় দেখা হয় না।
                
                Rules for JSON Output:
                1. Unrelated Message: If the message is completely unrelated to medical, doctors, appointments, or healthcare, return EXACTLY: {"action": "ignore"}
                2. General Info/FAQ: If they ask about fees, time, location, or available services, return EXACTLY: {"action": "reply", "message": "Your helpful response in Bengali. Always add this reminder at the end: 'বি.দ্র: আসার আগে অবশ্যই সিরিয়াল কনফার্ম করে আসবেন।'"}
                3. Online Consultation: If they want to consult online (অনলাইনে দেখানো), return EXACTLY: {"action": "reply", "message": "অনলাইনে দেখাতে চাইলে +8801953950500 এই নাম্বارهای হোয়াটসঅ্যাপে ম্যাসেজ করে জানান।"}
                4. Incomplete Booking: If they want to book an appointment but have not provided BOTH their Name and Phone Number, return EXACTLY: {"action": "reply", "message": "অ্যাপয়েন্টমেন্ট নিতে অনুগ্রহ করে রোগীর নাম এবং মোবাইল নাম্বারটি দিন।"}
                5. Complete Booking: If they want to book an appointment and HAVE PROVIDED both their Name and Phone Number, return EXACTLY: {"action": "book", "name": "Patient Name", "phone": "Patient Phone"}
                
                User: ${msg_body}`
            });

            const aiData = JSON.parse(response.text.replace(/```json/g, '').replace(/```/g, '').trim());
            let finalReply = "";

            if (aiData.action === 'ignore') {
                return;
            } 
            else if (aiData.action === 'reply') {
                finalReply = aiData.message;
            } 
            else if (aiData.action === 'book') {
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
            console.error('Error processing message:', error);
        }
    });
}

startSock();