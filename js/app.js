const xmlInput = document.getElementById('xmlInput');
const fileStatus = document.getElementById('fileStatus');
const invoicePanel = document.getElementById('invoicePanel');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const clearButton = document.getElementById('clearButton');
const parseStatus = document.getElementById('parseStatus');
const invoiceForm = document.getElementById('invoiceForm');
const debugPanel = document.getElementById('debugPanel');
const rawText = document.getElementById('rawText');
const addLineButton = document.getElementById('addLineButton');
const itemsBody = document.getElementById('itemsBody');

const fields = {
  invoiceNumber: document.getElementById('invoiceNumber'),
  issueDate: document.getElementById('issueDate'),
  currency: document.getElementById('currency'),
  sourceSite: document.getElementById('sourceSite'),
  customerCode: document.getElementById('customerCode'),
  customerName: document.getElementById('customerName'),
  invoiceTotal: document.getElementById('invoiceTotal'),
};

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setParseStatus(message, type = 'idle', loading = false) {
  parseStatus.className = `status status-${type}${loading ? ' status-loading' : ''}`;
  parseStatus.innerHTML = loading
    ? `<span class="spinner" aria-hidden="true"></span><span>${message}</span>`
    : message;
}

function xmlField(root, name) {
  const node = root.querySelector(`FLD[NAM="${name}"]`);
  return node?.getAttribute('VAL')?.trim() || '';
}

function xmlFieldIn(root, selector, name) {
  const parent = root.querySelector(selector);
  if (!parent) return '';
  return xmlField(parent, name);
}

function parseLocaleNumber(value = '') {
  const cleaned = String(value).trim().replace(/\s/g, '');
  if (!cleaned) return 0;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }

  if (cleaned.includes(',')) return Number(cleaned.replace(',', '.')) || 0;
  return Number(cleaned) || 0;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseInvoiceXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error('El archivo no contiene un XML válido.');

  const invoiceNumber = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'NUM');
  const issueDate = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'INVDAT');
  const currency = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'CUR') || xmlField(doc, 'CUR');
  const sourceCode = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'SALFCY');
  const sourceName = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'ZSALFCY');
  const customerCode = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'BPCINV');
  const customerName = xmlFieldIn(doc, 'SCRN[NAM="SIH0"]', 'BPINAM');

  const linesScreen = doc.querySelector('SCRN[NAM="WK5ALL4"]');
  const lineNodes = linesScreen
    ? [...linesScreen.querySelectorAll('FRM[TYP="1"] > LIG')]
    : [];

  const items = lineNodes
    .map((line) => {
      const reference = xmlField(line, 'ITMREF');
      const description = xmlField(line, 'ITMDES1');
      const quantityRaw = xmlField(line, 'QTY');
      const unit = xmlField(line, 'SAU') || xmlField(line, 'STU');
      const priceRaw = xmlField(line, 'NETPRI') || xmlField(line, 'GROPRI');

      if (!reference && !description && !quantityRaw && !priceRaw) return null;

      const quantity = parseLocaleNumber(quantityRaw);
      const unitPrice = parseLocaleNumber(priceRaw);
      return {
        reference,
        description,
        quantity: quantityRaw || '',
        unit,
        unitPrice: priceRaw || '',
        amount: formatMoney(quantity * unitPrice),
      };
    })
    .filter(Boolean);

  const sageTotal = xmlFieldIn(doc, 'SCRN[NAM="SIHV"] FRM[LIB="Totales"]', 'INVATI')
    || xmlFieldIn(doc, 'SCRN[NAM="SIHV"] FRM[LIB="Totales"]', 'INVNOT');
  const calculatedTotal = items.reduce((sum, item) => {
    return sum + (parseLocaleNumber(item.quantity) * parseLocaleNumber(item.unitPrice));
  }, 0);

  return {
    invoiceNumber,
    issueDate,
    currency,
    sourceSite: [sourceCode, sourceName].filter(Boolean).join(' · '),
    customerCode,
    customerName,
    items,
    total: sageTotal || formatMoney(calculatedTotal),
    debug: {
      sourceCode,
      sourceName,
      lineCount: items.length,
      sageTotal,
      calculatedTotal: formatMoney(calculatedTotal),
    },
  };
}

