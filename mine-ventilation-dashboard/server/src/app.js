const express = require('express');
const cors = require('cors');
const config = require('./config');
const { requestId, errorHandler, notFound } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const overviewRoutes = require('./routes/overview');
const sensorRoutes = require('./routes/sensors');
const branchRoutes = require('./routes/branches');
const districtRoutes = require('./routes/districts');
const alertRoutes = require('./routes/alerts');
const thresholdRoutes = require('./routes/thresholds');
const calculationRoutes = require('./routes/calculations');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const simulatorRoutes = require('./routes/simulator');
const fanRoutes = require('./routes/fans');
const doorRoutes = require('./routes/doors');
const regulatorRoutes = require('./routes/regulators');
const settingsRoutes = require('./routes/settings');
const auditRoutes = require('./routes/audit');
const historyRoutes = require('./routes/history');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  const v1 = express.Router();
  v1.use('/auth', authRoutes);
  v1.use('/healthz', healthRoutes);
  v1.use('/overview', overviewRoutes);
  v1.use('/sensors', sensorRoutes);
  v1.use('/branches', branchRoutes);
  v1.use('/districts', districtRoutes);
  v1.use('/alerts', alertRoutes);
  v1.use('/thresholds', thresholdRoutes);
  v1.use('/calculations', calculationRoutes);
  v1.use('/reports', reportRoutes);
  v1.use('/users', userRoutes);
  v1.use('/simulator', simulatorRoutes);
  v1.use('/fans', fanRoutes);
  v1.use('/doors', doorRoutes);
  v1.use('/regulators', regulatorRoutes);
  v1.use('/settings', settingsRoutes);
  v1.use('/audit', auditRoutes);
  v1.use('/history', historyRoutes);
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
