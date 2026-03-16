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
















app.post("/verify-face", async (req, res) => {
    let tempFile = null;
    let mediaId = null;

    try {
        console.log("📸 Face verification request received");

        const { phone, descriptor, image } = req.body;
        console.log("📱 Phone:", phone);

        const user = await User.findOne({ phone });
        if (!user || !user.faceDescriptor) {
            console.log("❌ User or saved face not found");
            return res.json({ verified: false });
        }

        // compare faces
        const saved = user.faceDescriptor;
        let sum = 0;
        for (let i = 0; i < saved.length; i++) {
            sum += Math.pow(saved[i] - descriptor[i], 2);
        }

        const distance = Math.sqrt(sum);
        console.log("📏 Face distance:", distance);

        if (distance < 0.5) {
            console.log("✅ Face MATCHED — payment allowed");
            return res.json({ verified: true });
        }

        console.log("🚨 Face NOT matched — sending to WhatsApp");

        // base64 → buffer
        const base64 = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");

        tempFile = path.join(TEMP_DIR, `${phone}_${Date.now()}.jpg`);
        fs.writeFileSync(tempFile, buffer);
        console.log("💾 Temp image saved:", tempFile);

        // upload to Meta
        const form = new FormData();
        form.append("file", fs.createReadStream(tempFile));
        form.append("type", "image/jpeg");
        form.append("messaging_product", "whatsapp");

        const uploadRes = await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/media`,
            form,
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    ...form.getHeaders()
                }
            }
        );

        mediaId = uploadRes.data.id;
        console.log("📤 Image uploaded to Meta. Media ID:", mediaId);

        // send message
        await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: phone,
                type: "image",
                image: {
                    id: mediaId,
                    view_once: true, // 🔒 REQUIRED
                    caption: "unknown person  detected during payment"
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );


        console.log("✅ WhatsApp message SENT successfully");

        // delete from Meta
        await axios.delete(
            `https://graph.facebook.com/v19.0/${mediaId}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
                }
            }
        );

        console.log("🗑️ Media deleted from Meta");

        return res.json({ verified: false });

    } catch (err) {
        console.error("❌ Face verify error:", err.response?.data || err.message);
        return res.json({ verified: false });

    } finally {
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
            console.log("🗑️ Temp file deleted from server");
        }
    }
});
