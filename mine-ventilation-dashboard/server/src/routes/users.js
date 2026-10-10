const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { audit } = require('../lib/audit');
const { User, ROLES } = require('../models/User');

const router = express.Router();

const publicUser = (u) => ({
  username: u.username,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
});

// GET /users — admin
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const users = await User.find({}).sort({ username: 1 }).lean();
    res.json({ data: users.map(publicUser), total: users.length });
  } catch (e) {
    next(e);
  }
});

// POST /users — admin
router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) {
      throw httpError(400, 'VALIDATION_ERROR', 'username, password and role are required');
    }
    if (!ROLES.includes(role)) {
      throw httpError(400, 'VALIDATION_ERROR', `role must be one of ${ROLES.join(', ')}`);
    }
    if (String(password).length < 4) {
      throw httpError(400, 'VALIDATION_ERROR', 'password must be at least 4 characters');
    }
    const exists = await User.findOne({ username });
    if (exists) throw httpError(409, 'CONFLICT', `User ${username} already exists`);
    const created = await User.create({
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      active: true,
    });
    await audit(req, 'user.create', 'user', username, null, publicUser(created.toObject()));
    res.status(201).json(publicUser(created.toObject()));
  } catch (e) {
    next(e);
  }
});

// PATCH /users/:username/active — admin (not self, not last admin)
router.patch('/:username/active', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
      throw httpError(400, 'VALIDATION_ERROR', 'Body must be { active: boolean }');
    }
    const target = await User.findOne({ username: req.params.username });
    if (!target) throw httpError(404, 'NOT_FOUND', `User ${req.params.username} not found`);
    if (target.username === req.user.username) {
      throw httpError(409, 'CONFLICT', 'You cannot change your own active status');
    }
    if (target.role === 'admin' && active === false) {
      const otherAdmins = await User.countDocuments({
        role: 'admin',
        active: true,
        username: { $ne: target.username },
      });
      if (otherAdmins === 0) {
        throw httpError(409, 'CONFLICT', 'Cannot deactivate the last active admin');
      }
    }
    const before = publicUser(target.toObject());
    target.active = active;
    await target.save();
    const after = publicUser(target.toObject());
    await audit(req, 'user.active', 'user', target.username, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
