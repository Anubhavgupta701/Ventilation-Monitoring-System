const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    actor: { type: String, required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    requestId: { type: String, default: '' },
  },
  { timestamps: false }
);

auditLogSchema.index({ entityType: 1, entityId: 1 });

module.exports = { AuditLog: mongoose.model('AuditLog', auditLogSchema) };
