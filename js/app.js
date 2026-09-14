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

function setParseStatus(message, type = 'idle', loading = false) {
  parseStatus.className = `status status-${type}${loading ? ' status-loading' : ''}`;
  parseStatus.innerHTML = loading
    ? `<span class="spinner" aria-hidden="true"></span><span>${message}</span>`
    : message;
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

async function extractPdf(file, onProgress) {
  onProgress?.('Abriendo PDF…');
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const allLines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Leyendo página ${pageNumber} de ${pdf.numPages}…`);
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupTextItems(textContent.items);
    allLines.push(...lines);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  onProgress?.('Interpretando campos de la factura…');
  return allLines;
}

function firstMatch(text, regex, fallback = '') {
  const match = text.match(regex);
  return match ? normalizeSpaces(match[1] ?? match[0]) : fallback;
}

const sellerPatterns = [
  /AGQ TECHNOLOGICAL CORPORATE,?\s*S\.?L\.?/i,
  /AGQ LABS INTERNATIONAL,?\s*S\.?L\.?/i,
  /AGQ TECHNOLOGICAL SERVICES,?\s*S\.?L\.?/i,
];

function splitPartyHeader(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const pattern of sellerPatterns) {
      const match = line.match(pattern);
      if (!match) continue;

      const sellerName = normalizeSpaces(match[0]);
      const customerName = normalizeSpaces(line.slice((match.index || 0) + match[0].length));

      return {
        index,
        sellerName,
        customerName,
      };
    }
  }

  return { index: -1, sellerName: '', customerName: '' };
}

function countryCodeFromLine(line = '') {
  const letters = line.toUpperCase().replace(/[^A-Z]/g, '');
  if (/^[A-Z]{2}$/.test(letters)) return letters;
  if (/^[A-Z]{4}$/.test(letters) && letters.slice(0, 2) === letters.slice(2, 4)) {
    return letters.slice(0, 2);
  }
  return '';
}

function parseCustomerBlock(lines, header) {
  if (header.index < 0) {
    return { address: '', country: '' };
  }

  const addressLines = [];
  let country = '';

  for (let i = header.index + 1; i < Math.min(lines.length, header.index + 8); i += 1) {
    const line = normalizeSpaces(lines[i]);
    if (!line) continue;

    if (/Fecha\s+(?:Vencimiento|Emisi[oó]n)|CIF\/NIF|\bNIF\b|\bCIF\b|Tax ID|DESCRIPCI[ÓO]N|FACTURA/i.test(line)) {
      break;
    }

    const code = countryCodeFromLine(line);
    if (code) {
      country = code;
      continue;
    }

    addressLines.push(line);
  }

  if (!country) {
    const joined = addressLines.join(' ');
    const knownCountries = [
      ['Costa Rica', 'CR'],
      ['España', 'ES'],
      ['Spain', 'ES'],
      ['Portugal', 'PT'],
      ['Francia', 'FR'],
      ['France', 'FR'],
      ['Italia', 'IT'],
      ['Italy', 'IT'],
      ['Alemania', 'DE'],
      ['Germany', 'DE'],
      ['Marruecos', 'MA'],
      ['Morocco', 'MA'],
      ['Saudi Arabia', 'SA'],
      ['Arabia Saudí', 'SA'],
    ];

    const found = knownCountries.find(([name]) => joined.toLowerCase().includes(name.toLowerCase()));
    if (found) country = found[1];
  }

  return {
    address: addressLines.join('\n'),
    country,
  };
}

function detectTaxIds(lines) {
  const values = [];
  lines.forEach((line) => {
    const matches = [...line.matchAll(/(?:CIF\/NIF|NIF|CIF|Tax ID)\s*:?\s*([A-Z0-9-]{6,20})/gi)];
    matches.forEach((match) => values.push(match[1]));
  });
  return [...new Set(values)];
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
  const header = splitPartyHeader(lines);
  const customerBlock = parseCustomerBlock(lines, header);
  const taxIds = detectTaxIds(lines);

  return {
    invoiceNumber: firstMatch(fullText, /\b((?:FAC|FV|INV)-[A-Z0-9-]+)\b/i),
    issueDate: firstMatch(fullText, /Fecha\s+Emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i),
    sellerName: header.sellerName,
    customerName: header.customerName,
    customerTaxId: taxIds[0] || '',
    customerCountry: customerBlock.country,
    customerAddress: customerBlock.address,
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

function populateForm(parsed) {
  fields.invoiceNumber.value = parsed.invoiceNumber;
  fields.issueDate.value = parsed.issueDate;
  fields.sellerName.value = parsed.sellerName;
  fields.customerName.value = parsed.customerName;
  fields.customerTaxId.value = parsed.customerTaxId;
  fields.customerCountry.value = parsed.customerCountry;
  fields.customerAddress.value = parsed.customerAddress;
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
  setParseStatus('Preparando lectura del PDF…', 'idle', true);

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const lines = await extractPdf(file, (message) => setParseStatus(message, 'idle', true));
    rawText.textContent = lines.join('\n');
    const parsed = parseInvoice(lines);
    populateForm(parsed);
    setParseStatus('Lectura completada. Revisa los campos detectados y corrige lo necesario.', 'ok');
  } catch (error) {
    console.error(error);
    setParseStatus(`No se ha podido leer el PDF: ${error?.message || 'error desconocido'}`, 'error');
  }
});

addLineButton.addEventListener('click', () => createItemRow());
clearButton.addEventListener('click', resetApp);
