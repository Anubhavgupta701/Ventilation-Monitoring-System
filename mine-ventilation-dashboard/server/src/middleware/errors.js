const crypto = require('crypto');

// Attaches a requestId to every request/response; all error responses use
// the envelope { code, message, details, requestId }.
function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

function httpError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details || {};
  return err;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Mongoose validation / cast errors → 400.
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let details = err.details || {};
  if (err.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = { fields: err.errors ? Object.keys(err.errors) : [] };
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = { path: err.path };
  } else if (err.code === 11000) {
    status = 409;
    code = 'CONFLICT';
    details = { keyValue: err.keyValue };
  }
  if (status === 500) {
    // eslint-disable-next-line no-console
    console.error(`[${req.requestId || '-'}]`, err);
  }
  res.status(status).json({
    code,
    message: status === 500 ? 'Internal server error' : err.message || 'Error',
    details,
    requestId: req.requestId || crypto.randomUUID(),
  });
}

function notFound(req, res) {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `No route ${req.method} ${req.path}`,
    details: {},
    requestId: req.requestId || crypto.randomUUID(),
  });
}

module.exports = { requestId, httpError, errorHandler, notFound };
