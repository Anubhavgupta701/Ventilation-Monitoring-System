const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema(
  { label: String, x: Number, y: Number },
  { _id: false }
);

const stoppingSchema = new mongoose.Schema(
  { label: String, atPct: Number },
  { _id: false }
);

const branchSchema = new mongoose.Schema(
  {
    branchId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    fromNode: { type: nodeSchema, required: true },
    toNode: { type: nodeSchema, required: true },
    area: { type: Number, required: true }, // m²
    direction: { type: String, enum: ['INTAKE', 'RETURN'], required: true },
    path: { type: [{ x: Number, y: Number, _id: false }], default: [] },
    isLastVentilationConnection: { type: Boolean, default: false },
    districtId: { type: String, default: null },
    // v2: mine level + physics + stoppings
    level: { type: String, enum: ['L-1', 'L-2', 'L-3', 'L-4'], default: 'L-1' },
    resistanceNs2m8: { type: Number, default: 0.05 }, // base airway resistance R (ΔP = R·Q², Q in m³/s)
    lengthM: { type: Number, default: 0 },
    stoppings: { type: [stoppingSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = { Branch: mongoose.model('Branch', branchSchema) };
