// Minimal CSV builder — `sep=,` first line is an Excel hint.
function esc(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv({ columns, rows, generatedAt, safetyNotice, title }) {
  const lines = ['sep=,'];
  if (title) lines.push(`# ${title}`);
  lines.push(`# generatedAt: ${generatedAt}`);
  if (safetyNotice) lines.push(`# Safety notice: ${safetyNotice}`);
  lines.push(columns.map(esc).join(','));
  for (const row of rows) lines.push(row.map(esc).join(','));
  return lines.join('\r\n');
}

const SAFETY_NOTICE =
  'Simulated/demo data — academic prototype, not a certified mine-safety system. Verify statutory requirements before operational use.';

module.exports = { buildCsv, esc, SAFETY_NOTICE };
