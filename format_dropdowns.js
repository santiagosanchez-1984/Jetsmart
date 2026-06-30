const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const MAIN_SHEET = 'Vuelos JetSMART';
const LIST_SHEET = 'Lista';

const AEROPUERTOS = {
  'AEP': 'Buenos Aires (AEP)',
  'EZE': 'Buenos Aires (EZE)',
  'RES': 'Resistencia',
  'COR': 'Córdoba',
  'NQN': 'Neuquén',
  'BRC': 'Bariloche',
  'USH': 'Ushuaia',
  'MDZ': 'Mendoza',
  'FLN': 'Florianópolis',
  'GIG': 'Rio de Janeiro',
  'ASU': 'Asunción',
  'SCL': 'Santiago de Chile',
  'IGR': 'Puerto Iguazú',
  'FTE': 'El Calafate',
  'TUC': 'Tucumán',
};

const MESES_MAP = {
  'enero': 'Enero', 'febrero': 'Febrero', 'marzo': 'Marzo',
  'abril': 'Abril', 'mayo': 'Mayo', 'junio': 'Junio',
  'julio': 'Julio', 'agosto': 'Agosto', 'septiembre': 'Septiembre',
  'octubre': 'Octubre', 'noviembre': 'Noviembre', 'diciembre': 'Diciembre',
};

const MESES_LIST = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

const AERO_LIST = Object.values(AEROPUERTOS);

// Columnas con origen/destino (0-indexed): I=8, K=10, O=14, Q=16
const AERO_COLS = [8, 10, 14, 16];

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const mainId = meta.data.sheets.find(s => s.properties.title === MAIN_SHEET).properties.sheetId;
  const listId = meta.data.sheets.find(s => s.properties.title === LIST_SHEET).properties.sheetId;

  // ── 1. Poblar Lista!D (aeropuertos) y Lista!E (meses) ────────────────────
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${LIST_SHEET}!D1:D${1 + AERO_LIST.length}`,
          values: [['AEROPUERTO'], ...AERO_LIST.map(a => [a])],
        },
        {
          range: `${LIST_SHEET}!E1:E13`,
          values: [['MES'], ...MESES_LIST.map(m => [m])],
        },
      ],
    },
  });
  console.log('✓ Lista!D (aeropuertos) y Lista!E (meses) pobladas');

  // ── 2. Leer hoja principal y normalizar datos ─────────────────────────────
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1:U200`,
  });
  const allRows = res.data.values || [];
  const header = allRows[0];
  const dataRows = allRows.slice(1).filter(r => r[0] && /^[A-Z0-9]{6}$/.test(r[0]));

  let mesFixed = 0, aeroFixed = 0;
  for (const row of dataRows) {
    // Mes (col 5): normalizar a mayúscula inicial
    if (row[5]) {
      const norm = MESES_MAP[row[5].toLowerCase()];
      if (norm && norm !== row[5]) { row[5] = norm; mesFixed++; }
    }
    // Origen/Destino (cols 8, 10, 14, 16): sigla → nombre
    for (const idx of AERO_COLS) {
      const val = (row[idx] || '').trim();
      if (val && AEROPUERTOS[val]) { row[idx] = AEROPUERTOS[val]; aeroFixed++; }
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1:U${1 + dataRows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...dataRows] },
  });
  console.log(`✓ Datos normalizados: ${mesFixed} meses, ${aeroFixed} siglas → nombres`);

  // ── 3. Aplicar validaciones de datos ─────────────────────────────────────
  const requests = [
    // F (col 5) = Mes
    {
      setDataValidation: {
        range: { sheetId: mainId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 5, endColumnIndex: 6 },
        rule: {
          condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=${LIST_SHEET}!$E$2:$E$13` }] },
          showCustomUi: true,
          strict: true,
        },
      },
    },
    // I (8), K (10), O (14), Q (16) = Aeropuerto
    ...AERO_COLS.map(col => ({
      setDataValidation: {
        range: { sheetId: mainId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: col, endColumnIndex: col + 1 },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [{ userEnteredValue: `=${LIST_SHEET}!$D$2:$D${1 + AERO_LIST.length}` }],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    })),
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  console.log('✓ Dropdowns aplicados: F=Mes, I/K/O/Q=Aeropuerto');
  console.log('✅ Listo');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
