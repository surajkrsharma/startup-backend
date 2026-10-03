export const PDF = {
  PAGE_SIZE: 'A4' as const,
  MARGIN: 40,
  FONT_SIZE: 10,
  TITLE_SIZE: 16,
  HEADER_SIZE: 12,
  HEADER_COLOR: '#111827',
  TEXT_COLOR: '#1f2937',
  MUTED_COLOR: '#6b7280',
  LINE_COLOR: '#e5e7eb',
  TABLE_HEADER_BG: '#f3f4f6',
  LOGO_PATH: 'assets/logo.png',
  LINE_GAP: 4,
  ROW_HEIGHT: 18,
};

export const PDF_DOC = {
  INVOICE: 'INVOICE',
  PACKING_SLIP: 'PACKING SLIP',
  PAYOUT_STATEMENT: 'PAYOUT STATEMENT',
  SHIPPING_LABEL: 'SHIPPING LABEL',
} as const;

export type PdfDocType = keyof typeof PDF_DOC;
