const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';

// Nuevos vuelos — formato SIN columna ESTADO (se preserva si ya existe)
// [Código, ¿Reprogramado?, Titular, Año, Mes, FechaIda, FlightNumIda, OriginIda,
//  SalidaIda, DestinoIda, LlegadaIda, FechaVuelta, FlightNumVuelta, OriginVuelta,
//  SalidaVuelta, DestinoVuelta, LlegadaVuelta, TramosAdicionales, N°reprog, FechaEmisión]
const NEW_ROWS = [
  [
    'YY34GJ', 'No', 'HECTOR SANTIAGO SANCHEZ', '2026', 'Junio',
    '18/06/2026', 'JA3063', 'RES', '23:53', 'AEP', '01:24',
    '23/06/2026', 'JA3062', 'AEP', '21:06', 'RES', '22:41',
    '', '0', '2026-05-23',
  ],
];

function dateToNum(str) {
  if (!str) return 0;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  return parseInt(m[3]) * 10000 + parseInt(m[2]) * 100 + parseInt(m[1]);
}

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetName = meta.data.sheets[0].properties.title;

  // Leer toda la hoja incluyendo columna ESTADO (A-U = 21 columnas)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:U200`,
  });
  const allRows = res.data.values || [];
  const header = allRows[0];

  // Estructura actual: A=Código | B=ESTADO | C=Titular | D=Año | E=Mes | F=FechaIda | ...
  let dataRows = allRows.slice(1).filter(r => r[0] && /^[A-Z0-9]{6}$/.test(r[0]));

  for (const newRow of NEW_ROWS) {
    const code = newRow[0];
    const existing = dataRows.find(r => r[0] === code);
    const estado = existing ? (existing[1] || '') : '';
    // Insertar en formato de hoja: [Código, ESTADO, Titular, Año, Mes, FechaIda, ...]
    const sheetRow = [newRow[0], estado, ...newRow.slice(1)];
    dataRows = dataRows.filter(r => r[0] !== code);
    dataRows.push(sheetRow);
    console.log(existing ? `→ ${code} reemplazado` : `✓ ${code} agregado`);
  }

  // Ordenar por FechaIda (índice 6 = col G) descendente
  dataRows.sort((a, b) => dateToNum(b[6]) - dateToNum(a[6]));

  const writeRange = `${sheetName}!A1:U${1 + dataRows.length}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: writeRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...dataRows] },
  });

  console.log(`✅ ${dataRows.length} vuelos ordenados por Fecha Ida descendente.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
