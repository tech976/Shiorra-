const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/authController');
const { isGuest } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts. Try again in 10 minutes.',
});

router.get('/login', isGuest, ctrl.showLogin);
router.post('/login', loginLimiter, ctrl.login);

router.get('/register', isGuest, ctrl.showRegister);
router.post('/register', loginLimiter, ctrl.register);

router.post('/logout', ctrl.logout);
router.get('/logout', ctrl.logout); // convenience

module.exports = router;
