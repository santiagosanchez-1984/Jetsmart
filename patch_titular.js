const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const MAIN_SHEET = 'Vuelos JetSMART';

// Reservas donde viajó un acompañante: código → titular combinado
const TITULARES = {
  'N8TZRZ': 'HECTOR SANTIAGO SANCHEZ / GONZALO ORLANDO SILVA',
  'Q5LT4S': 'HECTOR SANTIAGO SANCHEZ / GONZALO ORLANDO SILVA',
  'F4RV7S': 'HECTOR SANTIAGO SANCHEZ / GONZALO ORLANDO SILVA',
  'M7PQ3Z': 'HECTOR SANTIAGO SANCHEZ / GONZALO ORLANDO SILVA',
};

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1:U200`,
  });
  const rows = res.data.values || [];

  const requests = [];
  for (let i = 1; i < rows.length; i++) {
    const code = rows[i][0];
    if (TITULARES[code]) {
      // Col D = índice 3, fila i+1 (1-indexed)
      requests.push({
        range: `${MAIN_SHEET}!D${i + 1}`,
        values: [[TITULARES[code]]],
      });
      console.log(`✓ ${code} → Titular actualizado: ${TITULARES[code]}`);
    }
  }

  if (requests.length === 0) {
    console.log('No se encontraron filas para actualizar.');
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: requests },
  });

  console.log('✅ Titular(es) actualizados.');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
