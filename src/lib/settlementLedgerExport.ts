import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DateFilterState } from './dateFilter';
import { formatLedgerTransactionTypeLabel } from './ledgerAuditPersistence';

export type SettlementExportTab = 'ledger' | 'collections' | 'commissions' | 'unified';

export interface SettlementExportSummary {
  totalCollections: number;
  totalCashHandedOver: number;
  totalAdvanceTaken: number;
  totalCommissions: number;
  netCashInHand: number;
}

export interface SettlementExportRow {
  timestamp: string;
  transactionType: string;
  amount: number;
  receivedByOrParty: string;
  auditNotes: string;
}

export interface SettlementExportPayload {
  companyName: string;
  supportHelpline?: string;
  tab: SettlementExportTab;
  tabTitle: string;
  agentName: string;
  agentUsername?: string;
  agentPhone?: string;
  agentArea?: string;
  dateFilter: DateFilterState;
  generatedAt?: Date;
  summary: SettlementExportSummary;
  rows: SettlementExportRow[];
}

export function formatLongPeriodLabel(filter: DateFilterState): string {
  if (filter.mode === 'all') return 'All Time';
  if (filter.mode === 'month') {
    if (!/^\d{4}-\d{2}$/.test(filter.month || '')) return 'Selected Month';
    const [y, m] = filter.month.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const s = filter.startDate || 'Start';
  const e = filter.endDate || 'Present';
  return `${s} to ${e}`;
}

export function formatPeriodFilenameSlug(filter: DateFilterState): string {
  const raw = formatLongPeriodLabel(filter);
  return raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function buildSettlementExportFilename(
  filter: DateFilterState,
  ext: 'xlsx' | 'pdf',
  companyName?: string
): string {
  const brandSlug = String(companyName || 'YouthNet')
    .replace(/service/i, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .trim() || 'YouthNet';
  const periodSlug = formatPeriodFilenameSlug(filter) || 'All_Time';
  return `${brandSlug}_Settlement_Ledger_${periodSlug}.${ext}`;
}

export function buildSettlementReportTitle(
  tab: SettlementExportTab,
  dateFilter: DateFilterState
): string {
  const periodLabel = formatLongPeriodLabel(dateFilter);
  if (tab === 'collections') {
    return `Agent Client Collections Breakdown — ${periodLabel}`;
  }
  if (tab === 'commissions') {
    return `Agent Commissions Statement — ${periodLabel}`;
  }
  return `Agent Settlement & Audit Ledger — ${periodLabel}`;
}

/**
 * Neutralizes spreadsheet formula injection (leading =, +, -, @, tab, CR) on text cells.
 */
export function sanitizeSpreadsheetCell(value: unknown): string | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function formatPkr(amount: number): string {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return `Rs. ${Math.round(safe).toLocaleString('en-US')}`;
}

function formatRowTimestamp(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generates and triggers a clean `.xlsx` workbook download via SheetJS.
 */
export function exportSettlementLedgerToExcel(payload: SettlementExportPayload): string {
  const companyName = (payload.companyName || 'Youth Net Service').trim();
  const periodLabel = formatLongPeriodLabel(payload.dateFilter);
  const reportTitle = buildSettlementReportTitle(payload.tab, payload.dateFilter);
  const generatedAt = payload.generatedAt || new Date();
  const generatedStr = generatedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const agentDisplay = payload.agentUsername
    ? `${payload.agentName} (@${payload.agentUsername})`
    : payload.agentName;

  const rowsSum = payload.rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const sheetData: Array<Array<string | number>> = [
    [sanitizeSpreadsheetCell(companyName)],
    [sanitizeSpreadsheetCell(reportTitle)],
    [
      'Agent Name',
      sanitizeSpreadsheetCell(agentDisplay),
      '',
      'Period',
      sanitizeSpreadsheetCell(periodLabel),
    ],
    [
      'Report View',
      sanitizeSpreadsheetCell(payload.tabTitle),
      '',
      'Generated Timestamp',
      sanitizeSpreadsheetCell(generatedStr),
    ],
    [],
    ['SUMMARY METRIC', 'AMOUNT (Rs.)'],
    ['Total Client Collections (Rs.)', sanitizeSpreadsheetCell(payload.summary.totalCollections)],
    ['Total Cash Handed Over (Rs.)', sanitizeSpreadsheetCell(payload.summary.totalCashHandedOver)],
    ['Total Advance Taken (Rs.)', sanitizeSpreadsheetCell(payload.summary.totalAdvanceTaken)],
    ['Total Commissions (Rs.)', sanitizeSpreadsheetCell(payload.summary.totalCommissions)],
    ['Net Cash-in-Hand Balance (Rs.)', sanitizeSpreadsheetCell(payload.summary.netCashInHand)],
    [],
    [
      'Timestamp',
      'Transaction Type',
      'Amount (Rs.)',
      'Handed Over To / Received By',
      'Audit Notes',
    ],
  ];

  if (payload.rows.length === 0) {
    sheetData.push(['—', 'No transactions recorded for selected period', 0, '—', '—']);
  } else {
    for (const row of payload.rows) {
      sheetData.push([
        sanitizeSpreadsheetCell(formatRowTimestamp(row.timestamp)),
        sanitizeSpreadsheetCell(formatLedgerTransactionTypeLabel(row.transactionType)),
        sanitizeSpreadsheetCell(Number(row.amount) || 0),
        sanitizeSpreadsheetCell(row.receivedByOrParty || 'Admin'),
        sanitizeSpreadsheetCell(row.auditNotes || '—'),
      ]);
    }
  }

  sheetData.push([
    'TOTAL',
    `${payload.rows.length} ${payload.rows.length === 1 ? 'entry' : 'entries'}`,
    sanitizeSpreadsheetCell(rowsSum),
    '',
    '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 26 },
    { wch: 18 },
    { wch: 30 },
    { wch: 50 },
  ];

  const wb = XLSX.utils.book_new();
  const sheetName =
    payload.tab === 'collections'
      ? 'Client Collections'
      : payload.tab === 'commissions'
      ? 'Commissions'
      : 'Settlement Ledger';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const filename = buildSettlementExportFilename(payload.dateFilter, 'xlsx', companyName);
  XLSX.writeFile(wb, filename);
  return filename;
}

/**
 * Generates and downloads a crisp, white-background A4 branded PDF audit statement
 * with Company Header, Summary Totals, itemized transactions, and physical verification
 * signature lines (Agent Signature + Cashier / Admin Signature).
 */
export function exportSettlementLedgerToPdf(payload: SettlementExportPayload): string {
  const companyName = (payload.companyName || 'Youth Net Service').trim();
  const periodLabel = formatLongPeriodLabel(payload.dateFilter);
  const reportTitle = buildSettlementReportTitle(payload.tab, payload.dateFilter);
  const generatedAt = payload.generatedAt || new Date();
  const generatedStr = generatedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const agentDisplay = payload.agentUsername
    ? `${payload.agentName} (@${payload.agentUsername})`
    : payload.agentName;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  // Top brand accent strip
  doc.setFillColor(15, 23, 42); // Slate-900 header bar
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setFillColor(6, 182, 212); // Cyan-500 hairline accent
  doc.rect(0, 24, pageWidth, 1.2, 'F');

  // Company Branding (White on Slate-900)
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(companyName.toUpperCase(), marginX, 11.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const subHeader = payload.supportHelpline
    ? `ISP Field Operations & Cash Settlement Audit Statement  |  Helpline: ${payload.supportHelpline}`
    : 'ISP Field Operations & Cash Settlement Audit Statement';
  doc.text(subHeader, marginX, 18);

  // Right-aligned statement label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(34, 211, 238);
  doc.text('OFFICIAL AUDIT LEDGER', pageWidth - marginX, 11.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Generated: ${generatedStr}`, pageWidth - marginX, 18, { align: 'right' });

  // Report Title Section (White background)
  let cursorY = 33;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(reportTitle, marginX, cursorY);

  cursorY += 5;
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, cursorY, contentWidth, 17, 2, 2, 'FD');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Field Agent:', marginX + 3, cursorY + 6);
  doc.text('Report Section:', marginX + 3, cursorY + 12.5);
  doc.text('Period:', marginX + contentWidth / 2 + 4, cursorY + 6);
  doc.text('Area / Contact:', marginX + contentWidth / 2 + 4, cursorY + 12.5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(agentDisplay, marginX + 28, cursorY + 6);
  doc.text(payload.tabTitle, marginX + 28, cursorY + 12.5);
  doc.text(periodLabel, marginX + contentWidth / 2 + 28, cursorY + 6);
  const contactText = [payload.agentArea, payload.agentPhone].filter(Boolean).join(' · ') || 'All Sectors';
  doc.text(contactText, marginX + contentWidth / 2 + 28, cursorY + 12.5);

  // Summary Totals Table (5 metrics)
  cursorY += 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('FINANCIAL SETTLEMENT SUMMARY', marginX, cursorY);

  autoTable(doc, {
    startY: cursorY + 2.5,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    head: [
      [
        'Total Collections',
        'Cash Handed Over',
        'Advance Taken',
        'Total Commissions',
        'Net Cash-in-Hand',
      ],
    ],
    body: [
      [
        formatPkr(payload.summary.totalCollections),
        formatPkr(payload.summary.totalCashHandedOver),
        formatPkr(payload.summary.totalAdvanceTaken),
        formatPkr(payload.summary.totalCommissions),
        formatPkr(payload.summary.netCashInHand),
      ],
    ],
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      cellPadding: 2.8,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 9.5,
      halign: 'center',
      cellPadding: 3.5,
    },
    columnStyles: {
      4: {
        fillColor: [236, 253, 245],
        textColor: [6, 95, 70],
      },
    },
    styles: {
      lineColor: [203, 213, 225],
      lineWidth: 0.25,
    },
  });

  const afterSummaryY = (doc as any).lastAutoTable?.finalY || cursorY + 22;

  // Itemized Ledger Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `ITEMIZED TRANSACTIONS (${payload.rows.length} ${payload.rows.length === 1 ? 'RECORD' : 'RECORDS'})`,
    marginX,
    afterSummaryY + 8
  );

  const rowsSum = payload.rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const tableBody =
    payload.rows.length === 0
      ? [['—', 'No transactions recorded for selected period', formatPkr(0), '—', '—']]
      : payload.rows.map((row) => [
          formatRowTimestamp(row.timestamp),
          formatLedgerTransactionTypeLabel(row.transactionType),
          formatPkr(row.amount),
          row.receivedByOrParty || 'Admin',
          row.auditNotes || '—',
        ]);

  autoTable(doc, {
    startY: afterSummaryY + 10.5,
    margin: { left: marginX, right: marginX, bottom: 26 },
    theme: 'striped',
    head: [
      ['Timestamp', 'Transaction Type', 'Amount (Rs.)', 'Handed Over To / Received By', 'Audit Notes'],
    ],
    body: tableBody,
    foot: [['TOTAL', `${payload.rows.length} entries`, formatPkr(rowsSum), '', '']],
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 2.8,
    },
    bodyStyles: {
      textColor: [30, 41, 59],
      fontSize: 8,
      cellPadding: 2.6,
      valign: 'top',
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 2.8,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 30, fontStyle: 'bold' },
      2: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
      3: { cellWidth: 36 },
      4: { cellWidth: 'auto' },
    },
    styles: {
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
  });

  // Physical Cash Handover Verification Signature Block
  let sigY = ((doc as any).lastAutoTable?.finalY || afterSummaryY + 40) + 18;
  if (sigY + 32 > pageHeight - 14) {
    doc.addPage();
    sigY = 28;
  }

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, sigY - 6, contentWidth, 34, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('PHYSICAL CASH HANDOVER & AUDIT VERIFICATION', marginX + 4, sigY);

  const leftLineStart = marginX + 6;
  const leftLineEnd = marginX + contentWidth / 2 - 10;
  const rightLineStart = marginX + contentWidth / 2 + 10;
  const rightLineEnd = pageWidth - marginX - 6;
  const lineY = sigY + 14;

  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.35);
  doc.line(leftLineStart, lineY, leftLineEnd, lineY);
  doc.line(rightLineStart, lineY, rightLineEnd, lineY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Agent Signature', leftLineStart, lineY + 5);
  doc.text('Cashier / Admin Signature', rightLineStart, lineY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Name: ${payload.agentName}    Date: ____ / ____ / ______`, leftLineStart, lineY + 10);
  doc.text('Verified By: ________________    Date: ____ / ____ / ______', rightLineStart, lineY + 10);

  // Page Footer Numbers on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${companyName} — Official Settlement & Audit Statement (${periodLabel})`,
      marginX,
      pageHeight - 8
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 8, { align: 'right' });
  }

  const filename = buildSettlementExportFilename(payload.dateFilter, 'pdf', companyName);
  doc.save(filename);
  return filename;
}
