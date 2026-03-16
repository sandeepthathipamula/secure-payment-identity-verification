require("dotenv").config();
const express = require("express");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require("bcrypt");
const QRCode = require("qrcode");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const faceLinks = new Map();
const app = express();
const { User, Payment } = require("./user/User");

const PORT = 1300;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


// serve static files
app.use(express.static(__dirname));
mongoose.connect("mongodb://127.0.0.1:27017/phonepe")
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "Account.html"));
});

// TEMP storage (use DB in real apps)
const otpStore = {};

// Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000);
}

app.post("/send-phone", async (req, res) => {
    try {
        const { phone } = req.body;

        // ✅ 1. Validate phone FIRST
        if (!phone || !/^91\d{10}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Phone must be in format 91XXXXXXXXXX"
            });
        }

        // ✅ 2. Check user exists
        const user = await User.findOne({ phone });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Account does not exist"
            });
        }
        // 3️⃣ If UPI PIN exists → STOP here
        // 🔐 PIN exists if flag is true OR bcrypt hash exists
        const upiPinExists = user.upiPinSet || !!user.upiPin;

        if (upiPinExists) {
            return res.json({
                success: true,
                upiPinExists: true
            });
        }
        console.log("Received phone:", phone);

        // ✅ 3. Generate & store OTP
        const otp = generateOTP();

        otpStore[phone] = {
            otp,
            expiresAt: Date.now() + 60 * 1000
        };

        // ✅ 4. Send WhatsApp OTP
        const response = await axios.post(
            `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: phone,
                type: "text",
                text: {
                    body: `Your PhonePe OTP is ${otp}. Valid for 1 minute. Do not share it with anyone.`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("WhatsApp response:", response.data);

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (error) {
        console.error("WhatsApp Error:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
});

app.post('/verify-otp', (req, res) => {
    const { phone, otp } = req.body;

    // 1. Check OTP exists
    if (!otpStore[phone]) {
        return res.status(400).json({ message: "OTP not found" });
    }

    // 2. Check expiry
    if (otpStore[phone].expiresAt < Date.now()) {
        delete otpStore[phone];
        return res.status(400).json({ message: "OTP expired" });
    }

    // 3. Match OTP (string-safe)
    if (String(otpStore[phone].otp) !== String(otp)) {
        return res.status(400).json({ message: "Invalid OTP" });
    }

    // 4. Success
    delete otpStore[phone];
    res.json({ success: true, message: "OTP verified successfully" });
});


app.post('/Verify', async (req, res) => {
    const { phone, bank } = req.body;
    if (!phone || !bank) {
        return res.status(400).json({ message: "phone & bank required" });

    }
    try {
        const user = await User.findOne({ phone, bank });
        if (user) {
            return res.json({ exists: true });
        }
        else {
            return res.json({ exists: false });
        }
    } catch (err) {
        res.json({ message: "server error" });
    }
});

app.post("/set-upi-pin", async (req, res) => {
    try {
        const { phone, upiPin } = req.body;

        if (!phone || !upiPin) {
            return res.status(400).json({ message: "Missing data" });
        }

        // ✅ Use MODEL name (User), not variable name
        const user = await User.findOne({ phone }); // 🔴 findOne (capital O)

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const hash = await bcrypt.hash(upiPin, 10);
        user.upiPin = hash;
        await user.save();

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});
const DUMMY_CARD = {
    cardNumber: "987654321000",
    expiry: "12/28"
};

app.post("/verify-card", (req, res) => {
    const { cardNumber, expiry } = req.body;

    if (!cardNumber || !expiry) {
        return res.status(400).json({ message: "Missing card data" });
    }

    // normalize values
    const cleanCard = cardNumber.replace(/\s/g, "");
    const cleanExpiry = expiry.replace(/\s/g, "");

    if (cleanCard.length < 6) {
        return res.status(400).json({ message: "Invalid card number" });
    }

    const inputLast6 = cleanCard.slice(-6);
    const dummyLast6 = DUMMY_CARD.cardNumber.slice(-6);

    if (
        inputLast6 === dummyLast6 &&
        cleanExpiry === DUMMY_CARD.expiry
    ) {
        return res.json({ success: true, message: "Card verified ✅" });
    }

    return res.json({ success: false, message: "Invalid card ❌" });
});
app.post('/get-users', async (req, res) => {
    const { phone } = req.body;

    const users = await User.find(
        { phone: { $ne: phone } },
        { name: 1, phone: 1, _id: 0 }
    );

    res.json({
        success: true,
        users
    });
});

app.put("/payment-limit", async (req, res) => {
    try {
        const { phone, limitOn, limitAmount } = req.body;

        const updatedUser = await User.findOneAndUpdate(
            { phone }, // 🔍 FIND by phone
            {
                $set: {
                    "paymentLimit.enabled": limitOn,
                    "paymentLimit.amount": limitOn ? limitAmount : 0
                }
            },
            { new: true } // return updated document
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({
            success: true,
            message: "Payment limit updated",
            user: updatedUser
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get("/payment-limit/:phone", async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone });

    if (!user) {
        return res.json({ success: false });
    }

    res.json({
        success: true,
        paymentLimit: user.paymentLimit
    });
});

app.post('/generate-qr', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.json({
                success: false,
                message: "Phone number required"
            });
        }
        const user = await User.findOne({ phone });
        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }
        const qrPayload = {
            name: user.name,
            phone: user.phone,
            bank: user.bank
        }
        const qrString = JSON.stringify(qrPayload);
        const qr = await QRCode.toDataURL(qrString);
        res.json({
            success: true,
            qr
        })
    } catch (err) {
        console.error("QR error:", err);
        res.status(500).json({
            success: false,
            message: "QR generation failed"
        });
    }
});

app.get("/bank/:phone", async (req, res) => {
    try {
        const { phone } = req.params;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number required"
            });
        }

        const user = await User.findOne(
            { phone },
            { name: 1, phone: 1, bank: 1, balance: 1 }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.json({
            success: true,
            bank: user.bank,
            user
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post("/check-balance", async (req, res) => {
    try {
        const { phone, enteredPin } = req.body;

        if (!phone || !enteredPin) {
            return res.json({
                success: false,
                message: "Phone and UPI PIN required"
            });
        }

        const user = await User.findOne({ phone });

        if (!user || !user.upiPin) {
            return res.json({
                success: false,
                message: "UPI PIN not set"
            });
        }

        // 🔐 compare hashed PIN
        const isCorrect = await bcrypt.compare(enteredPin, user.upiPin);

        if (!isCorrect) {
            return res.json({
                success: false,
                message: "Incorrect UPI PIN"
            });
        }

        // ✅ PIN correct → send balance
        res.json({
            success: true,
            balance: user.balance
        });

    } catch (err) {
        console.error("Check balance error:", err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});
app.post("/pay", async (req, res) => {
    try {
        const { senderPhone, amount } = req.body;

        const user = await User.findOne({ phone: senderPhone });
        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        const amt = Number(amount);

        // 🔓 limit OFF → allow payment
        if (!user.paymentLimit?.enabled) {
            return res.json({
                success: true,
                allowPayment: true,
                requireFace: false
            });
        }

        // 🔓 limit ON but amount within limit
        if (amt <= user.paymentLimit.amount) {
            return res.json({
                success: true,
                allowPayment: true,
                requireFace: false
            });
        }

        // 🔐 limit crossed
        return res.json({
            success: true,
            allowPayment: false,
            requireFace: true
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false });
    }
});

const TEMP_DIR = path.join(__dirname, "temp");

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/* ===============================
   VERIFY FACE API
================================ */
app.post("/verify-face", async (req, res) => {
    let tempFile = null;

    try {
        const { phone, descriptor, image } = req.body;

        const user = await User.findOne({ phone });
        if (!user || !user.faceDescriptor) {
            return res.json({ verified: false });
        }

        // 🔹 Face comparison
        let sum = 0;
        for (let i = 0; i < user.faceDescriptor.length; i++) {
            sum += (user.faceDescriptor[i] - descriptor[i]) ** 2;
        }
        const distance = Math.sqrt(sum);

        if (distance < 0.5) {
            return res.json({ verified: true });
        }

        // 🚨 FACE MISMATCH → CREATE IMAGE

        // base64 → buffer
        const base64 = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");

        // ✅ SAVE TEMP FILE FIRST
        tempFile = path.join(TEMP_DIR, `face_${phone}_${Date.now()}.jpg`);
        fs.writeFileSync(tempFile, buffer);

        // 🔐 generate token
        const token = crypto.randomBytes(16).toString("hex");

        // ✅ store correct filePath
        faceLinks.set(token, {
            filePath: tempFile,
            expiresAt: Date.now() + 60 * 1000, // 1 minute
            viewed: false
        });

        const faceLink = `http://localhost:1300/face/${token}`;
        console.log('Facelink', faceLink);


        // 📩 send WhatsApp TEXT link
        await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: phone,
                type: "text",
                text: {
                    body:
                        `🚨 Face mismatch detected during payment.

🔒 View image (valid for 1 minute):
${faceLink}

⚠️ Link works only once`

                }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ WhatsApp link sent");
        return res.json({ verified: false });

    } catch (err) {
        console.error("❌ Face verify error:", err.message);
        return res.json({ verified: false });
    }
});
app.get("/face/:token", (req, res) => {
    const data = faceLinks.get(req.params.token);

    if (!data) return res.status(410).send("Link expired or invalid");

    if (Date.now() > data.expiresAt) {
        if (fs.existsSync(data.filePath)) fs.unlinkSync(data.filePath);
        faceLinks.delete(req.params.token);
        return res.status(410).send("Link expired");
    }

    if (data.viewed) {
        return res.status(403).send("Link already used");
    }

    data.viewed = true;

    res.sendFile(data.filePath, () => {
        if (fs.existsSync(data.filePath)) fs.unlinkSync(data.filePath);
        faceLinks.delete(req.params.token);
        console.log("🗑️ Face image deleted after view");
    });
});


