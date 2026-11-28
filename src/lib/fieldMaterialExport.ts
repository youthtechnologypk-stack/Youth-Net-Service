import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DateFilterState } from './dateFilter';
import {
  formatLongPeriodLabel,
  formatPeriodFilenameSlug,
  sanitizeSpreadsheetCell,
} from './settlementLedgerExport';
import {
  FieldMaterialKpiSummary,
  formatActionTypeMeta,
  SupabaseFieldMaterialLog,
} from '../services/fieldMaterialService';

export interface FieldMaterialExportPayload {
  companyName: string;
  supportHelpline?: string;
  dateFilter: DateFilterState;
  areaFilterLabel: string;
  technicianFilterLabel: string;
  actionFilterLabel: string;
  generatedAt?: Date;
  summary: FieldMaterialKpiSummary;
  rows: SupabaseFieldMaterialLog[];
}

export function buildFieldMaterialFilename(
  filter: DateFilterState,
  ext: 'xlsx' | 'pdf',
  companyName?: string
): string {
  const brandSlug =
    String(companyName || 'YouthNet')
      .replace(/service/i, '')
      .replace(/[^A-Za-z0-9]+/g, '')
      .trim() || 'YouthNet';
  const periodSlug = formatPeriodFilenameSlug(filter) || 'All_Time';
  return `${brandSlug}_Field_Material_Log_${periodSlug}.${ext}`;
}

