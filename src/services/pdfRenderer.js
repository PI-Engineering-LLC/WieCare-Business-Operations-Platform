const PDFDocument = require('pdfkit');

const ENTITIES = { WiegandSports: 'Wiegand Sports Gmbh', WiegandServices: `Wiegand Services LLC` }; //TODO: fill

exports.renderInvoicePDF = (invoice, res) => {
  const entity = ENTITIES[invoice.sending_entity] ?? ENTITIES.WiegandSports;
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename=invoice-${invoice.invoice_number}.pdf`
  );
  doc.pipe(res);
  // ... letterhead + line items
  doc.text('Invoice #123');
  doc.text('Customer: John Smith');
  doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', 50, 50);

  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Invoice #: ${invoice.invoice_number}`, 400, 55)
    .text(`Issue Date: ${invoice.issue_date}`, 400, 70)
    .text(`Due Date: ${invoice.due_date}`, 400, 85);

  doc.moveDown(2);
  doc
    .fontSize(12)
    .font('Helvetica-Bold')
    .text('From', 50, 130);

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(invoice.sending_entity, 50, 145);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Bill To', 300, 130);

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(invoice.client_name, 300, 145);

  doc.moveTo(50, 180)
    .lineTo(550, 180)
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('PO / Order Number:', 50, 195);

  doc
    .font('Helvetica')
    .text(invoice.po_number, 170, 195);

  doc
    .font('Helvetica-Bold')
    .text('Status:', 350, 195);

  doc
    .font('Helvetica')
    .text(invoice.status, 400, 195);

  // LINE ITEMS TABLE
  // ====================================================

  let y = 235;

  const cols = {
    item: 50,
    product: 90,
    desc: 170,
    qty: 370,
    unit: 420,
    total: 500
  };

  doc
    .rect(50, y - 5, 500, 20)
    .fill('#f0f0f0');

  doc.fillColor('black');

  doc.font('Helvetica-Bold').fontSize(9);

  doc.text('Item #', cols.item, y);
  doc.text('EZ #', cols.product, y);
  doc.text('Description', cols.desc, y);
  doc.text('Qty', cols.qty, y);
  doc.text('Unit Price', cols.unit, y);
  doc.text('Amount', cols.total, y);

  y += 25;

  doc.font('Helvetica');

  invoice.items.forEach(item => {
    doc.text(item.item_number, cols.item, y);
    doc.text(item.ez_number, cols.product, y);
    doc.text(item.description, cols.desc, y, {
      width: 180
    });
    doc.text(item.quantity.toString(), cols.qty, y);
    doc.text(`$${item.unit_price.toFixed(2)}`, cols.unit, y);
    doc.text(`$${(item.amount || item.total)?.toFixed(2)}`, cols.total, y);

    y += 22;
  });
  y += 20;

  doc.moveTo(330, y)
    .lineTo(550, y)
    .stroke();

  y += 10;

  const moneyLine = (label, value) => {
    doc.font('Helvetica').text(label, 350, y);
    doc.text(`$${value.toFixed(2)}`, 480, y, {
      width: 70,
      align: 'right'
    });
    y += 18;
  };

  moneyLine('Subtotal', invoice.subtotal);
  moneyLine('Credit', invoice.credit);
  moneyLine('Sales Tax', invoice.sales_tax);
  moneyLine('Packing', invoice.packing);
  moneyLine('Export Declaration', invoice.export_declaration);
  moneyLine('Customs Fees', invoice.customs_fees);
  moneyLine('Freight', invoice.freight);

  doc.moveTo(350, y)
    .lineTo(550, y)
    .stroke();

  y += 10;

  doc.font('Helvetica-Bold');
  moneyLine('Total Amount', invoice.total_amount);

  doc.font('Helvetica');
  moneyLine('Amount Paid', invoice.amount_paid);

  doc.font('Helvetica-Bold');
  moneyLine('Balance Due', invoice.balance_due);

  y += 25;

  doc.font('Helvetica-Bold')
    .text('Notes', 50, y);

  y += 18;

  doc.font('Helvetica')
    .text(invoice.notes || '', 50, y, {
      width: 500
    });

  doc.fontSize(9)
    .fillColor('gray')
    .text(
      'Thank you for your business.',
      50,
      730,
      { align: 'center' }
    );

  doc.end();
};


// -----------------------------
// Currency helper (USD only)
// -----------------------------
const formatUSD = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(value);

