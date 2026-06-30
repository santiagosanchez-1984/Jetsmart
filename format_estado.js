const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const MAIN_SHEET = 'Vuelos JetSMART';

const REGLAS = [
  { valor: 'Abierto',   bg: { red: 0.290, green: 0.525, blue: 0.910 } }, // azul
  { valor: 'Pendiente', bg: { red: 0.902, green: 0.569, blue: 0.220 } }, // naranja
  { valor: 'Tomado',    bg: { red: 0.416, green: 0.659, blue: 0.310 } }, // verde
];

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  // Obtener sheetId y reglas existentes
  const full = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title),conditionalFormats)',
  });
  const sheetData = full.data.sheets.find(s => s.properties.title === MAIN_SHEET);
  const sheetId = sheetData.properties.sheetId;
  const existing = sheetData.conditionalFormats || [];

  const requests = [];

  // Eliminar reglas existentes (de mayor a menor índice para no desplazar)
  for (let i = existing.length - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  // Agregar reglas nuevas para col B (ESTADO), filas 2 en adelante
  for (const regla of REGLAS) {
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: 1,
            endRowIndex: 200,
            startColumnIndex: 1,
            endColumnIndex: 2,
          }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: regla.valor }] },
            format: {
              backgroundColor: regla.bg,
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            },
          },
        },
        index: 0,
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  console.log(`✅ Formato condicional aplicado: Abierto=azul, Pendiente=naranja, Tomado=verde`);
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
