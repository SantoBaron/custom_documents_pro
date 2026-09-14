import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const pdfInput = document.getElementById('pdfInput');
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
  sellerName: document.getElementById('sellerName'),
  customerName: document.getElementById('customerName'),
  customerTaxId: document.getElementById('customerTaxId'),
  customerCountry: document.getElementById('customerCountry'),
  customerAddress: document.getElementById('customerAddress'),
  invoiceTotal: document.getElementById('invoiceTotal'),
};

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setParseStatus(message, type = 'idle') {
  parseStatus.className = `status status-${type}`;
  parseStatus.textContent = message;
}

function clearFields() {
  Object.values(fields).forEach((field) => { field.value = ''; });
  itemsBody.innerHTML = '';
  rawText.textContent = '';
}

function resetApp() {
  pdfInput.value = '';
  fileName.value = '';
  fileSize.value = '';
  clearFields();
  invoicePanel.classList.add('hidden');
  invoiceForm.classList.add('hidden');
  debugPanel.classList.add('hidden');
  fileStatus.className = 'status status-idle';
  fileStatus.textContent = 'Ningún archivo seleccionado.';
  setParseStatus('Esperando lectura del PDF…');
}

function normalizeSpaces(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeAmount(value = '') {
  return value.replace(/\s/g, '').trim();
}

function groupTextItems(items) {
  const rows = [];
  const tolerance = 2.5;

  items.forEach((item) => {
    const text = normalizeSpaces(item.str);
    if (!text) return;

    const x = item.transform[4];
    const y = item.transform[5];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance);

    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }

    row.items.push({ x, text });
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .map(normalizeSpaces)
    .filter(Boolean);
}

async function extractPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const allLines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupTextItems(textContent.items);
    allLines.push(...lines);
  }

  return allLines;
}

function firstMatch(text, regex, fallback = '') {
  const match = text.match(regex);
  return match ? normalizeSpaces(match[1] ?? match[0]) : fallback;
}

function detectSeller(lines) {
  return lines.find((line) => /AGQ\s+(TECHNOLOGICAL|LABS|INTERNATIONAL)/i.test(line)) || '';
}

function detectCustomerName(lines, seller) {
  const sellerIndex = lines.findIndex((line) => line === seller);
  const sellerPrefixes = [
    /AGQ TECHNOLOGICAL CORPORATE,? S\.?L\.?/i,
    /AGQ LABS INTERNATIONAL,? S\.?L\.?/i,
  ];

  if (seller) {
    for (const prefix of sellerPrefixes) {
      if (prefix.test(seller)) {
        const possible = normalizeSpaces(seller.replace(prefix, ''));
        if (possible && possible.length > 3) return possible;
      }
    }
  }

  const candidates = lines.slice(Math.max(0, sellerIndex), sellerIndex + 6);
  return candidates.find((line) => {
    if (!line || /AGQ/i.test(line)) return false;
    if (/Fecha|CIF|NIF|Tel|FACTURA|DESCRIPCI[ÓO]N/i.test(line)) return false;
    return /[A-ZÁÉÍÓÚÑ]{3,}/.test(line);
  }) || '';
}

function detectTaxIds(lines) {
  const values = [];
  lines.forEach((line) => {
    const matches = [...line.matchAll(/(?:CIF\/NIF|NIF|CIF|Tax ID)\s*:?\s*([A-Z0-9-]{6,20})/gi)];
    matches.forEach((match) => values.push(match[1]));
  });
  return [...new Set(values)];
}

function detectCountry(lines) {
  const compactCountry = lines.find((line) => /^([A-Z]{2})(?:\s*[-–]\s*\1)?$/i.test(line.replace(/[^A-Z-]/gi, '')));
  if (compactCountry) return compactCountry.replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase();

  const countryLine = lines.find((line) => /\b(Costa Rica|España|Spain|Portugal|Francia|France|Italia|Italy|Alemania|Germany|Marruecos|Morocco|Saudi Arabia|Arabia Saudí)\b/i.test(line));
  return countryLine || '';
}

function detectAddress(lines, customerName) {
  if (!customerName) return '';
  const index = lines.findIndex((line) => line.includes(customerName));
  if (index < 0) return '';

  const candidates = [];
  for (let i = index + 1; i < Math.min(lines.length, index + 5); i += 1) {
    const line = lines[i];
    if (/Fecha|CIF|NIF|DESCRIPCI[ÓO]N|FACTURA|Tel:/i.test(line)) continue;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) continue;
    if (line.length > 2) candidates.push(line);
  }
  return candidates.join('\n');
}

