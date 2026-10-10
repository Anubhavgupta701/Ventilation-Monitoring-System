// Minimal pdfkit report builder: title page header, section headings,
// simple tables, key/value lists. Returns a Buffer.
const PDFDocument = require('pdfkit');

const MARGIN = 48;
const SAFETY_NOTICE =
  'Simulated/demo data — academic prototype, not a certified mine-safety system. Verify statutory requirements before operational use.';

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v);
}

function buildPdf({ title, mineName, generatedAt, period, sections }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(title, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#444444')
      .text(`Mine: ${mineName}`);
    doc.text(`Generated: ${generatedAt}`);
    if (period) doc.text(`Period: ${period}`);
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor('#8a6d1a')
      .text(`Safety notice: ${SAFETY_NOTICE}`, { align: 'left' });
    doc.fillColor('#000000');
    doc.moveDown(0.8);

    const table = (columns, rows) => {
      const widths = columns.map((c) => c.width || 90);
      const totalW = widths.reduce((a, b) => a + b, 0);
      const startX = MARGIN;
      const rowH = 16;
      const need = rowH * (rows.length + 2);
      if (doc.y + need > doc.page.height - MARGIN) doc.addPage();

      // Header row
      doc.font('Helvetica-Bold').fontSize(9);
      let x = startX;
      columns.forEach((c, i) => {
        doc.text(c.label, x, doc.y, { width: widths[i], continued: false });
        x += widths[i];
      });
      doc.moveDown(0.2);
      const y0 = doc.y;
      doc.moveTo(startX, y0).lineTo(startX + totalW, y0).stroke();

      // Data rows
      doc.font('Helvetica').fontSize(8.5);
      rows.forEach((row, ri) => {
        if (doc.y + rowH > doc.page.height - MARGIN) {
          doc.addPage();
          doc.font('Helvetica').fontSize(8.5);
        }
        let cx = startX;
        const ry = doc.y + 2;
        columns.forEach((c, i) => {
          doc.text(fmt(row[c.key]), cx, ry, { width: widths[i] });
          cx += widths[i];
        });
        doc.y = ry + rowH - 2;
        if (ri % 2 === 1) {
          doc.rect(startX, ry - 2, totalW, rowH).fillOpacity(0.04).fill('#000000').fillOpacity(1);
        }
      });
      doc.moveDown(0.6);
    };

    for (const sec of sections || []) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a1a1a').text(sec.heading);
      doc.moveDown(0.25);
      if (sec.text) {
        doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(sec.text);
        doc.moveDown(0.4);
      }
      if (sec.kv) {
        doc.fontSize(9.5).font('Helvetica');
        for (const [k, v] of sec.kv) {
          doc.fillColor('#555555').text(`${k}: `, { continued: true });
          doc.fillColor('#000000').text(fmt(v));
        }
        doc.moveDown(0.4);
      }
      if (sec.columns && sec.rows) table(sec.columns, sec.rows);
      doc.moveDown(0.4);
    }

    // Footer with page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#888888')
        .text(`Page ${i + 1} of ${range.count} — ${mineName}`, MARGIN, doc.page.height - 32, { align: 'center' });
    }

    doc.end();
  });
}

module.exports = { buildPdf, SAFETY_NOTICE, fmt };
