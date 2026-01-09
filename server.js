require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

// Models
const User = require('./models/User');
const Card = require('./models/Card');

const app = express();

// --- CONFIGURATION ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cardReminder')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ DB Error:', err));

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: true
}));
app.use(flash());

// Global Variables
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.user = req.session.user || null;
    next();
});

const BANK_LIST = [
    "AU Small Finance Bank", "American Express Bank", "Axis Bank", "Bank Of Baroda",
    "Canara Bank", "Citi Bank", "FederalBank", "HDFC Bank", "HSBS Bank", "ICICI Bank",
    "IDFC Bank", "IndusInd Bank", "Kotak Bank", "PNB bank", "RBI Bank", "SBI Bank",
    "SBM Bank", "Slice Bank", "Standard Chartered Bank", "Union Bank",
    "Unity Small Finance Bank", "Utkarsha Small Finance Bank", "Yes Bank",
    "Dinersclub", "Master Card", "Rupay", "Visa"
];

// --- ROUTES ---

// Auth
app.get('/', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ name, email, password: hashedPassword });
        req.flash('success_msg', 'Registered! Please login.');
        res.redirect('/');
    } catch (e) {
        req.flash('error_msg', 'Email already exists or error occurred.');
        res.redirect('/register');
    }
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.user = user;
        res.redirect('/dashboard');
    } else {
        req.flash('error_msg', 'Invalid Email or Password');
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Dashboard
app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        const cards = await Card.find({ user: req.session.user._id });

        // --- Calculate Stats ---
        const today = new Date().getDate();
        let stats = { total: cards.length, dueSoon: 0, billingSoon: 0, paid: 0 };

        cards.forEach(card => {
            if (card.isPaidForThisMonth) {
                stats.paid++;
            } else {
                let diff = card.dueDate - today;
                if (diff < 0) diff += 30;
                if (diff >= 0 && diff <= 3) stats.dueSoon++;
            }
            let billDiff = card.billingDate - today;
            if (billDiff < 0) billDiff += 30;
            if (billDiff >= 0 && billDiff <= 3) stats.billingSoon++;
        });

        res.render('dashboard', { cards, stats });
    } catch (e) {
        console.log(e);
        res.redirect('/');
    }
});

app.get('/add-card', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.render('add-card', { banks: BANK_LIST });
});

app.post('/add-card', async (req, res) => {
    if (!req.session.user) return res.redirect('/');

    const {
        holderName, cardNickname, selectedBank, customBankName, cardNetwork,
        lastFourDigits, billingDate, dueDate, creditLimit, cardColor,
        notifyOnBilling, notifyBeforeDue, notifyDaysBefore, notifyCustomDate
    } = req.body;

    let finalBankName = selectedBank;
    let isOther = false;

    if (selectedBank === 'Other') {
        finalBankName = customBankName.trim();
        isOther = true;
    }

    await Card.create({
        user: req.session.user._id,
        holderName,
        cardNickname,
        bankName: finalBankName,
        isOtherBank: isOther,
        cardNetwork,
        lastFourDigits,
        billingDate,
        dueDate,
        creditLimit: creditLimit || 0,
        cardColor,
        notifyOnBilling: notifyOnBilling === 'on',
        notifyBeforeDue: notifyBeforeDue === 'on',
        notifyDaysBefore: notifyDaysBefore ? parseInt(notifyDaysBefore) : null,
        notifyCustomDate: notifyCustomDate ? new Date(notifyCustomDate) : null
    });

    req.flash('success_msg', 'Card added successfully!');
    res.redirect('/dashboard');
});

// Edit Card
app.get('/edit-card/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        const card = await Card.findById(req.params.id);
        if(card.user.toString() !== req.session.user._id.toString()){
            req.flash('error_msg', 'Unauthorized');
            return res.redirect('/dashboard');
        }
        res.render('edit-card', { card, banks: BANK_LIST });
    } catch(err) {
        res.redirect('/dashboard');
    }
});

app.post('/edit-card/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/');

    const {
        holderName, cardNickname, selectedBank, customBankName, cardNetwork,
        lastFourDigits, billingDate, dueDate, creditLimit, cardColor,
        notifyOnBilling, notifyBeforeDue, notifyDaysBefore, notifyCustomDate
    } = req.body;

    let finalBankName = selectedBank;
    let isOther = false;
    if (selectedBank === 'Other') {
        finalBankName = customBankName.trim();
        isOther = true;
    }

    try {
        await Card.findOneAndUpdate(
            { _id: req.params.id, user: req.session.user._id },
            {
                holderName,
                cardNickname,
                bankName: finalBankName,
                isOtherBank: isOther,
                cardNetwork,
                lastFourDigits,
                billingDate,
                dueDate,
                creditLimit: creditLimit || 0,
                cardColor,
                notifyOnBilling: notifyOnBilling === 'on',
                notifyBeforeDue: notifyBeforeDue === 'on',
                notifyDaysBefore: notifyDaysBefore ? parseInt(notifyDaysBefore) : null,
                notifyCustomDate: notifyCustomDate ? new Date(notifyCustomDate) : null,
                isPaidForThisMonth: false
            }
        );
        req.flash('success_msg', 'Card updated successfully!');
        res.redirect('/dashboard');
    } catch(err) {
        console.log(err);
        req.flash('error_msg', 'Error updating card');
        res.redirect('/dashboard');
    }
});

