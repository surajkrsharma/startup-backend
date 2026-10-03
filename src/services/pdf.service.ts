import PDFDocument from 'pdfkit';
import { PDF, PDF_DOC, PdfDocType } from '../config/pdf.config';
import { APP } from '../config/app.config';
import { D, money } from '../utils/defaults';
import { DAYJS_SETUP, formatDate, formatMoney } from '../utils/dates';

export type PdfRow = Record<string, any>;

const currencySymbol = (): string => D.str('₹');

interface DocMeta {
  title: string;
  number: string;
  status?: string;
  date?: string;
  from?: { label: string; lines: string[] };
  to?: { label: string; lines: string[] };
}

const drawHeader = (doc: PDFKit.PDFDocument, meta: DocMeta): number => {
  const left = PDF.MARGIN;
  const contentWidth = doc.page.width - PDF.MARGIN * 2;

  doc
    .fillColor(PDF.HEADER_COLOR)
    .fontSize(PDF.TITLE_SIZE)
    .font('Helvetica-Bold')
    .text(APP.NAME.toUpperCase(), left, PDF.MARGIN);

  doc
    .fontSize(PDF.HEADER_SIZE)
    .font('Helvetica-Bold')
    .text(meta.title, left, PDF.MARGIN + PDF.TITLE_SIZE + 6, {
      width: contentWidth,
      align: 'right',
    });

  let y = PDF.MARGIN + PDF.TITLE_SIZE + PDF.HEADER_SIZE + 14;

  doc.fontSize(PDF.FONT_SIZE).font('Helvetica').fillColor(PDF.TEXT_COLOR);
  doc.text(`Number: ${D.str(meta.number)}`, left, y);
  if (meta.date) doc.text(`Date: ${D.str(meta.date)}`, left, y + PDF.LINE_GAP * 3);
  if (meta.status) doc.text(`Status: ${D.str(meta.status)}`, left, y + PDF.LINE_GAP * 6);
  y += PDF.LINE_GAP * 9;

  if (meta.from || meta.to) {
    const colWidth = contentWidth / 2 - 10;
    if (meta.from) {
      doc.font('Helvetica-Bold').fillColor(PDF.HEADER_COLOR).text(meta.from.label, left, y);
      doc.font('Helvetica').fillColor(PDF.TEXT_COLOR);
      meta.from.lines.forEach((line, i) =>
        doc.text(D.str(line), left, y + PDF.LINE_GAP * 3 * (i + 1)),
      );
    }
    if (meta.to) {
      doc
        .font('Helvetica-Bold')
        .fillColor(PDF.HEADER_COLOR)
        .text(meta.to.label, left + colWidth + 20, y);
      doc.font('Helvetica').fillColor(PDF.TEXT_COLOR);
      meta.to.lines.forEach((line, i) =>
        doc.text(D.str(line), left + colWidth + 20, y + PDF.LINE_GAP * 3 * (i + 1)),
      );
    }
    y += PDF.LINE_GAP * 3 * Math.max(meta.from?.lines.length ?? 0, meta.to?.lines.length ?? 0) + 16;
  }

  doc
    .moveTo(left, y)
    .lineTo(left + contentWidth, y)
    .strokeColor(PDF.LINE_COLOR)
    .stroke();
  return y + 14;
};

const drawTable = (
  doc: PDFKit.PDFDocument,
  startY: number,
  columns: { key: string; label: string; width: number; align?: 'left' | 'right' | 'center' }[],
  rows: PdfRow[],
): number => {
  const left = PDF.MARGIN;
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const scale = (doc.page.width - PDF.MARGIN * 2) / totalWidth;
  const widths = columns.map((c) => c.width * scale);

  let y = startY;

  doc.rect(left, y, doc.page.width - PDF.MARGIN * 2, PDF.ROW_HEIGHT).fill(PDF.TABLE_HEADER_BG);
  let x = left;
  columns.forEach((col, i) => {
    doc
      .fillColor(PDF.HEADER_COLOR)
      .font('Helvetica-Bold')
      .fontSize(PDF.FONT_SIZE)
      .text(col.label, x + 4, y + 5, { width: widths[i] - 8, align: col.align ?? 'left' });
    x += widths[i];
  });
  y += PDF.ROW_HEIGHT;

  rows.forEach((row, rowIndex) => {
    if (y > doc.page.height - PDF.MARGIN - PDF.ROW_HEIGHT * 2) {
      doc.addPage();
      y = PDF.MARGIN;
    }
    if (rowIndex % 2 === 1) {
      doc.rect(left, y, doc.page.width - PDF.MARGIN * 2, PDF.ROW_HEIGHT).fill('#fafafa');
    }
    let cx = left;
    columns.forEach((col, i) => {
      doc
        .fillColor(PDF.TEXT_COLOR)
        .font('Helvetica')
        .fontSize(PDF.FONT_SIZE)
        .text(D.str(String(row[col.key] ?? '')), cx + 4, y + 5, {
          width: widths[i] - 8,
          align: col.align ?? 'left',
          ellipsis: true,
          lineBreak: false,
        });
      cx += widths[i];
    });
    doc
      .moveTo(left, y + PDF.ROW_HEIGHT)
      .lineTo(left + doc.page.width - PDF.MARGIN * 2, y + PDF.ROW_HEIGHT)
      .strokeColor(PDF.LINE_COLOR)
      .stroke();
    y += PDF.ROW_HEIGHT;
  });

  return y + 12;
};

