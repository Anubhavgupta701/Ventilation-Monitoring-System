// Central config — all tunables live here, nothing secret is hard-coded.
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('[warn] JWT_SECRET not set — using dev default "dev-secret-change-me". Set JWT_SECRET in production.');
}

module.exports = {
  PORT: Number(process.env.PORT) || 4001,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/minevent',
  JWT_SECRET: JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_SEC: 4 * 60 * 60, // ~4h single short-lived access token, no refresh
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5174',
  API_VERSION: '1.0.0',
};
