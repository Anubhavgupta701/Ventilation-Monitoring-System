// Socket.IO /realtime namespace — server → client only.
let ns = null;

function init(io) {
  ns = io.of('/realtime');
}

function emit(event, payload) {
  if (!ns) return;
  ns.emit(event, payload);
}

module.exports = { init, emit };
