const mongoose = require("mongoose");

/* ================= PAYMENT SCHEMA (FINAL) ================= */
const paymentSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true          // 🔒 VERY IMPORTANT
    },

    orderId: {
        type: String
    },

    amount: {
        type: Number,
        required: true
    },

    senderPhone: {
        type: String,
        required: true
    },

    receiverPhone: {
        type: String,
        required: true
    },

    status: {
        type: String,
        enum: ["success", "failed", "pending"],
        default: "success"
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

/* ================= PAYMENT LIMIT SCHEMA ================= */
const paymentLimitSchema = new mongoose.Schema({
    enabled: {
        type: Boolean,
        default: false
    },
    amount: {
        type: Number,
        default: 0
    }
}, { _id: false });

/* ================= USER SCHEMA ================= */
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },

    phone: {
        type: String,
        unique: true,
        required: true
    },

    bank: {
        type: String,
        required: true
    },

    balance: {
        type: Number,
        default: 50000
    },

    upiPin: String,

    faceDescriptor: {
        type: [Number],
        required: true
    },

    paymentLimit: {
        type: paymentLimitSchema,
        default: () => ({})
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

/* ================= EXPORT MODELS ================= */
const User = mongoose.model("User", userSchema);
const Payment = mongoose.model("Payment", paymentSchema);

module.exports = { User, Payment };
