const mongoose = require('mongoose');

// Capped collection: rolling window of simulator snapshots for the
// time-machine playback (~12 MB / max ~500 docs).
const simSnapshotSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    simTime: { type: Number, default: 0 }, // simulated seconds elapsed
    overallStatus: { type: String, default: 'NORMAL' },
    kpis: { type: mongoose.Schema.Types.Mixed, default: {} },
    branches: { type: mongoose.Schema.Types.Mixed, default: {} }, // branchId → { q, v, dp, status }
    fans: { type: mongoose.Schema.Types.Mixed, default: {} },
    doors: { type: mongoose.Schema.Types.Mixed, default: {} },
    regulators: { type: mongoose.Schema.Types.Mixed, default: {} },
    activeFaults: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  {
    timestamps: false,
    capped: { size: 12 * 1024 * 1024, max: 500 },
  }
);

module.exports = { SimSnapshot: mongoose.model('SimSnapshot', simSnapshotSchema) };
