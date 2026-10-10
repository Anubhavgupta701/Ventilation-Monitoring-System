// Mine Ventilation Monitoring Dashboard — API entry point.
// Express 4 + Socket.IO 4 + Mongoose 8. CommonJS.
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const config = require('./config');
const { createApp } = require('./app');
const { User } = require('./models/User');
const realtime = require('./realtime');
const simulator = require('./simulator');
const sweeper = require('./sweeper');

async function main() {
  await mongoose.connect(config.MONGO_URI);
  // eslint-disable-next-line no-console
  console.log(`[api] connected to MongoDB at ${config.MONGO_URI}`);

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: config.CORS_ORIGIN },
  });

  // Socket.IO /realtime — auth via handshake `auth: { token }`; server→client only.
  io.of('/realtime').use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, config.JWT_SECRET);
      const user = await User.findOne({ username: payload.sub }).lean();
      if (!user || !user.active) return next(new Error('unauthorized'));
      socket.data.user = { username: user.username, role: user.role };
      return next();
    } catch (e) {
      return next(new Error('unauthorized'));
    }
  });
  realtime.init(io);

  simulator.start();
  sweeper.start();

  server.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${config.PORT} (CORS origin ${config.CORS_ORIGIN})`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to start:', e.message || e);
  process.exit(1);
});