// -----------------------------
// Main generator
// -----------------------------
function generateInvoice(invoice, res) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 50
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename=invoice-${invoice.invoiceNumber}.pdf`
  );

  doc.pipe(res);

  // ====================================================
  // BRANDING / HEADER
  // ====================================================

  const brandColor = '#1f3c88';

  if (invoice.logoPath) {
    doc.image(invoice.logoPath, 50, 40, { width: 80 });
  }

  doc
    .fillColor(brandColor)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('YOUR COMPANY NAME', 140, 45);

  doc
    .fontSize(10)
    .fillColor('gray')
    .text(invoice.sending_entity, 140, 70);

  doc
    .fillColor('black')
    .fontSize(10)
    .text(`Invoice #: ${invoice.invoiceNumber}`, 400, 50)
    .text(`Issue: ${invoice.issueDate}`, 400, 65)
    .text(`Due: ${invoice.dueDate}`, 400, 80);

  doc.moveTo(50, 110).lineTo(550, 110).stroke();

  // ====================================================
  // BILLING / SHIPPING
  // ====================================================

  const client = invoice.client;

  doc.font('Helvetica-Bold').fontSize(11).text('Bill To', 50, 125);
  doc.font('Helvetica').fontSize(10).text(
    `${client.name}\n${client.street}\n${client.city}, ${client.country}`,
    50,
    140
  );

  doc.font('Helvetica-Bold').text('Ship To', 300, 125);
  doc.font('Helvetica').text(
    `${client.shippingName || client.name}\n${client.shippingStreet || client.street}\n${client.shippingCity || client.city}, ${client.shippingCountry || client.country}`,
    300,
    140
  );

  doc.moveTo(50, 190).lineTo(550, 190).stroke();

  // ====================================================
  // ORDER INFO
  // ====================================================

  doc
    .font('Helvetica-Bold')
    .text(`PO / Order #:`, 50, 205)
    .font('Helvetica')
    .text(invoice.poNumber, 150, 205);

  doc
    .font('Helvetica-Bold')
    .text(`Status:`, 350, 205)
    .font('Helvetica')
    .text(invoice.status, 410, 205);

  // ====================================================
  // TABLE HEADER
  // ====================================================

  let y = 240;

  const col = {
    line: 50,
    item: 80,
    product: 130,
    desc: 210,
    qty: 380,
    unit: 430,
    total: 490
  };

  const rowHeight = 22;

  const drawHeader = () => {
    doc
      .fillColor('#f2f2f2')
      .rect(50, y - 5, 500, rowHeight)
      .fill();

    doc.fillColor('black').font('Helvetica-Bold').fontSize(9);

    doc.text('#', col.line, y);
    doc.text('Item', col.item, y);
    doc.text('Product', col.product, y);
    doc.text('Description', col.desc, y);
    doc.text('Qty', col.qty, y);
    doc.text('Unit', col.unit, y);
    doc.text('Total', col.total, y);

    y += rowHeight;
  };

  drawHeader();

  // ====================================================
  // PAGE BREAK HANDLER
  // ====================================================

  const checkPageBreak = () => {
    if (y > 700) {
      addFooter();
      doc.addPage();
      y = 50;
      drawHeader();
    }
  };

  // ====================================================
  // TABLE ROWS
  // ====================================================

  doc.font('Helvetica').fontSize(9);

  invoice.lineItems.forEach((item, index) => {
    checkPageBreak();

    const isEven = index % 2 === 0;

    if (isEven) {
      doc
        .fillColor('#fafafa')
        .rect(50, y - 4, 500, rowHeight)
        .fill();
    }

    doc.fillColor('black');

    doc.text(item.itemNo, col.line, y);
    doc.text(item.prodNumber, col.product, y);
    doc.text(item.description, col.desc, y, { width: 160 });
    doc.text(item.qty, col.qty, y);
    doc.text(formatUSD(item.unitPrice), col.unit, y);
    doc.text(formatUSD(item.total), col.total, y);

    // Column borders
    doc
      .strokeColor('#dddddd')
      .moveTo(50, y + 15)
      .lineTo(550, y + 15)
      .stroke();

    y += rowHeight;
  });

  // ====================================================
  // TOTALS
  // ====================================================

  y += 10;
  doc.strokeColor('#000').moveTo(350, y).lineTo(550, y).stroke();
  y += 10;

  const line = (label, value) => {
    doc.font('Helvetica').text(label, 360, y);
    doc.text(formatUSD(value), 470, y, { align: 'right' });
    y += 16;
  };

  line('Subtotal', invoice.subtotal);

  if (invoice.showCredit && invoice.credit) {
    line('Credit', invoice.credit);
  }

  line('Sales Tax', invoice.salesTax);
  line('Packing', invoice.packing);
  line('Export Decl', invoice.exportDecl);
  line('Customs Fees', invoice.customsFees);
  line('Freight', invoice.freight);

  doc.font('Helvetica-Bold');
  line('Total Amount', invoice.totalAmt);

  doc.font('Helvetica');
  line('Amount Paid', invoice.amtPaid);

  doc.font('Helvetica-Bold');
  line('Balance Due', invoice.balanceDue);

  // ====================================================
  // NOTES + PAYMENT INFO
  // ====================================================

  y += 20;

  doc.font('Helvetica-Bold').text('Notes & Payment Instructions', 50, y);
  y += 15;

  doc.font('Helvetica').fontSize(9).text(invoice.notes || '', {
    width: 500
  });

  y += 10;

  doc.font('Helvetica-Bold').text('Bank Transfer Details:', 50, y);
  y += 12;

  doc.font('Helvetica').text(
    `Bank: ${invoice.payment.bank}\nACH: ${invoice.payment.ach}\nWire: ${invoice.payment.wire}`,
    50,
    y
  );

  // ====================================================
  // FOOTER WITH PAGE NUMBERS
  // ====================================================

  function addFooter() {
    const pageNumber = doc.bufferedPageRange().count;

    doc.fontSize(8)
      .fillColor('gray')
      .text(
        `Page ${pageNumber}`,
        0,
        740,
        { align: 'center', width: 612 }
      );
  }

  doc.on('pageAdded', addFooter);

  addFooter();
  doc.end();
}

