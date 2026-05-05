import { jsPDF } from 'jspdf';
import type { BillingDocument, BillingPreviewItem, Charge } from '../services/billing';
import { formatCurrency, getChargeStatusLabel } from './billingFormat';

const COMPANY_NAME = 'Topix Fulfillment';
const COMPANY_PHONE = '+54 9 11 2397 5685';
const COMPANY_ADDRESS = 'Jose Ignacio de la Rosa 5934, Mataderos, Buenos Aires';

function getBillingDocumentStatusLabel(status: BillingDocument['status']): string {
  switch (status) {
    case 'paid':
      return 'Pagado';
    case 'overdue':
      return 'Vencido';
    case 'pending':
    default:
      return 'Pendiente';
  }
}

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

type BillingRemitoLine = {
  label: string;
  amount: number;
  detail?: string;
};

export async function downloadBillingDocumentPdf(document: BillingDocument, preview?: BillingPreviewItem): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = margin;

  const detailLines: BillingRemitoLine[] = [
    {
      label: 'Storage',
      amount: document.storage_total,
      detail: preview
        ? `${preview.total_m3.toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m3 calculados`
        : undefined,
    },
    {
      label: 'Preparacion',
      amount: document.preparation_total,
      detail: preview ? `${preview.total_orders.toLocaleString('es-AR')} pedido(s) preparados` : undefined,
    },
    {
      label: 'Alta de producto',
      amount: document.product_creation_total,
      detail: preview?.product_creation_products?.length
        ? preview.product_creation_products.join(', ')
        : 'Sin altas en el periodo',
    },
    {
      label: 'Primera impresion de etiqueta',
      amount: document.label_print_total,
      detail: preview?.label_print_count
        ? `${preview.label_print_count.toLocaleString('es-AR')} etiqueta(s) cobradas por primera impresion`
        : 'Sin primeras impresiones en el periodo',
    },
    {
      label: 'Traslados a transporte',
      amount: document.transport_dispatch_total,
      detail: preview?.transport_dispatch_count
        ? `${preview.transport_dispatch_count.toLocaleString('es-AR')} traslado(s)`
        : 'Sin traslados en el periodo',
    },
    {
      label: 'Descargas',
      amount: document.truck_unloading_total,
      detail: preview?.truck_unloading_count
        ? `${preview.truck_unloading_count.toLocaleString('es-AR')} camion(es)`
        : 'Sin descargas en el periodo',
    },
    {
      label: 'Cargos manuales',
      amount: document.manual_charge_total,
      detail: preview?.manual_charge_items?.length
        ? preview.manual_charge_items
            .map((item) => `${item.descripcion || item.tipo || 'Cargo manual'}: ${formatCurrency(item.monto)}`)
            .join(' | ')
        : 'Sin cargos manuales en el periodo',
    },
    {
      label: 'Envios',
      amount: document.shipping_total,
      detail: preview ? `Base del periodo ${formatCurrency(preview.shipping_base_amount)}` : undefined,
    },
  ].filter((line) => Math.abs(line.amount) > 0.00001);

  const drawHeader = () => {
    const headerTop = cursorY;
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, headerTop, contentWidth, 30, 3, 3, 'S');

    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(COMPANY_NAME, margin + 4, headerTop + 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text('Remito mensual de servicios logísticos', margin + 4, headerTop + 14);
    doc.text(COMPANY_PHONE, margin + 4, headerTop + 19);
    doc.text(COMPANY_ADDRESS, margin + 4, headerTop + 24);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(17, 24, 39);
    doc.text('Remito mensual', pageWidth - margin - 4, headerTop + 9, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text(`Generado ${new Date().toLocaleString('es-AR')}`, pageWidth - margin - 4, headerTop + 15, { align: 'right' });
    doc.text(`Periodo ${document.period} · Estado ${getBillingDocumentStatusLabel(document.status)}`, pageWidth - margin - 4, headerTop + 20, { align: 'right' });
    doc.setTextColor(17, 24, 39);
    cursorY += 42;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight <= pageHeight - margin) return;
    doc.addPage();
    cursorY = margin;
    drawHeader();
  };

  drawHeader();

  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cursorY, contentWidth, 32, 2, 2, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text('Datos del cliente', margin + 4, cursorY + 7);
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(12);
  doc.text(document.client_name, margin + 4, cursorY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Vencimiento: ${new Date(document.due_date).toLocaleDateString('es-AR')}`, margin + 4, cursorY + 22);
  doc.text(`Remito #${document.id}`, margin + 4, cursorY + 28);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total: ${formatCurrency(document.total)}`, pageWidth - margin - 4, cursorY + 22, { align: 'right' });
  cursorY += 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Detalle del periodo', margin, cursorY);
  cursorY += 7;

  if (detailLines.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.text('No hubo servicios facturables para este periodo.', margin, cursorY);
    doc.setTextColor(17, 24, 39);
    cursorY += 8;
  }

  detailLines.forEach((line) => {
    const detailText = line.detail ? doc.splitTextToSize(line.detail, contentWidth - 58) : [];
    const rowHeight = 14 + detailText.length * 4;
    ensureSpace(rowHeight + 2);

    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(margin, cursorY, contentWidth, rowHeight, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(line.label, margin + 4, cursorY + 7);
    doc.text(formatCurrency(line.amount), pageWidth - margin - 4, cursorY + 7, { align: 'right' });

    if (detailText.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(75, 85, 99);
      doc.text(detailText, margin + 4, cursorY + 15);
      doc.setTextColor(17, 24, 39);
    }

    cursorY += rowHeight + 3;
  });

  ensureSpace(26);
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(margin, cursorY, contentWidth, 18, 2, 2, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cursorY, contentWidth, 18, 2, 2, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Total a pagar', margin + 4, cursorY + 11);
  doc.text(formatCurrency(document.total), pageWidth - margin - 4, cursorY + 11, { align: 'right' });
  cursorY += 24;

  if (preview?.manual_charge_items?.length) {
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Observaciones del periodo', margin, cursorY);
    cursorY += 7;

    preview.manual_charge_items.forEach((item) => {
      const note = `${new Date(item.fecha).toLocaleDateString('es-AR')} - ${item.descripcion || item.tipo || 'Cargo manual'}: ${formatCurrency(item.monto)}`;
      const wrapped = doc.splitTextToSize(note, contentWidth - 8);
      ensureSpace(8 + wrapped.length * 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(wrapped, margin + 4, cursorY);
      cursorY += wrapped.length * 4 + 3;
    });
  }

  doc.save(buildFileName(`remito-${document.client_name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${document.period}`));
}