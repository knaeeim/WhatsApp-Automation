const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// এখানে আপনার গুগল শিটের Web App URL দিন
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || 'আপনার_কপি_করা_GOOGLE_APP_SCRIPT_WEB_APP_URL_এখানে_দিন';

// পরিচিত নাম্বার (কান্ট্রি কোড সহ এবং শেষে @c.us দিতে হবে)
const knownNumbers = ['8801712854941@c.us', '8801900000000@c.us'];

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // রেন্ডারের ফ্রি সার্ভারের জন্য এটি অত্যন্ত জরুরি
            '--disable-gpu'
        ]
    }
});

// ১. টার্মিনালে QR কোড জেনারেট করা
// ১. QR কোড লিংকে রূপান্তর করা
client.on('qr', (qr) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`;
    console.log('\n\n=========================================================');
    console.log('QR কোড স্ক্যান করতে নিচের লিংকে ক্লিক করুন (অথবা কপি করে ব্রাউজারে ওপেন করুন):');
    console.log(qrUrl);
    console.log('=========================================================\n\n');
});

client.on('ready', () => {
    console.log('WhatsApp Bot is Ready and Connected!');
});

// ২. মেসেজ রিসিভ এবং প্রসেস করা
client.on('message', async msg => {
    // স্ট্যাটাস আপডেট বা আপনি নিজে ম্যানুয়ালি রিপ্লাই দিলে বট ইগনোর করবে
    if (msg.from === 'status@broadcast' || msg.fromMe) return;

    // পরিচিত নাম্বার হলে ইগনোর করবে
    if (knownNumbers.includes(msg.from)) {
        console.log('Ignored message from known number:', msg.from);
        return;
    }

    const msg_body = msg.body;
    const from = msg.from;

    try {
        // জেমিনাইকে ইনটেন্ট বোঝার জন্য স্পেশাল প্রম্পট
        // জেমিনাইকে ইনটেন্ট বোঝার জন্য স্পেশাল প্রম্পট এবং আপনার ক্লিনিকের কনটেক্সট
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
            3. Online Consultation: If they want to consult online (অনলাইনে দেখানো), return EXACTLY: {"action": "reply", "message": "অনলাইনে দেখাতে চাইলে +8801953950500 এই নাম্বারের হোয়াটসঅ্যাপে ম্যাসেজ করে জানান।"}
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
            // গুগল শিটে ডেটা পাঠানো
            const sheetResponse = await axios.post(GOOGLE_SHEET_URL, {
                name: aiData.name,
                phone: aiData.phone
            });
            finalReply = sheetResponse.data.replyMessage;
        }

        // ৩. হোয়াটসঅ্যাপে মেসেজ পাঠানো
        if (finalReply) {
            await client.sendMessage(from, finalReply);
        }

    } catch (error) {
        console.error('Error processing message:', error);
    }
});

client.initialize();