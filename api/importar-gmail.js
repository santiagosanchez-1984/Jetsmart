const cors = require('../lib/cors');
const { isAuthenticated } = require('../lib/auth');
const { getSheetsClient, SHEET_ID, getSheetGid } = require('../lib/sheets');
const { buscarEmailsItinerario } = require('../lib/gmail');
const { parsearConfirmacion, construirFila, dmyAiso } = require('../lib/jetsmart');

const SHEET_VUELOS = 'Vuelos JetSMART';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sheets = getSheetsClient();

    const codigosResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A2:A500`,
    });
    const cargados = {};
    (codigosResp.data.values || []).forEach(r => { if (r[0]) cargados[r[0].trim()] = true; });

    const bodies = await buscarEmailsItinerario();
    const nuevas = [];
    bodies.forEach(body => {
      const parsed = parsearConfirmacion(body);
      if (!parsed || cargados[parsed.codigo]) return;
      cargados[parsed.codigo] = true;
      nuevas.push(construirFila(parsed));
    });

    nuevas.sort((a, b) => {
      const da = dmyAiso(a[6]) || '';
      const db = dmyAiso(b[6]) || '';
      return db > da ? 1 : db < da ? -1 : 0;
    });

    if (nuevas.length > 0) {
      const gid = await getSheetGid(sheets, SHEET_ID, SHEET_VUELOS);
      for (const fila of nuevas) {
        await insertarOrdenado(sheets, gid, fila);
      }
    }

    res.json({ added: nuevas.length });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

async function insertarOrdenado(sheets, gid, fila) {
  const fechaNueva = dmyAiso(fila[6]);

  if (!fechaNueva) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A:R`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [fila] },
    });
    return;
  }

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_VUELOS}!G2:G500`,
  });
  const fechas = resp.data.values || [];
  let pos = -1;
  for (let i = 0; i < fechas.length; i++) {
    const f = dmyAiso(fechas[i][0]);
    if (f && f < fechaNueva) { pos = i + 2; break; }
  }

  if (pos === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A:R`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [fila] },
    });
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: pos - 1, endIndex: pos },
          inheritFromBefore: false,
        },
      }],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_VUELOS}!A${pos}:R${pos}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [fila] },
  });
}
