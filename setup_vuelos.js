const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const MAIN_SHEET    = 'Vuelos JetSMART';
const LIST_SHEET    = 'Lista';

const ESTADOS = ['Tomado', 'Pendiente', 'Abierto'];
const MESES   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function dateToNum(str) {
  const m = str && str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  return parseInt(m[3]) * 10000 + parseInt(m[2]) * 100 + parseInt(m[1]);
}

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── IDs de hojas ──────────────────────────────────────────────────────────
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetMap = {};
  meta.data.sheets.forEach(s => { sheetMap[s.properties.title] = s.properties.sheetId; });
  const mainSheetId = sheetMap[MAIN_SHEET];

  // ── 1. Crear hoja "Lista" ─────────────────────────────────────────────────
  const listRequests = [];
  if (sheetMap[LIST_SHEET]) {
    listRequests.push({ deleteSheet: { sheetId: sheetMap[LIST_SHEET] } });
  }
  listRequests.push({ addSheet: { properties: { title: LIST_SHEET, gridProperties: { rowCount: 50, columnCount: 5 } } } });

  const createRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: listRequests },
  });
  const listSheetId = createRes.data.replies[listRequests.length - 1].addSheet.properties.sheetId;
  console.log(`✓ Hoja "Lista" creada (id=${listSheetId})`);

  // ── 2. Poblar hoja Lista ──────────────────────────────────────────────────
  const listRows = [
    ['ESTADO', 'MES'],
    ...Array.from({ length: Math.max(ESTADOS.length, MESES.length) }, (_, i) => [
      ESTADOS[i] || '', MESES[i] || '',
    ]),
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${LIST_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: listRows },
  });
  console.log('✓ Lista poblada');

  // ── 3. Leer datos actuales ────────────────────────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1:T200`,
  });
  const allRows = res.data.values || [];
  const oldHeader = allRows[0];

  // Solo filas con código de reserva (6 chars alfanuméricos)
  const dataRows = allRows.slice(1).filter(r => r[0] && /^[A-Z0-9]{6}$/.test(r[0]));

  // ── 4. Construir nuevo header y filas ─────────────────────────────────────
  // Estructura nueva: Código | ESTADO | Titular | Año | Mes | FechaIda | ...
  const newHeader = [oldHeader[0], 'ESTADO', ...oldHeader.slice(1)];

  const newDataRows = dataRows.map(row => {
    const mesRaw = row[3] || '';
    const mes = mesRaw.replace(/^\d{2}-/, ''); // "06-Junio" → "Junio"
    return [
      row[0],         // Código Reserva
      '',             // ESTADO (el usuario completa con dropdown)
      row[1],         // Titular
      row[2],         // Año
      mes,            // Mes limpio
      ...row.slice(4),// Fecha Ida en adelante (16 columnas)
    ];
  });

  // Ordenar por Fecha Ida descendente
  newDataRows.sort((a, b) => dateToNum(b[5]) - dateToNum(a[5]));

  // ── 5. Limpiar rango y escribir ───────────────────────────────────────────
  const totalDataRows = newDataRows.length;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1:U${totalDataRows + 2}`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newHeader, ...newDataRows] },
  });
  console.log(`✓ ${totalDataRows} filas escritas con nueva estructura`);

  // ── 6. Data validation — dropdown ESTADO desde Lista!A2:A4 ───────────────
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        setDataValidation: {
          range: {
            sheetId: mainSheetId,
            startRowIndex: 1,
            endRowIndex: totalDataRows + 1,
            startColumnIndex: 1, // col B = ESTADO
            endColumnIndex: 2,
          },
          rule: {
            condition: {
              type: 'ONE_OF_RANGE',
              values: [{ userEnteredValue: `=Lista!$A$2:$A$4` }],
            },
            showCustomUi: true,
            strict: true,
          },
        },
      }],
    },
  });
  console.log('✅ Setup completo: columna ESTADO con dropdown, mes sin prefijo, hoja Lista creada.');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