function formatTimestamp(raw?: string | null): string {
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

function formatRemovedSummaryText(summary: FieldMaterialKpiSummary): string {
  const parts: string[] = [];
  if (summary.totalRemovedPieces > 0) parts.push(`${summary.totalRemovedPieces} pcs`);
  if (summary.totalRemovedMeters > 0) parts.push(`${summary.totalRemovedMeters} m`);
  if (summary.totalRemovedRollsOrBoxes > 0) parts.push(`${summary.totalRemovedRollsOrBoxes} rolls/boxes`);
  return parts.length > 0 ? parts.join(' · ') : '0 pcs · 0 m';
}

export function exportFieldMaterialLogsToExcel(payload: FieldMaterialExportPayload): string {
  const companyName = (payload.companyName || 'Youth Net Service').trim();
  const periodLabel = formatLongPeriodLabel(payload.dateFilter);
  const generatedAt = payload.generatedAt || new Date();
  const generatedStr = generatedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sheetData: Array<Array<string | number>> = [
    [sanitizeSpreadsheetCell(companyName)],
    [sanitizeSpreadsheetCell(`Field Material & FTTH Pole Deployment Audit Log — ${periodLabel}`)],
    ['Period', sanitizeSpreadsheetCell(periodLabel), '', 'Coverage Area', sanitizeSpreadsheetCell(payload.areaFilterLabel)],
    [
      'Technician / Person',
      sanitizeSpreadsheetCell(payload.technicianFilterLabel),
      '',
      'Action Filter',
      sanitizeSpreadsheetCell(payload.actionFilterLabel),
    ],
    ['Generated At', sanitizeSpreadsheetCell(generatedStr), '', 'Total Records', payload.rows.length],
    [],
    ['SUMMARY METRIC', 'VALUE'],
    ['Total Wire Used (Meters)', sanitizeSpreadsheetCell(payload.summary.totalWireUsedMeters)],
    [
      'Total Splitters & Boxes Installed (Pieces)',
      sanitizeSpreadsheetCell(payload.summary.totalSplittersAndBoxesInstalled),
    ],
    [
      'Other Materials Installed (Pieces)',
      sanitizeSpreadsheetCell(payload.summary.totalOtherInstalledPieces),
    ],
    ['Materials Removed / Recovered (Pieces)', sanitizeSpreadsheetCell(payload.summary.totalRemovedPieces)],
    ['Materials Removed / Recovered (Meters)', sanitizeSpreadsheetCell(payload.summary.totalRemovedMeters)],
    [],
    [
      'Date & Time',
      'Person',
      'Role',
      'Action',
      'Material Item',
      'Quantity',
      'Unit',
      'Pole / Location',
      'Coverage Area',
      'Notes / Remarks',
    ],
  ];

  if (payload.rows.length === 0) {
    sheetData.push(['—', 'No material logs recorded for selected filters', '', '', '', 0, '', '', '', '']);
  } else {
    for (const row of payload.rows) {
      const actionMeta = formatActionTypeMeta(row.action_type);
      sheetData.push([
        sanitizeSpreadsheetCell(formatTimestamp(row.created_at)),
        sanitizeSpreadsheetCell(row.performed_by_name),
        sanitizeSpreadsheetCell(row.performed_by_role),
        sanitizeSpreadsheetCell(actionMeta.label),
        sanitizeSpreadsheetCell(row.material_category),
        sanitizeSpreadsheetCell(Number(row.quantity) || 0),
        sanitizeSpreadsheetCell(row.unit),
        sanitizeSpreadsheetCell(row.pole_id_or_location),
        sanitizeSpreadsheetCell(row.coverage_area),
        sanitizeSpreadsheetCell(row.remarks || '—'),
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 22 },
    { wch: 11 },
    { wch: 28 },
    { wch: 28 },
    { wch: 11 },
    { wch: 10 },
    { wch: 28 },
    { wch: 20 },
    { wch: 42 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Field Material Log');

  const filename = buildFieldMaterialFilename(payload.dateFilter, 'xlsx', companyName);
  XLSX.writeFile(wb, filename);
  return filename;
}

export function exportFieldMaterialLogsToPdf(payload: FieldMaterialExportPayload): string {
  const companyName = (payload.companyName || 'Youth Net Service').trim();
  const periodLabel = formatLongPeriodLabel(payload.dateFilter);
  const generatedAt = payload.generatedAt || new Date();
  const generatedStr = generatedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  // Branded Header Bar
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 23, 'F');
  doc.setFillColor(6, 182, 212);
  doc.rect(0, 23, pageWidth, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(companyName.toUpperCase(), marginX, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const subTitle = payload.supportHelpline
    ? `FTTH Field Material & Pole Deployment Audit Report  |  Helpline: ${payload.supportHelpline}`
    : 'FTTH Field Material & Pole Deployment Audit Report';
  doc.text(subTitle, marginX, 17.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(34, 211, 238);
  doc.text('FTTH STOCK & POLE AUDIT', pageWidth - marginX, 11, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Generated: ${generatedStr}`, pageWidth - marginX, 17.5, { align: 'right' });

  // Title & Filter Metadata
  let cursorY = 31;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text(`Field Material & FTTH Pole Deployment Log — ${periodLabel}`, marginX, cursorY);

  cursorY += 4.5;
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, cursorY, contentWidth, 13, 2, 2, 'FD');

  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Period:', marginX + 3, cursorY + 8);
  doc.text('Coverage Area:', marginX + 68, cursorY + 8);
  doc.text('Technician:', marginX + 145, cursorY + 8);
  doc.text('Action Type:', marginX + 215, cursorY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(periodLabel, marginX + 17, cursorY + 8);
  doc.text(payload.areaFilterLabel, marginX + 95, cursorY + 8);
  doc.text(payload.technicianFilterLabel, marginX + 166, cursorY + 8);
  doc.text(payload.actionFilterLabel, marginX + 237, cursorY + 8);

  // KPI Summary Table
  autoTable(doc, {
    startY: cursorY + 17,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    head: [
      [
        'Total Wire Used (Meters)',
        'Splitters & Boxes Installed (Pieces)',
        'Other Items Installed (Pieces)',
        'Materials Removed / Recovered',
        'Total Log Entries',
      ],
    ],
    body: [
      [
        `${payload.summary.totalWireUsedMeters.toLocaleString('en-US')} m`,
        `${payload.summary.totalSplittersAndBoxesInstalled.toLocaleString('en-US')} pcs`,
        `${payload.summary.totalOtherInstalledPieces.toLocaleString('en-US')} pcs`,
        formatRemovedSummaryText(payload.summary),
        String(payload.rows.length),
      ],
    ],
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      cellPadding: 2.5,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 9.5,
      halign: 'center',
      cellPadding: 3,
    },
    columnStyles: {
      0: { fillColor: [236, 254, 255], textColor: [14, 116, 144] },
      1: { fillColor: [236, 253, 245], textColor: [6, 95, 70] },
      3: { fillColor: [255, 251, 235], textColor: [146, 64, 14] },
    },
    styles: {
      lineColor: [203, 213, 225],
      lineWidth: 0.25,
    },
  });

  const afterKpiY = (doc as any).lastAutoTable?.finalY || cursorY + 34;

  // Main Itemized Table
  const tableBody =
    payload.rows.length === 0
      ? [['—', 'No material deployment records for selected filters', '—', '—', '—', '—', '—']]
      : payload.rows.map((row) => {
          const actionMeta = formatActionTypeMeta(row.action_type);
          return [
            formatTimestamp(row.created_at),
            `${row.performed_by_name} (${row.performed_by_role})`,
            actionMeta.label,
            row.material_category,
            `${Number(row.quantity) || 0} ${row.unit}`,
            `${row.pole_id_or_location} · ${row.coverage_area}`,
            row.remarks || '—',
          ];
        });

  autoTable(doc, {
    startY: afterKpiY + 6,
    margin: { left: marginX, right: marginX, bottom: 22 },
    theme: 'striped',
    head: [
      [
        'Date & Time',
        'Person & Role',
        'Action',
        'Material Item',
        'Qty & Unit',
        'Pole / Location / Area',
        'Notes',
      ],
    ],
    body: tableBody,
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 2.6,
    },
    bodyStyles: {
      textColor: [30, 41, 59],
      fontSize: 7.8,
      cellPadding: 2.3,
      valign: 'top',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 36 },
      2: { cellWidth: 34, fontStyle: 'bold' },
      3: { cellWidth: 40 },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 48 },
      6: { cellWidth: 'auto' },
    },
    styles: {
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
  });

  // Verification Signature Footer
  let sigY = ((doc as any).lastAutoTable?.finalY || afterKpiY + 35) + 14;
  if (sigY + 26 > pageHeight - 12) {
    doc.addPage();
    sigY = 26;
  }

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, sigY - 5, contentWidth, 27, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  doc.text('FIELD STOCK & POLE DEPLOYMENT VERIFICATION', marginX + 4, sigY);

  const lineY = sigY + 12;
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.35);
  doc.line(marginX + 6, lineY, marginX + 95, lineY);
  doc.line(pageWidth - marginX - 95, lineY, pageWidth - marginX - 6, lineY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(15, 23, 42);
  doc.text('Field Supervisor / Storekeeper Signature', marginX + 6, lineY + 4.5);
  doc.text('Operations Manager / Admin Signature', pageWidth - marginX - 95, lineY + 4.5);

  // Page numbers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${companyName} — Field Material & FTTH Pole Deployment Log (${periodLabel})`,
      marginX,
      pageHeight - 7
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 7, { align: 'right' });
  }

  const filename = buildFieldMaterialFilename(payload.dateFilter, 'pdf', companyName);
  doc.save(filename);
  return filename;
}
