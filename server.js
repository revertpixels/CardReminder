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

// --- DASHBOARD WITH STATS CALCULATION ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        const cards = await Card.find({ user: req.session.user._id });

        // --- Calculate Stats ---
        const today = new Date().getDate();
        let stats = {
            total: cards.length,
            dueSoon: 0,
            billingSoon: 0,
            paid: 0
        };

        cards.forEach(card => {
            // 1. Paid Count
            if (card.isPaidForThisMonth) {
                stats.paid++;
            } else {
                // 2. Due Soon (Next 3 days) - Only count if NOT paid
                let diff = card.dueDate - today;
                if (diff < 0) diff += 30; // approximate month wrap
                if (diff >= 0 && diff <= 3) stats.dueSoon++;
            }

            // 3. Billing Soon (Next 3 days)
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

// Delete Card (Direct)
app.post('/delete-card/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        await Card.findOneAndDelete({ _id: req.params.id, user: req.session.user._id });
        req.flash('success_msg', 'Card deleted successfully.');
        res.redirect('/dashboard');
    } catch(err) {
        console.log(err);
        req.flash('error_msg', 'Error deleting card');
        res.redirect('/dashboard');
    }
});

// Mark Paid API
app.post('/mark-paid/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Card.findOneAndUpdate(
            { _id: req.params.id, user: req.session.user._id },
            { isPaidForThisMonth: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark Unpaid API
app.post('/mark-unpaid/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Card.findOneAndUpdate(
            { _id: req.params.id, user: req.session.user._id },
            { isPaidForThisMonth: false }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Password Reset
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465, // Use 465 for secure connection
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.get('/forgot-password', (req, res) => res.render('forgot-password'));
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            req.flash('error_msg', 'No account found.');
            return res.redirect('/forgot-password');
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetOTP = otp;
        user.resetOTPExpires = Date.now() + 600000; // 10 mins
        await user.save();

        req.session.resetEmail = email;

        // Use AWAIT here to ensure email is sent before redirecting
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Reset Password OTP',
            text: `Your OTP is ${otp}.`
        });

        console.log("Email sent successfully to:", email); // Log for debugging on Render
        req.flash('success_msg', 'OTP sent to your email.');
        res.redirect('/verify-otp');

    } catch (error) {
        console.error("Email Error:", error); // This will show up in Render logs
        req.flash('error_msg', 'Error sending email. Check server logs.');
        res.redirect('/forgot-password');
    }
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
    if(password !== confirmPassword) { req.flash('error_msg', 'Mismatch'); return res.redirect('/reset-password'); }
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
                from: process.env.EMAIL_USER, to: card.user.email,
                subject: `⚠️ Bill Due: ${card.bankName}`,
                html: `<p>Pay your ${card.bankName} bill (Ending: ${card.lastFourDigits}) within ${diff} days.</p>`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));