function detectItems(lines) {
  const headerIndex = lines.findIndex((line) => /DESCRIPCI[ÓO]N.*CANTIDAD.*PRECIO.*IMPORTE/i.test(line));
  if (headerIndex < 0) return [];

  const endIndexRaw = lines.findIndex((line, index) => index > headerIndex && /Base\s+Iva|Base\s+IVA|Subtotal|Total Factura/i.test(line));
  const endIndex = endIndexRaw > headerIndex ? endIndexRaw : Math.min(lines.length, headerIndex + 20);
  const candidates = lines.slice(headerIndex + 1, endIndex);
  const result = [];

  candidates.forEach((line) => {
    const match = line.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s+([\d.]+,\d{2}|\d+\.\d{2})\s+([\d.]+,\d{2}|\d+\.\d{2})$/);
    if (!match) return;

    const description = normalizeSpaces(match[1]);
    if (!description || /Base|IVA|Subtotal/i.test(description)) return;

    result.push({
      description,
      quantity: normalizeAmount(match[2]),
      price: normalizeAmount(match[3]),
      amount: normalizeAmount(match[4]),
    });
  });

  return result;
}

function parseInvoice(lines) {
  const fullText = lines.join('\n');
  const seller = detectSeller(lines);
  const taxIds = detectTaxIds(lines);

  return {
    invoiceNumber: firstMatch(fullText, /\b((?:FAC|FV|INV)-[A-Z0-9-]+)\b/i),
    issueDate: firstMatch(fullText, /Fecha\s+Emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i),
    sellerName: seller,
    customerName: detectCustomerName(lines, seller),
    customerTaxId: taxIds[0] || '',
    customerCountry: detectCountry(lines),
    customerAddress: '',
    invoiceTotal: firstMatch(fullText, /Total\s+Factura\s+(?:EUR\s+)?([\d.]+,\d{2}|\d+\.\d{2})/i),
    items: detectItems(lines),
  };
}

function createItemRow(item = {}) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input class="item-description" type="text" value="${escapeHtml(item.description || '')}" aria-label="Descripción" /></td>
    <td><input class="item-quantity compact-input" type="text" value="${escapeHtml(item.quantity || '')}" aria-label="Cantidad" /></td>
    <td><input class="item-price compact-input" type="text" value="${escapeHtml(item.price || '')}" aria-label="Precio" /></td>
    <td><input class="item-amount compact-input" type="text" value="${escapeHtml(item.amount || '')}" aria-label="Importe" /></td>
    <td><button type="button" class="icon-button remove-line" title="Eliminar línea" aria-label="Eliminar línea">×</button></td>
  `;
  row.querySelector('.remove-line').addEventListener('click', () => row.remove());
  itemsBody.appendChild(row);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function populateForm(parsed, lines) {
  fields.invoiceNumber.value = parsed.invoiceNumber;
  fields.issueDate.value = parsed.issueDate;
  fields.sellerName.value = parsed.sellerName;
  fields.customerName.value = parsed.customerName;
  fields.customerTaxId.value = parsed.customerTaxId;
  fields.customerCountry.value = parsed.customerCountry;
  fields.customerAddress.value = detectAddress(lines, parsed.customerName);
  fields.invoiceTotal.value = parsed.invoiceTotal;

  itemsBody.innerHTML = '';
  if (parsed.items.length) {
    parsed.items.forEach(createItemRow);
  } else {
    createItemRow();
  }

  invoiceForm.classList.remove('hidden');
  debugPanel.classList.remove('hidden');
}

pdfInput.addEventListener('change', async () => {
  const [file] = pdfInput.files;

  if (!file) {
    resetApp();
    return;
  }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    resetApp();
    fileStatus.className = 'status status-error';
    fileStatus.textContent = 'Selecciona un archivo PDF válido.';
    return;
  }

  clearFields();
  fileName.value = file.name;
  fileSize.value = formatFileSize(file.size);
  invoicePanel.classList.remove('hidden');
  invoiceForm.classList.add('hidden');
  debugPanel.classList.add('hidden');
  fileStatus.className = 'status status-ok';
  fileStatus.textContent = 'PDF cargado correctamente. El archivo permanece en este navegador.';
  setParseStatus('Leyendo y analizando el PDF…');

  try {
    const lines = await extractPdf(file);
    rawText.textContent = lines.join('\n');
    const parsed = parseInvoice(lines);
    populateForm(parsed, lines);
    setParseStatus('Lectura completada. Revisa los campos detectados y corrige lo necesario.', 'ok');
  } catch (error) {
    console.error(error);
    setParseStatus('No se ha podido leer el PDF. Puedes probar con otra factura o revisar el detalle técnico en consola.', 'error');
  }
});

addLineButton.addEventListener('click', () => createItemRow());
clearButton.addEventListener('click', resetApp);
