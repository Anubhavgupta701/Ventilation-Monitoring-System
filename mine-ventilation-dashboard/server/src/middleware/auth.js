const jwt = require('jsonwebtoken');
const config = require('../config');
const { httpError } = require('./errors');
const { User } = require('../models/User');

// Role hierarchy: viewer < operator < officer < admin.
const LEVELS = { viewer: 1, operator: 2, officer: 3, admin: 4 };

function signToken(user) {
  return jwt.sign(
    { sub: user.username, role: user.role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_SEC }
  );
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw httpError(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
    }
    let payload;
    try {
      payload = jwt.verify(token, config.JWT_SECRET);
    } catch (e) {
      throw httpError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    const user = await User.findOne({ username: payload.sub }).lean();
    if (!user || !user.active) {
      throw httpError(401, 'UNAUTHORIZED', 'Account inactive or not found');
    }
    req.user = { username: user.username, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

// requireRole('operator') → operator, officer, admin all pass.
function requireRole(minRole) {
  return (req, res, next) => {
    const level = LEVELS[req.user && req.user.role] || 0;
    if (level < (LEVELS[minRole] || 0)) {
      return next(httpError(403, 'FORBIDDEN', `Requires role ${minRole} or higher`));
    }
    next();
  };
}

module.exports = { authenticate, requireRole, signToken, LEVELS };
