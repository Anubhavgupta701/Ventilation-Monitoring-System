const { AuditLog } = require('../models/AuditLog');

async function audit(req, action, entityType, entityId, before, after) {
  try {
    await AuditLog.create({
      ts: new Date(),
      actor: req.user ? req.user.username : 'system',
      action,
      entityType,
      entityId: String(entityId),
      before: before == null ? null : before,
      after: after == null ? null : after,
      requestId: req.requestId || '',
    });
  } catch (e) {
    // Audit failures must never break the primary operation.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit log:', e.message);
  }
}

module.exports = { audit };
