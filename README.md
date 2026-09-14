# custom_documents_pro

Web tool to convert AGQ invoice PDFs into editable customs/proforma documents.

## Objetivo

Crear una aplicación web sencilla que permita:

1. Cargar una factura PDF generada por SAGE.
2. Extraer automáticamente los datos comerciales relevantes.
3. Revisar y completar los campos específicamente aduaneros.
4. Generar un documento DOCX editable para proforma/commercial invoice.

## Principio de funcionamiento

El proyecto no pretende hacer una conversión visual genérica de PDF a Word.

El flujo previsto es:

`PDF factura -> extracción estructurada -> formulario editable -> DOCX aduanero`

## Privacidad

- Las facturas reales no deben almacenarse en este repositorio.
- Los PDF se procesarán localmente en el navegador siempre que sea posible.
- Los ejemplos incluidos en el repositorio deberán estar anonimizados o contener datos ficticios.
- No se almacenarán datos comerciales de clientes en GitHub.

## Estado actual

### V0.1

- Interfaz inicial de carga de PDF.
- Validación básica del tipo de archivo.
- Procesamiento local: el archivo seleccionado no se envía a ningún servidor.
- Estructura inicial HTML/CSS/JavaScript.

## Roadmap

### V0.2 - Lectura de PDF

- Integrar PDF.js.
- Extraer texto y posiciones de las páginas.
- Mostrar el texto detectado para validar la lectura.

### V0.3 - Parser de factura 

Extraer automáticamente, cuando estén disponibles:

- Número de factura.
- Empresa emisora.
- CIF/NIF.
- Fecha de emisión.
- Destinatario.
- Identificador fiscal del destinatario.
- Dirección y país.
- Líneas de artículos.
- Cantidades.
- Precios unitarios.
- Importes.
- Total factura.

### V0.4 - Preparación aduanera

Añadir campos editables para:

- Tipo de documento.
- Número de documento aduanero.
- HS Code.
- Descripción aduanera ampliada.
- País de origen.
- Incoterm y lugar.
- Freight charges.
- Insurance.
- Motivo del envío.
- Declaraciones aduaneras.

### V0.5 - Generación DOCX

- Utilizar una plantilla DOCX controlada.
- Generar tablas dinámicas por número de artículos.
- Mantener el documento final completamente editable.

### Futuro

- Biblioteca reutilizable de artículos aduaneros.
- Sugerencias de HS Code previamente validadas.
- Descripciones estándar por artículo/familia.
- Histórico local de configuraciones.

## Estructura

```text
custom_documents_pro/
├─ index.html
├─ css/
│  └─ styles.css
├─ js/
│  └─ app.js
├─ templates/
├─ data/
└─ README.md
```

## Seguridad documental

Los campos aduaneros sensibles a interpretación, como HS Code u origen de la mercancía, no deben asumirse automáticamente. La aplicación podrá proponer datos conocidos o previamente validados, pero el usuario deberá poder revisarlos antes de generar el documento final.
