const mongoose = require('mongoose');

const doorSchema = new mongoose.Schema(
  {
    doorId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    branchId: { type: String, default: null },
    level: { type: String, enum: ['L-1', 'L-2', 'L-3', 'L-4'], default: 'L-1' },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    positionPct: { type: Number, default: 100, min: 0, max: 100 },
    pressureDiffPa: { type: Number, default: 0 }, // live, updated by the simulator
    airflowImpactPct: { type: Number, default: 0 }, // live: flow change vs seeded-default flow
  },
  { timestamps: true }
);

module.exports = { VentilationDoor: mongoose.model('VentilationDoor', doorSchema) };
