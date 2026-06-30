const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const MAIN_SHEET = 'Vuelos JetSMART';
const LIST_SHEET = 'Lista';

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  // Obtener IDs de hojas y reglas de formato existentes
  const full = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title),conditionalFormats)',
  });
  const mainData = full.data.sheets.find(s => s.properties.title === MAIN_SHEET);
  const mainId   = mainData.properties.sheetId;
  const existing = mainData.conditionalFormats || [];

  // ── 1. Agregar Sí/No a Lista columna C ───────────────────────────────────
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${LIST_SHEET}!C1:C3`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['REPROGRAMADO'], ['Sí'], ['No']] },
  });
  console.log('✓ Lista!C1:C3 poblada con Sí/No');

  // ── 2. Data validation en col S (¿Reprogramado?) filas 2-200 ─────────────
  const listId = full.data.sheets.find(s => s.properties.title === LIST_SHEET).properties.sheetId;

  const requests = [
    {
      setDataValidation: {
        range: { sheetId: mainId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 2, endColumnIndex: 3 },
        rule: {
          condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=${LIST_SHEET}!$C$2:$C$3` }] },
          showCustomUi: true,
          strict: true,
        },
      },
    },

    // ── 3. Eliminar formato condicional existente en col S (si hay) ─────────
    ...existing
      .map((cf, i) => ({ cf, i }))
      .filter(({ cf }) =>
        cf.ranges && cf.ranges.some(r => r.startColumnIndex === 2)
      )
      .reverse()
      .map(({ i }) => ({ deleteConditionalFormatRule: { sheetId: mainId, index: i } })),

    // ── 4. Formato condicional col S ─────────────────────────────────────────
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: mainId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 2, endColumnIndex: 3 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Sí' }] },
            format: {
              backgroundColor: { red: 0.102, green: 0.137, blue: 0.494 }, // azul marino
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            },
          },
        },
        index: 0,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: mainId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 2, endColumnIndex: 3 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'No' }] },
            format: {
              backgroundColor: { red: 1.0, green: 0.800, blue: 0.800 }, // rojo claro
              textFormat: { foregroundColor: { red: 0.600, green: 0.063, blue: 0.063 }, bold: true },
            },
          },
        },
        index: 0,
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  console.log('✅ ¿Reprogramado?: dropdown Sí/No + Sí=azul marino, No=rojo claro');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
