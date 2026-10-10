const mongoose = require('mongoose');

const fanSchema = new mongoose.Schema(
  {
    fanId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ['main', 'aux'], required: true },
    branchId: { type: String, default: null },
    level: { type: String, enum: ['L-1', 'L-2', 'L-3', 'L-4'], default: 'L-1' },
    status: { type: String, enum: ['RUNNING', 'STOPPED', 'FAULT'], default: 'STOPPED' },
    rpm: { type: Number, default: 0 }, // speed setpoint; effective rpm is 0 unless RUNNING
    ratedRpm: { type: Number, required: true },
    ratedPressurePa: { type: Number, default: 0 }, // fan total pressure at rated rpm (affinity: P ∝ rpm²)
    ratedAirflowM3min: { type: Number, default: 0 }, // duty airflow at rated rpm (affinity: Q ∝ rpm)
    powerKw: { type: Number, default: 0 },
    airflowM3min: { type: Number, default: 0 }, // live, updated by the simulator
    pressurePa: { type: Number, default: 0 }, // live, updated by the simulator
    efficiencyPct: { type: Number, default: 0 }, // live, updated by the simulator
    fault: { type: String, default: null }, // active fault id, if any
    runtimeHours: { type: Number, default: 0 },
    auto: { type: Boolean, default: true }, // auto-restart after power recovery
  },
  { timestamps: true }
);

module.exports = { Fan: mongoose.model('Fan', fanSchema) };
