const express = require('express');
const mongoose = require('mongoose');
const path = require("path");
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 1290;
const User = require("./user/User");

app.use(cors());
app.use(express.json());
mongoose.connect("mongodb://127.0.0.1:27017/phonepe")
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

// serve static files
app.use(express.static(__dirname));
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "Login.html"));
});

app.post("/register", async (req, res) => {
    const { name, phone, bank, faceDescriptor } = req.body;

    if (!faceDescriptor || faceDescriptor.length !== 128) {
        return res.json({ success: false, message: "Invalid face data" });
    }
    const existingUser = await User.findOne({ phone });

    if (existingUser) {
        return res.json({
            success: false,
            message: "User already registered with this phone number"
        });
    }
    const user = await User.create({
        name,
        phone,
        bank,
        faceDescriptor
    });
    console.log(user.balance);

    res.json({ success: true });
});



app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
