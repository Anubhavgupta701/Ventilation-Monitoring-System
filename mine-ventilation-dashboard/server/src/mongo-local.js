// Starts a persistent local mongod (using the mongodb-memory-server cached binary)
// with a workspace dbpath, so `npm run seed` and the API share the same data.
// If port 27017 is already serving, it exits quietly and reuses it.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const PORT = 27017;
const DBPATH = path.join(__dirname, '..', '.mongodata');

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 1500);
  });
}

async function binaryPath() {
  const { DryMongoBinary } = require('mongodb-memory-server-core/lib/util/DryMongoBinary');
  const opts = await DryMongoBinary.generateOptions({});
  const name = await DryMongoBinary.getBinaryName(opts);
  const p = path.join(os.homedir(), '.cache', 'mongodb-binaries', name);
  if (fs.existsSync(p)) return p;
  // Not cached yet — let mongodb-memory-server download it once, then reuse.
  console.log('mongod binary not cached, downloading (one-time, ~100MB)...');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mms = await MongoMemoryServer.create();
  await mms.stop();
  if (!fs.existsSync(p)) throw new Error('Failed to obtain mongod binary at ' + p);
  return p;
}

(async () => {
  if (await portOpen(PORT)) {
    console.log(`MongoDB already running on 127.0.0.1:${PORT}, reusing it.`);
    // Keep this process alive so `concurrently` doesn't restart it.
    setInterval(() => {}, 60000);
    return;
  }
  const bin = await binaryPath();
  fs.mkdirSync(DBPATH, { recursive: true });
  console.log(`Starting mongod on 127.0.0.1:${PORT} (dbpath ${DBPATH})...`);
  const child = spawn(bin, ['--dbpath', DBPATH, '--port', String(PORT), '--bind_ip', '127.0.0.1', '--quiet'], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    console.error(`mongod exited with code ${code}`);
    process.exit(code || 1);
  });
  const shutdown = () => { child.kill('SIGTERM'); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
