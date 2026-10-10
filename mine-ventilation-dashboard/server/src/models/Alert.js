const crypto = require('crypto');
const mongoose = require('mongoose');

const historySchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true },
    action: { type: String, required: true }, // opened | escalated | acknowledged | resolved
    by: { type: String, required: true }, // username or "system"
    note: { type: String, default: '' },
  },
  { _id: false }
);

const alertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
    },
    sensorId: { type: String, required: true, index: true },
    parameter: { type: String, required: true },
    type: {
      type: String,
      enum: ['LIMIT', 'COMPOUND', 'STALE_COMMS'],
      required: true,
    },
    origin: { type: String, default: 'simulated' },
    severity: { type: String, enum: ['CRITICAL', 'WARNING'], required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'],
      default: 'ACTIVE',
      index: true,
    },
    openedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    triggerValue: { type: Number, default: null },
    peakValue: { type: Number, default: null },
    thresholdSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    acknowledgedBy: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
    ackNote: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, default: '' },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: false }
);

alertSchema.index({ openedAt: -1 });

// Dedup: at most one open (ACTIVE or ACKNOWLEDGED) alert per {sensorId, parameter, type}.
alertSchema.index(
  { sensorId: 1, parameter: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } },
  }
);

module.exports = { Alert: mongoose.model('Alert', alertSchema) };