const drawTotals = (
  doc: PDFKit.PDFDocument,
  y: number,
  lines: { label: string; value: string; bold?: boolean }[],
): number => {
  const left = PDF.MARGIN;
  const boxWidth = 220;
  const boxLeft = doc.page.width - PDF.MARGIN - boxWidth;

  let cursor = y;
  lines.forEach((line) => {
    doc
      .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(PDF.FONT_SIZE)
      .fillColor(line.bold ? PDF.HEADER_COLOR : PDF.TEXT_COLOR)
      .text(line.label, boxLeft, cursor + 4, { width: boxWidth / 2 - 8 });
    doc.text(line.value, boxLeft + boxWidth / 2, cursor + 4, {
      width: boxWidth / 2 - 8,
      align: 'right',
    });
    cursor += PDF.LINE_GAP * 3;
  });

  if (lines.length) {
    doc
      .moveTo(boxLeft, cursor)
      .lineTo(boxLeft + boxWidth, cursor)
      .strokeColor(PDF.LINE_COLOR)
      .stroke();
  }
  void left;
  return cursor + 10;
};

const finish = (doc: PDFKit.PDFDocument, meta: DocMeta): void => {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor(PDF.MUTED_COLOR)
      .font('Helvetica')
      .text(
        `${APP.NAME} — ${meta.title} ${D.str(meta.number)}`,
        PDF.MARGIN,
        doc.page.height - PDF.MARGIN,
        { width: doc.page.width - PDF.MARGIN * 2, align: 'center' },
      );
  }
};

const baseDoc = (): PDFKit.PDFDocument =>
  new PDFDocument({ size: PDF.PAGE_SIZE, margin: PDF.MARGIN, bufferPages: true });

const streamToBuffer = (doc: PDFKit.PDFDocument): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

const symbol = (): string => currencySymbol();

export const generateInvoicePdf = async (order: Record<string, any>): Promise<Buffer> => {
  DAYJS_SETUP();
  const doc = baseDoc();

  const y = drawHeader(doc, {
    title: PDF_DOC.INVOICE,
    number: D.str(order.orderNumber),
    status: D.str(order.status),
    date: formatDate(order.createdAt),
    from: {
      label: 'Sold by',
      lines: [
        D.str(order.vendor?.shopName || APP.NAME),
        D.str(order.vendor?.slug ? `/${order.vendor.slug}` : ''),
      ],
    },
    to: {
      label: 'Ship to',
      lines: [
        D.str(order.address?.fullName || order.user?.name),
        D.str(order.address?.line1),
        `${D.str(order.address?.city)} ${D.str(order.address?.pincode)}`,
        D.str(order.user?.phone || order.address?.phone),
      ],
    },
  });

  const itemColumns = [
    { key: 'name', label: 'Item', width: 180 },
    { key: 'sku', label: 'SKU', width: 70 },
    { key: 'price', label: 'Price', width: 55, align: 'right' as const },
    { key: 'qty', label: 'Qty', width: 25, align: 'right' as const },
    { key: 'total', label: 'Total', width: 60, align: 'right' as const },
  ];

  const items = Array.isArray(order.items) ? order.items : [];
  const tableEnd = drawTable(
    doc,
    y,
    itemColumns,
    items.map((item: any) => ({
      name: D.str(item.name),
      sku: D.str(item.sku),
      price: formatMoney(item.price),
      qty: D.num(item.qty),
      total: formatMoney(item.total),
    })),
  );

  drawTotals(doc, tableEnd, [
    { label: 'Subtotal', value: formatMoney(order.subtotal, symbol()) },
    { label: 'Discount', value: `- ${formatMoney(order.discount, symbol())}` },
    { label: 'Tax', value: formatMoney(order.taxAmount, symbol()) },
    { label: 'Shipping', value: formatMoney(order.shippingAmount, symbol()) },
    { label: 'Grand total', value: formatMoney(order.total, symbol()), bold: true },
  ]);

  finish(doc, { title: PDF_DOC.INVOICE, number: D.str(order.orderNumber) });
  return streamToBuffer(doc);
};

