import JsBarcode from 'jsbarcode';

export type LabelProduct = {
  name: string;
  sku: string;
};

export type LabelPrintItem = LabelProduct & {
  quantity: number;
};

export type LabelGenerationResult = {
  fileName: string;
  labelCount: number;
  blobUrl: string;
};

const LABEL_WIDTH_MM = 50;
const LABEL_HEIGHT_MM = 30;
const LABEL_BARCODE_WIDTH_MM = 34;
const LABEL_BARCODE_HEIGHT_MM = 10;

function getCssTokenValue(tokenName: string, fallback?: string): string {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();

  if (!value) {
    if (fallback) {
      return fallback;
    }

    throw new Error(`No se encontró el token de diseño ${tokenName}.`);
  }

  return value;
}

function parseCssColorToRgb(tokenName: string, fallback?: string): [number, number, number] {
  const value = getCssTokenValue(tokenName, fallback);

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const normalizedHex = hex.length === 3
      ? hex.split('').map((char) => `${char}${char}`).join('')
      : hex;

    return [
      parseInt(normalizedHex.slice(0, 2), 16),
      parseInt(normalizedHex.slice(2, 4), 16),
      parseInt(normalizedHex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
  if (!rgbMatch) {
    throw new Error(`El token ${tokenName} no tiene un formato de color soportado.`);
  }

  const [red, green, blue] = rgbMatch[1]
    .split(',')
    .slice(0, 3)
    .map((component) => Number(component.trim()));

  if ([red, green, blue].some((component) => Number.isNaN(component))) {
    throw new Error(`El token ${tokenName} no pudo convertirse a RGB.`);
  }

  return [red, green, blue];
}

function getLabelTheme() {
  return {
    surface: getCssTokenValue('--color-surface', '#ffffff'),
    textPrimary: getCssTokenValue('--color-text-blue-700', '#1d4ed8'),
    borderRgb: parseCssColorToRgb('--color-border', '#d1d5db'),
    textPrimaryRgb: parseCssColorToRgb('--color-text-blue-700', '#1d4ed8'),
  };
}

function buildFileName(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');

  return `etiquetas-${stamp}`;
}

function normalizeBarcodeValue(sku: string): string {
  const normalizedSku = sku.trim();

  if (!normalizedSku) {
    throw new Error('El SKU no puede estar vacío para generar el código de barras.');
  }

  return normalizedSku;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createBarcodeSvgMarkup(sku: string): string {
  const normalizedSku = normalizeBarcodeValue(sku);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const theme = getLabelTheme();
  let isValid = true;

  JsBarcode(svg, normalizedSku, {
    format: 'CODE128',
    displayValue: false,
    margin: 0,
    width: 1.7,
    height: 56,
    background: theme.surface,
    lineColor: '#000000',
    valid: (valid) => {
      isValid = valid;
    },
  });

  if (!isValid) {
    throw new Error(`No se pudo generar un Code128 válido para el SKU ${normalizedSku}.`);
  }

  svg.setAttribute('width', `${LABEL_BARCODE_WIDTH_MM}mm`);
  svg.setAttribute('height', `${LABEL_BARCODE_HEIGHT_MM}mm`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Código de barras ${normalizedSku}`);
  svg.classList.add('label__barcode');

  return svg.outerHTML;
}

function expandLabelItems(items: LabelPrintItem[]): LabelProduct[] {
  return items.flatMap((item) => {
    const copies = Math.max(0, Math.floor(item.quantity));
    return Array.from({ length: copies }, () => ({ name: item.name, sku: item.sku }));
  });
}

function buildLabelMarkup(label: LabelProduct): string {
  const normalizedName = label.name.trim();
  const normalizedSku = normalizeBarcodeValue(label.sku);
  const barcodeSvgMarkup = createBarcodeSvgMarkup(normalizedSku);

  return `
    <section class="label-page">
      <article class="label">
        <div class="label__name">${escapeHtml(normalizedName)}</div>
        <div class="label__barcode-wrap">${barcodeSvgMarkup}</div>
        <div class="label__sku">${escapeHtml(normalizedSku)}</div>
      </article>
    </section>
  `;
}

function buildPrintDocument(labels: LabelProduct[]): string {
  const theme = getLabelTheme();

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Etiquetas SKU</title>
    <style>
      :root {
        --label-width: ${LABEL_WIDTH_MM}mm;
        --label-height: ${LABEL_HEIGHT_MM}mm;
        --barcode-width: ${LABEL_BARCODE_WIDTH_MM}mm;
        --barcode-height: ${LABEL_BARCODE_HEIGHT_MM}mm;
        --label-surface: ${theme.surface};
        --label-text: ${theme.textPrimary};
      }

      * {
        box-sizing: border-box;
      }

      @page {
        size: 50mm 30mm;
        margin: 0;
      }

      html,
      body {
        margin: 0;
        padding: 0;
      }

      body {
        background: #eef2f7;
        font-family: Arial, Helvetica, sans-serif;
        color: var(--label-text);
      }

      .preview-root {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 20px;
      }

      .preview-toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
        color: #0f172a;
        font-size: 13px;
      }

      .preview-scale {
        transform: scale(4);
        transform-origin: top center;
        margin-top: 52px;
        margin-bottom: 72px;
      }

      .label-page {
        width: var(--label-width);
        height: var(--label-height);
        display: flex;
        align-items: center;
        justify-content: center;
        page-break-after: always;
        break-after: page;
      }

      .label-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }

      .label {
        width: var(--label-width);
        height: var(--label-height);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.1mm;
        overflow: hidden;
        background: var(--label-surface);
        page-break-inside: avoid;
        break-inside: avoid;
      }

      .label__name {
        width: 36mm;
        text-align: center;
        font-size: 2.2mm;
        font-weight: 700;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .label__barcode-wrap {
        width: var(--barcode-width);
        height: var(--barcode-height);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .label__barcode {
        width: var(--barcode-width);
        height: var(--barcode-height);
        display: block;
        overflow: visible;
        shape-rendering: crispEdges;
      }

      .label__sku {
          width: 42mm;
        text-align: center;
        font-family: "Courier New", monospace;
          font-size: 4mm;
        font-weight: 700;
          line-height: 0.95;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      @media print {
        html,
        body {
          margin: 0;
          padding: 0;
          width: var(--label-width);
          background: var(--label-surface);
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .preview-root {
          display: block;
          padding: 0;
        }

        .preview-toolbar {
          display: none;
        }

        .preview-scale {
          transform: none;
          margin: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="preview-root">
      <div class="preview-toolbar">
        <span>Vista previa de etiqueta 50 mm x 30 mm</span>
        <span>Imprimiendo...</span>
      </div>
      <div class="preview-scale">
        ${labels.map((label) => buildLabelMarkup(label)).join('')}
      </div>
    </div>
  </body>
</html>`;
}

async function openPrintWindow(labels: LabelProduct[], fileName: string): Promise<LabelGenerationResult> {
  const printWindow = window.open('', '_blank', 'width=760,height=680');

  if (!printWindow) {
    throw new Error('No se pudo abrir la ventana de impresión. Verificá el bloqueador de popups.');
  }

  const html = buildPrintDocument(labels);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finalize = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const cleanup = () => {
      printWindow.onafterprint = null;
    };

    printWindow.onafterprint = () => {
      cleanup();
      finalize(resolve);
      printWindow.close();
    };

    try {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();

      printWindow.setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
          printWindow.setTimeout(() => {
            cleanup();
            finalize(resolve);
          }, 1200);
        } catch (error) {
          cleanup();
          finalize(() => reject(error instanceof Error ? error : new Error('No se pudo iniciar la impresión.')));
        }
      }, 400);
    } catch (error) {
      cleanup();
      finalize(() => reject(error instanceof Error ? error : new Error('No se pudo preparar el documento de impresión.')));
    }
  });

  return {
    fileName,
    labelCount: labels.length,
    blobUrl: '',
  };
}

export async function generateLabelsPDFByItems(items: LabelPrintItem[]): Promise<LabelGenerationResult> {
  const expandedLabels = expandLabelItems(items);

  if (expandedLabels.length === 0) {
    throw new Error('No hay etiquetas para generar.');
  }

  const fileName = buildFileName();
  const result = await openPrintWindow(expandedLabels, fileName);

  return {
    ...result,
    labelCount: expandedLabels.length,
  };
}

export async function generateLabelsPDF(
  products: Array<{ name: string; sku: string }>,
  quantity: number,
): Promise<LabelGenerationResult> {
  const normalizedQuantity = Math.max(0, Math.floor(quantity));

  if (normalizedQuantity <= 0) {
    throw new Error('La cantidad de etiquetas debe ser mayor a cero.');
  }

  return generateLabelsPDFByItems(
    products.map((product) => ({
      ...product,
      quantity: normalizedQuantity,
    })),
  );
}