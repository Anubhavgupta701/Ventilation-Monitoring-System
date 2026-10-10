const mongoose = require('mongoose');

const thresholdProfileSchema = new mongoose.Schema(
  {
    profileKey: { type: String, required: true, trim: true },
    version: { type: Number, required: true },
    parameter: { type: String, required: true },
    locationType: { type: String, required: true },
    comparator: { type: String, enum: ['MAX', 'MIN'], default: 'MAX' },
    warning: { type: Number, default: null },
    critical: { type: Number, default: null },
    unit: { type: String, default: '' },
    ruleType: { type: String, enum: ['limit', 'compound'], default: 'limit' },
    condition: {
      type: new mongoose.Schema(
        {
          triggerAbove: Number,
          requiresParam: String,
          min: Number,
          unit: String,
        },
        { _id: false }
      ),
      default: null,
    },
    // Air-quantity factors (e.g. { perPerson: 6, perTonne: 2.5 }) live ON the
    // TP-AIRQTY-FACTORS profile — never hard-coded in the engine or calculator.
    factors: {
      type: new mongoose.Schema(
        { perPerson: Number, perTonne: Number },
        { _id: false }
      ),
      default: null,
    },
    sourceType: {
      type: String,
      enum: ['STATUTORY', 'DEMO', 'MINE_PLAN'],
      default: 'DEMO',
    },
    // Provenance of the WARNING level specifically: seed warning levels are
    // DEMO defaults (~85% toward the limit) even when the critical limit is
    // STATUTORY — warnings are mine/operator configuration, editable.
    warningSourceType: {
      type: String,
      enum: ['STATUTORY', 'DEMO', 'MINE_PLAN'],
      default: 'DEMO',
    },
    sourceRef: { type: String, default: '' },
    sourceDate: { type: Date, default: null },
    verificationNote: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

thresholdProfileSchema.index({ profileKey: 1, version: 1 }, { unique: true });

module.exports = {
  ThresholdProfile: mongoose.model('ThresholdProfile', thresholdProfileSchema),
};