// --- CARD ACTIONS ---
app.post('/delete-card/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        await Card.findOneAndDelete({ _id: req.params.id, user: req.session.user._id });
        req.flash('success_msg', 'Card deleted successfully.');
        res.redirect('/dashboard');
    } catch(err) {
        req.flash('error_msg', 'Error deleting card');
        res.redirect('/dashboard');
    }
});

app.post('/mark-paid/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Card.findOneAndUpdate({ _id: req.params.id, user: req.session.user._id }, { isPaidForThisMonth: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/mark-unpaid/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Card.findOneAndUpdate({ _id: req.params.id, user: req.session.user._id }, { isPaidForThisMonth: false });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Password Reset Flow
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

app.get('/forgot-password', (req, res) => res.render('forgot-password'));

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
        req.flash('error_msg', 'No account found with that email.');
        return res.redirect('/forgot-password');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    user.resetOTPExpires = Date.now() + 600000; // 10 Minutes
    await user.save();

    req.session.resetEmail = email;
    req.flash('success_msg', 'OTP is being sent to your email.');
    res.redirect('/verify-otp');

    // Background Email Send (Fast)
    const emailHTML = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #f3f4f6; padding: 20px; border-radius: 10px;">
        <div style="background: #ffffff; padding: 40px; border-radius: 10px; text-align: center;">
            <div style="display: inline-block; background: #4f46e5; padding: 12px; border-radius: 50%; margin-bottom: 20px;">
                <img src="https://img.icons8.com/ios-filled/50/ffffff/lock.png" style="width: 24px;">
            </div>
            <h2 style="color: #1f2937; margin-bottom: 10px;">Password Reset Request</h2>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; display: inline-block; margin: 30px 0;">
                <span style="font-size: 32px; font-weight: 800; letter-spacing: 5px; color: #4f46e5;">${otp}</span>
            </div>
            <p style="color: #6b7280;">Valid for 10 minutes. If you didn't request this, ignore it.</p>
        </div>
    </div>`;

    transporter.sendMail({
        from: `"CardGuard Security" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 Your Verification Code',
        html: emailHTML
    }).catch(err => console.error("Email Error:", err));
});

app.get('/verify-otp', (req, res) => { if(!req.session.resetEmail) return res.redirect('/forgot-password'); res.render('verify-otp'); });
app.post('/verify-otp', async (req, res) => {
    const { otp } = req.body;
    const user = await User.findOne({ email: req.session.resetEmail, resetOTP: otp, resetOTPExpires: { $gt: Date.now() } });
    if (!user) { req.flash('error_msg', 'Invalid/Expired OTP'); return res.redirect('/verify-otp'); }
    req.session.isOtpVerified = true; res.redirect('/reset-password');
});

app.get('/reset-password', (req, res) => { if(!req.session.isOtpVerified) return res.redirect('/forgot-password'); res.render('reset-password'); });
app.post('/reset-password', async (req, res) => {
    const { password, confirmPassword } = req.body;

    if(password !== confirmPassword) {
        req.flash('error_msg', 'Passwords do not match.');
        return res.redirect('/reset-password');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.findOne({ email: req.session.resetEmail });
    user.password = hashedPassword; user.resetOTP = undefined; user.resetOTPExpires = undefined;
    await user.save();
    delete req.session.resetEmail; delete req.session.isOtpVerified;
    req.flash('success_msg', 'Password reset! Login.'); res.redirect('/');
});

// Notifications
cron.schedule('0 9,14,20 * * *', async () => {
    const today = new Date().getDate();
    const cards = await Card.find().populate('user');
    cards.forEach(card => {
        let diff = card.dueDate - today;
        if(diff < 0) diff += 30;
        if (diff >= 0 && diff <= 3) {
            transporter.sendMail({
                from: `"CardGuard Security" <${process.env.EMAIL_USER}>`,
                to: card.user.email,
                subject: `⚠️ Bill Due: ${card.bankName}`,
                html: `<p>Pay your ${card.bankName} bill (Ending: ${card.lastFourDigits}) within ${diff} days.</p>`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));