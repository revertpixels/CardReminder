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
];

// --- HELPER FUNCTION: PASSWORD VALIDATION ---
function validatePassword(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (password.length < minLength) return "Password must be at least 8 characters.";
    if (!hasUpperCase) return "Password must contain at least one uppercase letter.";
    if (!hasLowerCase) return "Password must contain at least one lowercase letter.";
    if (!hasNumber) return "Password must contain at least one number.";
    return null; // No error
}

// --- ROUTES ---

// Auth
app.get('/', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    // 1. Check Password Strength
    const passwordError = validatePassword(password);
    if (passwordError) {
        req.flash('error_msg', passwordError);
        return res.redirect('/register');
    }

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
        req.flash('error_msg', 'No account found.');
        return res.redirect('/forgot-password');
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    user.resetOTPExpires = Date.now() + 600000;
    await user.save();
    req.session.resetEmail = email;

    const emailHTML = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f3f4f6; padding: 20px; border-radius: 10px;">
        <div style="background-color: #ffffff; padding: 40px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.05); text-align: center;">
            
            <div style="display: inline-block; background-color: #4f46e5; padding: 12px; border-radius: 50%; margin-bottom: 20px;">
                <img src="https://img.icons8.com/ios-filled/50/ffffff/lock.png" alt="Security" style="width: 24px; height: 24px; display: block;">
            </div>

            <h2 style="color: #1f2937; margin: 0 0 10px; font-size: 24px; font-weight: 700;">Password Reset Request</h2>
            <p style="color: #6b7280; font-size: 16px; margin: 0 0 30px;">
                Hello, we received a request to reset the password for your <strong>CardGuard</strong> account.
            </p>

            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; display: inline-block; margin-bottom: 30px;">
                <span style="font-size: 32px; font-weight: 800; letter-spacing: 5px; color: #4f46e5; display: block;">${otp}</span>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-bottom: 30px;">
                This code is valid for <strong>10 minutes</strong>.<br>
                If you did not request a password reset, please ignore this email.
            </p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                    &copy; ${new Date().getFullYear()} CardGuard Security Team.<br>
                    Secure Account Notification
                </p>
            </div>
        </div>
    </div>
    `;

    transporter.sendMail({
        from: `"CardGuard Security" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 Your Verification Code',
        text: emailHTML
    }, (err) => {
        if(err) req.flash('error_msg', 'Error sending email.');
        else { req.flash('success_msg', 'OTP sent.'); res.redirect('/verify-otp'); }
    });
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

    // 1. Check Passwords Match
    if(password !== confirmPassword) {
        req.flash('error_msg', 'Passwords do not match.');
        return res.redirect('/reset-password');
    }

    // 2. Check Password Strength
    const passwordError = validatePassword(password);
    if (passwordError) {
        req.flash('error_msg', passwordError);
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
// ... existing imports

// Notifications Cron Job
cron.schedule('0 9,14,20 * * *', async () => {
    const today = new Date().getDate();
    const cards = await Card.find().populate('user');

    cards.forEach(card => {
        let diff = card.dueDate - today;

        // Handle month wrap-around logic (approximate)
        if (diff < 0) diff += 30;

        // Send email if due within 0-3 days
        if (diff >= 0 && diff <= 3) {

            const daysText = diff === 0 ? "Due Today!" : `${diff} Days Left`;
            const colorStatus = diff === 0 ? "#dc2626" : "#ea580c"; // Red for today, Orange for upcoming

            // --- HTML EMAIL TEMPLATE ---
            const emailHTML = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f3f4f6; padding: 20px; border-radius: 10px;">
                <div style="background-color: #ffffff; padding: 40px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.05); text-align: center;">
                    
                    <div style="display: inline-block; background-color: #fef2f2; padding: 14px; border-radius: 50%; margin-bottom: 20px;">
                        <img src="https://img.icons8.com/ios-filled/50/ef4444/alarm.png" alt="Alert" style="width: 28px; height: 28px; display: block;">
                    </div>

                    <h2 style="color: #1f2937; margin: 0 0 10px; font-size: 24px; font-weight: 800;">Bill Payment Reminder</h2>
                    <p style="color: #6b7280; font-size: 16px; margin: 0 0 30px;">
                        This is a friendly reminder that your credit card bill is due soon.
                    </p>

                    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 25px; text-align: left; margin-bottom: 30px;">
                        
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                            <span style="color: #6b7280; font-size: 14px; font-weight: 500;">Bank Name</span>
                            <span style="color: #111827; font-weight: 700; font-size: 16px;">${card.bankName}</span>
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                            <span style="color: #6b7280; font-size: 14px; font-weight: 500;">Card Ending</span>
                            <span style="font-family: monospace; color: #111827; font-weight: 600; font-size: 16px; letter-spacing: 1px;">•••• ${card.lastFourDigits}</span>
                        </div>

                        <div style="border-top: 1px solid #e5e7eb; margin: 15px 0;"></div>

                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="color: ${colorStatus}; font-weight: 700; font-size: 14px;">Time Remaining</span>
                            <span style="color: ${colorStatus}; font-weight: 800; font-size: 20px;">${daysText}</span>
                        </div>
                    </div>

                    <a href="https://your-app-url.onrender.com/dashboard" style="background-color: #111827; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block; transition: 0.3s;">
                        Go to Dashboard
                    </a>

                    <div style="border-top: 1px solid #e5e7eb; padding-top: 25px; margin-top: 35px;">
                        <p style="color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.5;">
                            &copy; ${new Date().getFullYear()} CardGuard Security.<br>
                            You received this email because you enabled notifications for this card.
                        </p>
                    </div>
                </div>
            </div>
            `;

            // Send Mail
            transporter.sendMail({
                from: `"CardGuard Security" <${process.env.EMAIL_USER}>`,
                to: card.user.email,
                subject: `⚠️ Action Required: ${card.bankName} Bill Due`, // More urgent subject
                html: emailHTML
            }, (err, info) => {
                if(err) console.log("Error sending reminder:", err);
                else console.log(`Reminder sent to ${card.user.email} for ${card.bankName}`);
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));