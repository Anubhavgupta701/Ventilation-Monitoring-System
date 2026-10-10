const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { httpError } = require('../middleware/errors');
const { authenticate, signToken } = require('../middleware/auth');
const { User } = require('../models/User');

const router = express.Router();

// POST /auth/login — public
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Username and password are required');
    }
    const user = await User.findOne({ username });
    if (!user || !user.active) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }
    res.json({
      accessToken: signToken(user),
      expiresIn: config.JWT_EXPIRES_SEC,
      user: { username: user.username, role: user.role },
    });
  } catch (e) {
    next(e);
  }
});

// GET /auth/me — any authenticated user
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// POST /auth/logout — token is client-held; server just acknowledges.
router.post('/logout', authenticate, (req, res) => {
  res.status(204).end();
});

module.exports = router;
