const mongoose = require('mongoose');

const VALUE_PARAMS = [
  'airflow',
  'velocity',
  'ch4',
  'co2',
  'co',
  'o2',
  'temp',
  'wetBulb',
  'humidity',
  'pressure',
  'dust',
  'fanRpm',
];

// Explicit numeric sub-keys (only measured params are present on a reading).
const valuesSchema = {};
for (const p of VALUE_PARAMS) valuesSchema[p] = { type: Number };

const readingSchema = new mongoose.Schema(
  {
    sensorId: { type: String, required: true },
    measuredAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    origin: { type: String, default: 'simulated' }, // stamped server-side only
    values: { type: new mongoose.Schema(valuesSchema, { _id: false }), default: {} },
    derived: {
      type: [{ parameter: String, expression: String, _id: false }],
      default: [],
    },
    quality: {
      type: String,
      enum: ['NORMAL', 'DROPOUT', 'STUCK', 'SPIKE'],
      default: 'NORMAL',
    },
  },
  { timestamps: false }
);

readingSchema.index({ sensorId: 1, measuredAt: 1 }, { unique: true });
// Note: the unique compound index also serves sensorId-prefix range queries,
// so no second identical index is declared (Mongoose warns on duplicates).

module.exports = { Reading: mongoose.model('Reading', readingSchema), VALUE_PARAMS };
