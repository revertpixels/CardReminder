const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    // Fields for OTP Logic
    resetOTP: { type: String },
    resetOTPExpires: { type: Date }
});

module.exports = mongoose.model('User', UserSchema);