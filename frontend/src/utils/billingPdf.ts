import { jsPDF } from 'jspdf';
import type { Charge } from '../services/billing';
import { formatCurrency, getChargeStatusLabel } from './billingFormat';

function buildFileName(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${prefix}-${stamp}.pdf`;
}

export function downloadChargesPdf(charges: Charge[], title: string, filePrefix = 'historial-cobros'): void {
  if (charges.length === 0) {
    throw new Error('No hay cobros para exportar.');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let cursorY = margin;

  const drawHeader = (pageTitle: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(pageTitle, margin, cursorY);
    cursorY += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, margin, cursorY);
    doc.setTextColor(17, 24, 39);
    cursorY += 8;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight <= pageHeight - margin) return;
    doc.addPage();
    cursorY = margin;
    drawHeader(title);
  };

  drawHeader(title);

  charges.forEach((charge, index) => {
    ensureSpace(65);

    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 54, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(charge.client_name ?? `Cliente #${charge.client_id}`, margin + 4, cursorY + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Periodo: ${charge.period}`, margin + 4, cursorY + 14);
    doc.text(`Vencimiento: ${new Date(charge.due_date).toLocaleDateString('es-AR')}`, margin + 55, cursorY + 14);
    doc.text(`Estado: ${getChargeStatusLabel(charge.status)}`, margin + 108, cursorY + 14);

    doc.text(`Storage: ${formatCurrency(charge.storage_amount)} (base ${formatCurrency(charge.base_storage_rate)} / desc ${charge.storage_discount_pct}%)`, margin + 4, cursorY + 22);
    doc.text(`Preparacion: ${formatCurrency(charge.preparation_amount)} (primer producto ${formatCurrency(charge.base_preparation_rate)} / adicional ${formatCurrency(charge.applied_preparation_rate)})`, margin + 4, cursorY + 27);
    doc.text(`Alta producto: ${formatCurrency(charge.product_creation_amount)}`, margin + 4, cursorY + 32);
    doc.text(`Traslados a transporte: ${formatCurrency(charge.transport_dispatch_amount)}`, margin + 4, cursorY + 37);
    doc.text(`Descargas: ${formatCurrency(charge.truck_unloading_amount)}`, margin + 4, cursorY + 42);
    doc.text(`Cargos manuales: ${formatCurrency(charge.manual_charge_amount)}`, margin + 4, cursorY + 47);
    doc.text(`Envios: ${formatCurrency(charge.shipping_amount)} (base ${formatCurrency(charge.shipping_base_amount)} / desc ${charge.shipping_discount_pct}%)`, margin + 4, cursorY + 52);

    doc.setFont('helvetica', 'bold');
    doc.text(`Total: ${formatCurrency(charge.total)}`, pageWidth - margin - 4, cursorY + 52, { align: 'right' });

    cursorY += 66;

    if (index < charges.length - 1) {
      ensureSpace(10);
    }
  });

  doc.save(buildFileName(filePrefix));
}