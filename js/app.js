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

const sellerPatterns = [
  /AGQ TECHNOLOGICAL CORPORATE,?\s*S\.?L\.?/i,
  /AGQ LABS INTERNATIONAL,?\s*S\.?L\.?/i,
  /AGQ TECHNOLOGICAL SERVICES,?\s*S\.?L\.?/i,
];

const sellerTaxIds = {
  'AGQ TECHNOLOGICAL CORPORATE, S.L.': 'B91447318',
  'AGQ LABS INTERNATIONAL, S.L.': 'B90436494',
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

function normalizeSellerName(value = '') {
  const text = normalizeSpaces(value).replace(/\s+,/g, ',');
  if (/AGQ TECHNOLOGICAL CORPORATE/i.test(text)) return 'AGQ TECHNOLOGICAL CORPORATE, S.L.';
  if (/AGQ LABS INTERNATIONAL/i.test(text)) return 'AGQ LABS INTERNATIONAL, S.L.';
  if (/AGQ TECHNOLOGICAL SERVICES/i.test(text)) return 'AGQ TECHNOLOGICAL SERVICES, S.L.';
  return text;
}

function buildRows(items, tolerance = 2.5) {
  const rows = [];

  items.forEach((item) => {
    const text = normalizeSpaces(item.str);
    if (!text) return;

    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width || 0;
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance);

    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }

    row.items.push({ x, y, width, text });
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      return {
        ...row,
        text: normalizeSpaces(row.items.map((item) => item.text).join(' ')),
      };
    })
    .filter((row) => row.text);
}