function createItemRow(item = {}) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input class="item-reference" type="text" value="${escapeHtml(item.reference || '')}" aria-label="Referencia" /></td>
    <td><input class="item-description" type="text" value="${escapeHtml(item.description || '')}" aria-label="Descripción" /></td>
    <td><input class="item-quantity compact-input" type="text" value="${escapeHtml(item.quantity || '')}" aria-label="Cantidad" /></td>
    <td><input class="item-unit unit-input" type="text" value="${escapeHtml(item.unit || '')}" aria-label="Unidad" /></td>
    <td><input class="item-price compact-input" type="text" value="${escapeHtml(item.unitPrice || '')}" aria-label="Precio unitario" /></td>
    <td><input class="item-amount compact-input" type="text" value="${escapeHtml(item.amount || '')}" aria-label="Importe" /></td>
    <td><button type="button" class="icon-button remove-line" title="Eliminar línea" aria-label="Eliminar línea">×</button></td>
  `;

  const quantityInput = row.querySelector('.item-quantity');
  const priceInput = row.querySelector('.item-price');
  const amountInput = row.querySelector('.item-amount');

  const recalculate = () => {
    const qty = parseLocaleNumber(quantityInput.value);
    const price = parseLocaleNumber(priceInput.value);
    amountInput.value = formatMoney(qty * price);
    recalculateInvoiceTotal();
  };

  quantityInput.addEventListener('input', recalculate);
  priceInput.addEventListener('input', recalculate);
  row.querySelector('.remove-line').addEventListener('click', () => {
    row.remove();
    recalculateInvoiceTotal();
  });

  itemsBody.appendChild(row);
}

function recalculateInvoiceTotal() {
  const total = [...itemsBody.querySelectorAll('.item-amount')]
    .reduce((sum, input) => sum + parseLocaleNumber(input.value), 0);
  fields.invoiceTotal.value = formatMoney(total);
}

function populateForm(invoice) {
  fields.invoiceNumber.value = invoice.invoiceNumber;
  fields.issueDate.value = invoice.issueDate;
  fields.currency.value = invoice.currency;
  fields.sourceSite.value = invoice.sourceSite;
  fields.customerCode.value = invoice.customerCode;
  fields.customerName.value = invoice.customerName;
  fields.invoiceTotal.value = invoice.total;

  itemsBody.innerHTML = '';
  if (invoice.items.length) invoice.items.forEach(createItemRow);
  else createItemRow();

  rawText.textContent = [
    `Factura: ${invoice.invoiceNumber || '(no detectada)'}`,
    `Fecha: ${invoice.issueDate || '(no detectada)'}`,
    `Planta: ${invoice.debug.sourceCode || '-'} / ${invoice.debug.sourceName || '-'}`,
    `Cliente: ${invoice.customerCode || '-'} / ${invoice.customerName || '-'}`,
    `Líneas importadas: ${invoice.debug.lineCount}`,
    `Total SAGE: ${invoice.debug.sageTotal || '(no encontrado)'}`,
    `Total calculado: ${invoice.debug.calculatedTotal}`,
  ].join('\n');

  invoiceForm.classList.remove('hidden');
  debugPanel.classList.remove('hidden');
}

function clearFields() {
  Object.values(fields).forEach((field) => { field.value = ''; });
  itemsBody.innerHTML = '';
  rawText.textContent = '';
}

function resetApp() {
  xmlInput.value = '';
  fileName.value = '';
  fileSize.value = '';
  clearFields();
  invoicePanel.classList.add('hidden');
  invoiceForm.classList.add('hidden');
  debugPanel.classList.add('hidden');
  fileStatus.className = 'status status-idle';
  fileStatus.textContent = 'Ningún archivo seleccionado.';
  setParseStatus('Esperando lectura del XML…');
}

xmlInput.addEventListener('change', async () => {
  const [file] = xmlInput.files;
  if (!file) {
    resetApp();
    return;
  }

  if (!file.name.toLowerCase().endsWith('.xml')) {
    resetApp();
    fileStatus.className = 'status status-error';
    fileStatus.textContent = 'Selecciona un archivo XML exportado desde SAGE.';
    return;
  }

  clearFields();
  fileName.value = file.name;
  fileSize.value = formatFileSize(file.size);
  invoicePanel.classList.remove('hidden');
  invoiceForm.classList.add('hidden');
  debugPanel.classList.add('hidden');
  fileStatus.className = 'status status-ok';
  fileStatus.textContent = 'XML cargado correctamente. El archivo permanece en este navegador.';
  setParseStatus('Leyendo estructura SAGE…', 'idle', true);

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const xmlText = await file.text();
    setParseStatus('Importando cabecera y líneas…', 'idle', true);
    const invoice = parseInvoiceXml(xmlText);
    populateForm(invoice);
    setParseStatus(`Importación completada: ${invoice.items.length} línea(s) detectada(s). Revisa los datos.`, 'ok');
  } catch (error) {
    console.error(error);
    setParseStatus(`No se ha podido importar el XML: ${error?.message || 'error desconocido'}`, 'error');
  }
});

addLineButton.addEventListener('click', () => {
  createItemRow();
  recalculateInvoiceTotal();
});

clearButton.addEventListener('click', resetApp);
