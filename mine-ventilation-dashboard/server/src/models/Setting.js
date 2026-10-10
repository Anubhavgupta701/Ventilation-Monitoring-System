const mongoose = require('mongoose');

// Singleton mine/simulator settings. Exactly one document (key: 'mine').
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'mine', unique: true },
    tickMs: { type: Number, default: 3000, min: 2000, max: 5000 },
    persons: { type: Number, default: 250, min: 1 },
    dailyProductionTonnes: { type: Number, default: 400, min: 0 },
    retentionDays: { type: Number, default: 30, min: 1 },
    mineName: { type: String, default: 'Demo Underground Mine' },
  },
  { timestamps: true }
);

const Setting = mongoose.model('Setting', settingSchema);

async function getSettings() {
  let s = await Setting.findOne({ key: 'mine' }).lean();
  if (!s) {
    s = (await Setting.create({ key: 'mine' })).toObject();
  }
  return s;
}

module.exports = { Setting, getSettings };
