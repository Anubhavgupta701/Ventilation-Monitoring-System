const mongoose = require('mongoose');

const districtSchema = new mongoose.Schema(
  {
    districtId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    personsLargestShift: { type: Number, required: true },
    dailyOutputTonnes: { type: Number, required: true },
    lastConnectionBranchId: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = { District: mongoose.model('District', districtSchema) };
