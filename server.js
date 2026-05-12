import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import { Resend } from 'resend';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getUserByEmail, createUser, setUserVerified,
  getLettersByUser, createLetter, markLetterSent, getLetters,
  getPublicStories, createStory, getStories
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
}));

// Auth helpers
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login.html?error=Please+log+in+first.');
  next();
}

// Registration
app.post('/register', async (req, res) => {
  const { fullName, email, password, confirmPassword } = req.body;

  if (!fullName || !email || !password || !confirmPassword)
    return res.redirect('/register.html?error=All+fields+are+required.');

  if (password !== confirmPassword)
    return res.redirect('/register.html?error=Passwords+do+not+match.');

  if (password.length < 8)
    return res.redirect('/register.html?error=Password+must+be+at+least+8+characters.');

  if (getUserByEmail(email))
    return res.redirect('/register.html?error=An+account+with+that+email+already+exists.');

  const hashedPassword = await bcrypt.hash(password, 10);
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);

  createUser({ fullName, email, password: hashedPassword, verifyToken: token, verified: false });

  // Send verification email
  const verifyUrl = `http://localhost:${process.env.PORT || 3000}/verify?token=${token}&email=${encodeURIComponent(email)}`;
  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: email,
    subject: 'Verify your FutureSelf account',
    html: `
      <h2>Welcome to FutureSelf, ${fullName}!</h2>
      <p>Click the link below to verify your email address and activate your account.</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>If you didn't sign up, you can ignore this email.</p>
    `
  });

  res.redirect('/register.html?success=Account+created!+Check+your+email+to+verify+your+account.');
});

// Email verification
app.get('/verify', (req, res) => {
  const { token, email } = req.query;
  const user = getUserByEmail(email);

  if (!user || user.verifyToken !== token)
    return res.send(page('Verification Failed', `<p>Invalid or expired link. <a href="/register.html">Register again.</a></p>`));

  setUserVerified(email);
  res.send(page('Email Verified', `<p>Your account is verified! <a href="/login.html">Log in now.</a></p>`));
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = getUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.redirect('/login.html?error=Incorrect+email+or+password.');

  if (!user.verified)
    return res.redirect('/login.html?error=Please+verify+your+email+before+logging+in.');

  req.session.user = { email: user.email, fullName: user.fullName };
  res.redirect('/dashboard.html');
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/index.html');
});

// Dashboard data (letters for logged-in user)
app.get('/api/dashboard', requireLogin, (req, res) => {
  const letters = getLettersByUser(req.session.user.email);
  res.json({ user: req.session.user, letters });
});

// Write a letter 
app.post('/submit', requireLogin, async (req, res) => {
  const { deliverDate, message } = req.body;
  const email = req.session.user.email;

  if (!deliverDate || !message)
    return res.redirect('/write.html?error=All+fields+are+required.');

  const today = new Date().toISOString().split('T')[0];
  if (deliverDate <= today)
    return res.redirect('/write.html?error=Delivery+date+must+be+in+the+future.');

  createLetter({ email, deliverDate, message });

  // Confirmation email
  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: email,
    subject: 'Your letter is scheduled — FutureSelf',
    html: `
      <h2>Your letter is sealed.</h2>
      <p>We'll deliver it to <strong>${email}</strong> on <strong>${deliverDate}</strong>.</p>
      <p>Here's what you wrote:</p>
      <blockquote style="border-left:3px solid #ccc;padding-left:16px;color:#555;font-style:italic;">
        ${message.replace(/\n/g, '<br>')}
      </blockquote>
      <p>— FutureSelf</p>
    `
  });

  res.redirect('/dashboard.html?success=Letter+scheduled!+A+confirmation+has+been+sent+to+your+email.');
});

// Submit a story 
app.post('/story', requireLogin, async (req, res) => {
  const { feedback, excerpt, visibility } = req.body;
  const { email, fullName } = req.session.user;

  if (!feedback)
    return res.redirect('/stories.html?error=Please+write+your+experience+before+submitting.');

  // User must have received at least one letter
  const letters = getLettersByUser(email);
  const hasReceived = letters.some(l => l.sent);
  if (!hasReceived)
    return res.redirect('/stories.html?error=You+can+only+share+a+story+after+receiving+a+letter.');

  createStory({ email, fullName, feedback, excerpt: excerpt || '', visibility: visibility || 'public' });

  res.redirect('/stories.html?success=Story+submitted!+Thank+you+for+sharing.');
});

// Public stories API 
app.get('/api/stories', (req, res) => {
  res.json(getPublicStories().reverse());
});

// Session status (so HTML pages know if user is logged in) 
app.get('/api/me', (req, res) => {
  if (req.session.user) res.json({ loggedIn: true, ...req.session.user });
  else res.json({ loggedIn: false });
});

// Cron: send due letters every day at 8am 
cron.schedule('0 8 * * *', async () => {
  const today = new Date().toISOString().split('T')[0];
  const letters = getLetters().filter(l => l.deliverDate === today && !l.sent);

  for (const letter of letters) {
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: letter.email,
        subject: 'A message from your past self — FutureSelf',
        html: `
          <h2>A message from your past self</h2>
          <p>On <strong>${letter.createdAt.split('T')[0]}</strong>, you wrote this letter to yourself. Today is the day it arrives.</p>
          <hr>
          <div style="font-family:Georgia,serif;font-size:16px;line-height:1.8;padding:16px 0;">
            ${letter.message.replace(/\n/g, '<br>')}
          </div>
          <hr>
          <p>Now that you've received your letter, <a href="http://localhost:3000/stories.html">share your story</a> with others.</p>
          <p>— FutureSelf</p>
        `
      });
      markLetterSent(letter.id);
      console.log(`[cron] Sent letter ${letter.id} to ${letter.email}`);
    } catch (err) {
      console.error(`[cron] Failed for ${letter.email}:`, err.message);
    }
  }

  if (letters.length === 0) console.log(`[cron] No letters due today (${today})`);
});

// HTML wrapper for server rendered responses 
function page(title, body) {
  return `<!DOCTYPE html><html><head><title>${title} — FutureSelf</title></head>
  <body><h1>${title}</h1>${body}<p><a href="/index.html">← Home</a></p></body></html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FutureSelf running at http://localhost:${PORT}`));
