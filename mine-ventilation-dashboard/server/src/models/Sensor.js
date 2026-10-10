const mongoose = require('mongoose');

const LOCATION_TYPES = [
  'INTAKE',
  'LAST_VENTILATION_CONNECTION',
  'DISTRICT_RETURN_GENERAL_BODY',
  'MAIN_RETURN',
  'WORKING_PLACE',
  'FAN_DRIFT',
  'FAN_HOUSE',
  'ANY_PLACE',
];

const sensorSchema = new mongoose.Schema(
  {
    sensorId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    locationType: { type: String, enum: LOCATION_TYPES, required: true },
    branchId: { type: String, default: null },
    districtId: { type: String, default: null },
    type: { type: String, default: 'virtual' },
    status: { type: String, enum: ['ONLINE', 'STALE', 'OFFLINE'], default: 'ONLINE' },
    expectedIntervalSec: { type: Number, default: 3 },
    safetyCritical: { type: Boolean, default: true },
    parameters: { type: [String], default: [] },
    calibrationDate: { type: Date, default: null },
    origin: { type: String, default: 'simulated' },
    mapPosition: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    // Live cache of the most recent reading (kept in sync by the simulator).
    lastReading: { type: mongoose.Schema.Types.Mixed, default: null },
    lastSeenAt: { type: Date, default: null },
    // v2: device telemetry seed fields
    level: { type: String, enum: ['L-1', 'L-2', 'L-3', 'L-4'], default: 'L-1' },
    signalDbm: { type: Number, default: -65 },
    batteryPct: { type: Number, default: 100, min: 0, max: 100 },
    firmware: { type: String, default: 'v2.4.1' },
  },
  { timestamps: true }
);

module.exports = {
  Sensor: mongoose.model('Sensor', sensorSchema),
  LOCATION_TYPES,
};