async function extractPdf(file, onProgress) {
  onProgress?.('Abriendo PDF…');
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const pages = [];
  const allLines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Leyendo página ${pageNumber} de ${pdf.numPages}…`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const rows = buildRows(textContent.items);

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      rows,
      items: textContent.items
        .map((item) => ({
          text: normalizeSpaces(item.str),
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0,
        }))
        .filter((item) => item.text),
    });

    allLines.push(...rows.map((row) => row.text));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  onProgress?.('Interpretando campos de la factura…');
  return { lines: allLines, pages };
}

function firstMatch(text, regex, fallback = '') {
  const match = text.match(regex);
  return match ? normalizeSpaces(match[1] ?? match[0]) : fallback;
}

function splitPartyHeader(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const pattern of sellerPatterns) {
      const match = line.match(pattern);
      if (!match) continue;

      const sellerName = normalizeSellerName(match[0]);
      const customerName = normalizeSpaces(line.slice((match.index || 0) + match[0].length));
      return { index, sellerName, customerName };
    }
  }

  return { index: -1, sellerName: '', customerName: '' };
}

function extractTaxId(text = '') {
  const match = text.match(/(?:CIF\/NIF|NIF|CIF|Tax ID)\s*:?\s*([A-Z0-9-]{6,20})/i);
  return match ? match[1].toUpperCase() : '';
}

function countryCodeFromText(text = '') {
  const upper = normalizeSpaces(text).toUpperCase();
  const explicit = upper.match(/(?:^|\s)([A-Z]{2})(?:\s*[-–]\s*\1)?(?:$|\s)/);
  if (explicit) return explicit[1];

  const known = [
    ['COSTA RICA', 'CR'], ['ESPAÑA', 'ES'], ['SPAIN', 'ES'], ['PORTUGAL', 'PT'],
    ['FRANCIA', 'FR'], ['FRANCE', 'FR'], ['ITALIA', 'IT'], ['ITALY', 'IT'],
    ['ALEMANIA', 'DE'], ['GERMANY', 'DE'], ['MARRUECOS', 'MA'], ['MOROCCO', 'MA'],
    ['SAUDI ARABIA', 'SA'], ['ARABIA SAUDÍ', 'SA'],
  ];
  const found = known.find(([name]) => upper.includes(name));
  return found ? found[1] : '';
}

function cleanCustomerRow(text = '') {
  return normalizeSpaces(text)
    .replace(/(?:CR\s*[-–]\s*CR|\bCR\b)$/i, '')
    .trim();
}

function parseSpatialHeader(firstPage, fallbackHeader) {
  if (!firstPage?.rows?.length || !firstPage.width) return null;

  const splitX = firstPage.width * 0.5;
  const leftRows = [];
  const rightRows = [];

  firstPage.rows.forEach((row) => {
    const left = row.items.filter((item) => item.x < splitX);
    const right = row.items.filter((item) => item.x >= splitX);

    if (left.length) leftRows.push({ y: row.y, text: normalizeSpaces(left.map((item) => item.text).join(' ')) });
    if (right.length) rightRows.push({ y: row.y, text: normalizeSpaces(right.map((item) => item.text).join(' ')) });
  });

  let sellerName = fallbackHeader.sellerName;
  const sellerRow = leftRows.find((row) => sellerPatterns.some((pattern) => pattern.test(row.text)));
  if (sellerRow) sellerName = normalizeSellerName(sellerRow.text);

  let customerName = '';
  if (sellerRow) {
    const sameBand = rightRows
      .filter((row) => Math.abs(row.y - sellerRow.y) <= 5)
      .map((row) => row.text)
      .join(' ');
    if (sameBand && !/Fecha|CIF|NIF|Tel|FACTURA/i.test(sameBand)) customerName = sameBand;
  }
  customerName ||= fallbackHeader.customerName;

  const sellerTaxId = sellerTaxIds[sellerName] || '';
  const rightTaxIds = rightRows.map((row) => extractTaxId(row.text)).filter(Boolean);
  const leftTaxIds = leftRows.map((row) => extractTaxId(row.text)).filter(Boolean);
  const allTaxIds = [...new Set([...rightTaxIds, ...leftTaxIds])];
  const customerTaxId = rightTaxIds.find((id) => id !== sellerTaxId)
    || allTaxIds.find((id) => id !== sellerTaxId)
    || '';

  const customerNameRow = rightRows.find((row) => customerName && row.text.includes(customerName));
  const nameY = customerNameRow?.y ?? sellerRow?.y ?? null;
  let address = '';
  let country = '';

  if (nameY !== null) {
    const candidateRows = rightRows
      .filter((row) => row.y < nameY - 1)
      .sort((a, b) => b.y - a.y);

    const addressLines = [];
    for (const row of candidateRows) {
      if (/DESCRIPCI[ÓO]N|CANTIDAD|PRECIO|IMPORTE/i.test(row.text)) break;
      if (/Fecha\s+(?:Vencimiento|Emisi[oó]n)|CIF\/NIF|\bNIF\b|\bCIF\b|Tax ID/i.test(row.text)) continue;
      if (/Pago por cheque|Cuentas de pago|BANCO:|IBAN:|SWIFT:|Contacto para/i.test(row.text)) break;

      const detectedCountry = countryCodeFromText(row.text);
      if (detectedCountry && !country) country = detectedCountry;

      const cleaned = cleanCustomerRow(row.text);
      if (!cleaned) continue;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) continue;
      if (/^\d+[.,]\d{2}/.test(cleaned)) continue;
      if (/FACTURA|Total|Base|IVA|Subtotal/i.test(cleaned)) continue;

      addressLines.push(cleaned);
      if (addressLines.length >= 3) break;
    }
    address = addressLines.join('\n');
  }

  return { sellerName, customerName, customerTaxId, country, address };
}

function detectTaxIds(lines) {
  const values = [];
  lines.forEach((line) => {
    const matches = [...line.matchAll(/(?:CIF\/NIF|NIF|CIF|Tax ID)\s*:?\s*([A-Z0-9-]{6,20})/gi)];
    matches.forEach((match) => values.push(match[1].toUpperCase()));
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

function parseInvoice(extracted) {
  const { lines, pages } = extracted;
  const fullText = lines.join('\n');
  const fallbackHeader = splitPartyHeader(lines);
  const spatial = parseSpatialHeader(pages[0], fallbackHeader);
  const taxIds = detectTaxIds(lines);
  const sellerName = spatial?.sellerName || fallbackHeader.sellerName;
  const sellerTaxId = sellerTaxIds[sellerName] || '';

  return {
    invoiceNumber: firstMatch(fullText, /\b((?:FAC|FV|INV)-[A-Z0-9-]+)\b/i),
    issueDate: firstMatch(fullText, /Fecha\s+Emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i),
    sellerName,
    customerName: spatial?.customerName || fallbackHeader.customerName,
    customerTaxId: spatial?.customerTaxId || taxIds.find((id) => id !== sellerTaxId) || '',
    customerCountry: spatial?.country || '',
    customerAddress: spatial?.address || '',
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
  if (parsed.items.length) parsed.items.forEach(createItemRow);
  else createItemRow();

  invoiceForm.classList.remove('hidden');
  debugPanel.classList.remove('hidden');
}

function buildDebugText(extracted) {
  const lines = extracted.lines.join('\n');
  const page = extracted.pages[0];
  if (!page) return lines;

  const splitX = page.width * 0.5;
  const spatial = page.rows.map((row) => {
    const left = normalizeSpaces(row.items.filter((item) => item.x < splitX).map((item) => item.text).join(' '));
    const right = normalizeSpaces(row.items.filter((item) => item.x >= splitX).map((item) => item.text).join(' '));
    return `[y=${row.y.toFixed(1)}] IZQ: ${left || '—'} | DER: ${right || '—'}`;
  }).join('\n');

  return `${lines}\n\n--- Diagnóstico espacial página 1 ---\n${spatial}`;
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
    const extracted = await extractPdf(file, (message) => setParseStatus(message, 'idle', true));
    rawText.textContent = buildDebugText(extracted);
    const parsed = parseInvoice(extracted);
    populateForm(parsed);
    setParseStatus('Lectura completada. Revisa los campos detectados y corrige lo necesario.', 'ok');
  } catch (error) {
    console.error(error);
    setParseStatus(`No se ha podido leer el PDF: ${error?.message || 'error desconocido'}`, 'error');
  }
});

addLineButton.addEventListener('click', () => createItemRow());
clearButton.addEventListener('click', resetApp);
