'use strict';
// RBAC + audit trail over HTTP, isolated via mongodb-memory-server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { User } = require('../src/models/User');
const { Fan } = require('../src/models/Fan');
const { Branch } = require('../src/models/Branch');
const { AuditLog } = require('../src/models/AuditLog');
const { createApp } = require('../src/app');

let mem, base, srv;

async function login(username, password) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `login ${username}`);
  const body = await res.json();
  return body.accessToken;
}

before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
  const mk = async (username, password, role) => User.create({
    username, passwordHash: await bcrypt.hash(password, 10), role, name: username,
  });
  await mk('op', 'op123', 'operator');
  await mk('viewer', 'viewer123', 'viewer');
  await mk('off', 'off123', 'officer');
  await Fan.create({
    fanId: 'FAN-MAIN', name: 'Main', kind: 'main', branchId: 'B-FANDRIFT', level: 'L-4',
    status: 'RUNNING', rpm: 1450, ratedRpm: 1450, ratedPressurePa: 1800,
    ratedAirflowM3min: 2350, powerKw: 110, auto: true,
  });
  await Branch.create({
    branchId: 'B-W3', name: 'Working branch 3', fromNode: { label: 'a', x: 0, y: 0 },
    toNode: { label: 'b', x: 1, y: 1 }, area: 8, direction: 'INTAKE',
    resistanceNs2m8: 0.55, path: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  const app = createApp();
  await new Promise((resolve) => {
    srv = app.listen(0, () => {
      base = `http://127.0.0.1:${srv.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (srv) await new Promise((resolve) => srv.close(resolve));
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

test('unauthenticated control endpoints → 401', async () => {
  const res = await fetch(`${base}/api/v1/fans/FAN-MAIN/stop`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('viewer gets 403 on POST /fans/:id/stop', async () => {
  const token = await login('viewer', 'viewer123');
  const res = await fetch(`${base}/api/v1/fans/FAN-MAIN/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);
});

test('operator fan control succeeds and writes an audit log', async () => {
  const token = await login('op', 'op123');
  const res = await fetch(`${base}/api/v1/fans/FAN-MAIN/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'STOPPED');

  const entries = await AuditLog.find({ entityType: 'fan', entityId: 'FAN-MAIN' }).lean();
  assert.ok(entries.length >= 1, 'audit log entry written');
  const e = entries[entries.length - 1];
  assert.equal(e.action, 'fan.stop');
  assert.equal(e.actor, 'op');
  assert.equal(e.before.status, 'RUNNING');
  assert.equal(e.after.status, 'STOPPED');
});

test('viewer can read but not inject faults; officer can', async () => {
  const viewerToken = await login('viewer', 'viewer123');
  const offToken = await login('off', 'off123');

  let res = await fetch(`${base}/api/v1/simulator/faults`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ faultId: 'methane-spike', targetId: 'B-W3' }),
  });
  assert.equal(res.status, 403);

  res = await fetch(`${base}/api/v1/simulator/faults`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${offToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ faultId: 'methane-spike', targetId: 'B-W3' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.faultId, 'methane-spike');

  const entries = await AuditLog.find({ action: 'fault.inject' }).lean();
  assert.ok(entries.length >= 1, 'fault injection audited');
  assert.equal(entries[0].actor, 'off');
});
