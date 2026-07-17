require('dotenv').config();

const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Missing required environment variable: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT, 10) || 3000,
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  // Transactional email (order confirmations). Provider-agnostic SMTP so it
  // works with Resend (smtp.resend.com, user "resend", pass = API key), Brevo,
  // SES, Gmail, etc. With no host/pass configured the mailer is disabled and
  // just logs — nothing is ever sent, and order flow never breaks.
  mail: {
    // Preferred transport: Resend's HTTP API over 443. VPS hosts routinely
    // block outbound SMTP (25/465/587), so the API is the reliable path in
    // production. SMTP below stays as a fallback for any other provider.
    resendApiKey: process.env.RESEND_API_KEY || '',
    host: process.env.MAIL_HOST || '',
    port: parseInt(process.env.MAIL_PORT, 10) || 465,
    secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : true,
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || 'Shiōrra <orders@shiorra.com>',
    replyTo: process.env.MAIL_REPLY_TO || 'hello@shiorra.com',
  },
  upload: {
    dir: process.env.UPLOAD_DIR || 'src/public/uploads',
    maxMb: parseInt(process.env.MAX_UPLOAD_MB, 10) || 8,
  },
  adminBootstrap: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME || 'Shiorra Admin',
  },
};
