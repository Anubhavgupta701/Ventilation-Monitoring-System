const mongoose = require('mongoose');

const regulatorSchema = new mongoose.Schema(
  {
    regulatorId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    branchId: { type: String, default: null },
    level: { type: String, enum: ['L-1', 'L-2', 'L-3', 'L-4'], default: 'L-1' },
    openingPct: { type: Number, default: 70, min: 5, max: 100 },
    resistanceNs2m8: { type: Number, default: 0 }, // live effective resistance, updated by the simulator
    pressureLossPa: { type: Number, default: 0 }, // live, updated by the simulator
    airflowM3min: { type: Number, default: 0 }, // live, updated by the simulator
  },
  { timestamps: true }
);

module.exports = { Regulator: mongoose.model('Regulator', regulatorSchema) };