/* =========================
   API: DIRECT PAYMENT
========================= */
app.post("/direct-payment", async (req, res) => {
    try {
        const { senderPhone, receiverPhone, amount } = req.body;

        const amt = Number(amount);
        if (!amt || amt <= 0) {
            return res.json({ success: false, message: "Invalid amount" });
        }

        const sender = await User.findOne({ phone: senderPhone });
        const receiver = await User.findOne({ phone: receiverPhone });

        if (!sender || !receiver) {
            return res.json({ success: false, message: "User not found" });
        }

        if (sender.balance < amt) {
            return res.json({ success: false, message: "Insufficient balance" });
        }

        // 💰 Update balances
        sender.balance -= amt;
        receiver.balance += amt;

        await sender.save();
        await receiver.save();

        // ✅ Generate transactionId correctly
        const transactionId = "TXN_" + Date.now();

        // ✅ Save ONE payment record (NO type)
        await Payment.create({
            transactionId,
            senderPhone,
            receiverPhone,
            amount: amt,
            status: "success"
        });

        res.json({
            success: true,
            transactionId
        });

    } catch (err) {
        console.error("❌ Direct payment error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get("/payment-history/:phone", async (req, res) => {
    try {
        const phone = req.params.phone;
        const after = req.query.after;

        /* =========================
           1️⃣ Build query
        ========================= */
        const query = {
            $or: [
                { senderPhone: phone },
                { receiverPhone: phone }
            ]
        };

        if (after) {
            query.createdAt = { $gt: new Date(after) };
        }

        /* =========================
           2️⃣ Fetch payments
        ========================= */
        const history = await Payment.find(query)
            .sort({ createdAt: -1 });

        if (!history.length) {
            return res.json([]);
        }

        /* =========================
           3️⃣ Collect phones
        ========================= */
        const phones = new Set();
        history.forEach(tx => {
            phones.add(tx.senderPhone);
            phones.add(tx.receiverPhone);
        });

        /* =========================
           4️⃣ Fetch users
        ========================= */
        const users = await User.find(
            { phone: { $in: [...phones] } },
            { phone: 1, name: 1 }
        );

        /* =========================
           5️⃣ Phone → Name map
        ========================= */
        const phoneToName = {};
        users.forEach(u => {
            phoneToName[u.phone] = u.name;
        });

        /* =========================
           6️⃣ Final response (DERIVE TYPE HERE)
        ========================= */
        const finalHistory = history.map(tx => {
            const isDebit = tx.senderPhone === phone;

            return {
                transactionId: tx.transactionId,   // 🔑 REQUIRED
                senderPhone: tx.senderPhone,
                receiverPhone: tx.receiverPhone,

                type: isDebit ? "debit" : "credit", // ✅ derived
                name: isDebit
                    ? phoneToName[tx.receiverPhone] || tx.receiverPhone
                    : phoneToName[tx.senderPhone] || tx.senderPhone,

                amount: tx.amount,
                createdAt: tx.createdAt
            };
        });

        res.json(finalHistory);

    } catch (err) {
        console.error("❌ history error", err);
        res.status(500).json({ error: "Server error" });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
