const pdfInput = document.getElementById('pdfInput');
const fileStatus = document.getElementById('fileStatus');
const invoicePanel = document.getElementById('invoicePanel');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const clearButton = document.getElementById('clearButton');

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resetApp() {
  pdfInput.value = '';
  fileName.value = '';
  fileSize.value = '';
  invoicePanel.classList.add('hidden');
  fileStatus.className = 'status status-idle';
  fileStatus.textContent = 'Ningún archivo seleccionado.';
}

pdfInput.addEventListener('change', () => {
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

  fileName.value = file.name;
  fileSize.value = formatFileSize(file.size);
  invoicePanel.classList.remove('hidden');
  fileStatus.className = 'status status-ok';
  fileStatus.textContent = 'PDF cargado correctamente. El archivo permanece en este navegador.';
});

clearButton.addEventListener('click', resetApp);