export const generatePackingSlipPdf = async (subOrder: Record<string, any>): Promise<Buffer> => {
  DAYJS_SETUP();
  const doc = baseDoc();

  const y = drawHeader(doc, {
    title: PDF_DOC.PACKING_SLIP,
    number: D.str(subOrder.orderNumber || subOrder.id),
    status: D.str(subOrder.status),
    date: formatDate(subOrder.createdAt),
    from: { label: 'Packed by', lines: [D.str(subOrder.vendor?.shopName)] },
    to: {
      label: 'Deliver to',
      lines: [
        D.str(subOrder.address?.fullName),
        D.str(subOrder.address?.line1),
        `${D.str(subOrder.address?.city)} ${D.str(subOrder.address?.pincode)}`,
        D.str(subOrder.address?.phone),
      ],
    },
  });

  drawTable(
    doc,
    y,
    [
      { key: 'name', label: 'Item', width: 200 },
      { key: 'sku', label: 'SKU', width: 80 },
      { key: 'qty', label: 'Qty', width: 30, align: 'right' as const },
    ],
    (Array.isArray(subOrder.items) ? subOrder.items : []).map((item: any) => ({
      name: D.str(item.name),
      sku: D.str(item.sku),
      qty: D.num(item.qty),
    })),
  );

  finish(doc, { title: PDF_DOC.PACKING_SLIP, number: D.str(subOrder.id) });
  return streamToBuffer(doc);
};

export const generatePayoutStatementPdf = async (
  vendor: Record<string, any>,
  rows: PdfRow[],
  totals: { gross: number; commission: number; net: number },
): Promise<Buffer> => {
  DAYJS_SETUP();
  const doc = baseDoc();

  const y = drawHeader(doc, {
    title: PDF_DOC.PAYOUT_STATEMENT,
    number: D.str(vendor.slug || vendor.id),
    date: formatDate(new Date()),
    from: { label: 'Vendor', lines: [D.str(vendor.shopName), D.str(vendor.gstNumber)] },
    to: { label: 'Payout account', lines: [D.str(vendor.bankHolderName), D.str(vendor.bankIfsc)] },
  });

  const tableEnd = drawTable(
    doc,
    y,
    [
      { key: 'period', label: 'Period', width: 90 },
      { key: 'orders', label: 'Orders', width: 40, align: 'right' as const },
      { key: 'gross', label: 'Gross', width: 70, align: 'right' as const },
      { key: 'commission', label: 'Commission', width: 70, align: 'right' as const },
      { key: 'net', label: 'Net', width: 70, align: 'right' as const },
    ],
    rows,
  );

  drawTotals(doc, tableEnd, [
    { label: 'Gross earnings', value: formatMoney(totals.gross, symbol()) },
    { label: 'Commission', value: `- ${formatMoney(totals.commission, symbol())}` },
    { label: 'Net payable', value: formatMoney(totals.net, symbol()), bold: true },
  ]);

  finish(doc, { title: PDF_DOC.PAYOUT_STATEMENT, number: D.str(vendor.id) });
  return streamToBuffer(doc);
};

export const generateShippingLabelPdf = async (shipment: Record<string, any>): Promise<Buffer> => {
  DAYJS_SETUP();
  const doc = baseDoc();

  const y = drawHeader(doc, {
    title: PDF_DOC.SHIPPING_LABEL,
    number: D.str(shipment.awb || shipment.id),
    status: D.str(shipment.status),
    date: formatDate(shipment.createdAt),
    from: {
      label: 'Ship from',
      lines: [
        D.str(shipment.vendor?.shopName),
        D.str(shipment.pickupAddress?.city),
        D.str(shipment.pickupAddress?.pincode),
      ],
    },
    to: {
      label: 'Ship to',
      lines: [
        D.str(shipment.deliveryAddress?.fullName),
        D.str(shipment.deliveryAddress?.line1),
        `${D.str(shipment.deliveryAddress?.city)} ${D.str(shipment.deliveryAddress?.pincode)}`,
        D.str(shipment.deliveryAddress?.phone),
      ],
    },
  });

  drawTable(
    doc,
    y + 10,
    [
      { key: 'awb', label: 'AWB', width: 140 },
      { key: 'partner', label: 'Partner', width: 90 },
      { key: 'weight', label: 'Weight', width: 60, align: 'right' as const },
      { key: 'charges', label: 'Charges', width: 60, align: 'right' as const },
    ],
    [
      {
        awb: D.str(shipment.awb),
        partner: D.str(shipment.partner?.name || 'manual'),
        weight: `${D.float(shipment.weight)} kg`,
        charges: formatMoney(shipment.charge, symbol()),
      },
    ],
  );

  finish(doc, { title: PDF_DOC.SHIPPING_LABEL, number: D.str(shipment.awb) });
  return streamToBuffer(doc);
};

export const generatePdf = async (type: PdfDocType, payload: any): Promise<Buffer> => {
  switch (type) {
    case 'PACKING_SLIP':
      return generatePackingSlipPdf(payload);
    case 'PAYOUT_STATEMENT':
      return generatePayoutStatementPdf(
        payload.vendor,
        payload.rows ?? [],
        payload.totals ?? { gross: 0, commission: 0, net: 0 },
      );
    case 'SHIPPING_LABEL':
      return generateShippingLabelPdf(payload);
    case 'INVOICE':
    default:
      return generateInvoicePdf(payload);
  }
};

export const pdfFileName = (type: PdfDocType, reference: string): string => {
  const stamp = formatDate(new Date(), 'YYYYMMDD_HHmm');
  return `${D.str(type).toLowerCase()}-${D.str(reference).replace(/[^a-zA-Z0-9-_]/g, '')}-${stamp}.pdf`;
};

export { money };
