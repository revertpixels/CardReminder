const mongoose = require('mongoose');

const CardSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Existing fields...
    holderName: { type: String, required: true },
    cardNickname: { type: String },
    bankName: { type: String, required: true },
    isOtherBank: { type: Boolean, default: false },
    cardNetwork: {
        type: String,
        // Ensure these match your dropdown options exactly
        enum: ['Debit Card', 'Visa', 'MasterCard', 'RuPay', 'American Express', 'Diners Club'],
        required: true
    },
    lastFourDigits: { type: Number, required: true },
    billingDate: { type: Number, required: true },
    dueDate: { type: Number, required: true },
    creditLimit: { type: Number },
    cardColor: { type: String, default: '#0d6efd' },

    notifyOnBilling: { type: Boolean, default: false },
    notifyBeforeDue: { type: Boolean, default: false },
    notifyDaysBefore: { type: Number },
    notifyCustomDate: { type: Date },

    // --- NEW FIELD ---
    isPaidForThisMonth: { type: Boolean, default: false }
});

module.exports = mongoose.model('Card', CardSchema);