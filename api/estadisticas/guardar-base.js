const cors = require('../../lib/cors');
const checkAuth = require('../../lib/basicAuth');
const { getSheetsClient, SHEET_ID, ensureSheetExists } = require('../../lib/sheets');
const { ahoraStr } = require('../../lib/jetsmart');

const SHEET_HIST = 'VuelosHistorial';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const vuelos = (req.body && req.body.vuelos) || [];
    if (!Array.isArray(vuelos) || vuelos.length === 0) {
      return res.json({ ok: false, msg: 'Sin datos' });
    }

    const sheets = getSheetsClient();
    await ensureSheetExists(sheets, SHEET_ID, SHEET_HIST);

    const ahora     = ahoraStr();
    const cabecera  = ['Fecha', 'NroVuelo', 'Origen', 'Destino', 'HoraSalida', 'HoraLlegada', 'Actualizado'];
    const rows      = vuelos.map(v => [v.fecha, v.vuelo, v.origen, v.destino, v.salida, v.llegada || '', ahora]);

    await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${SHEET_HIST}!A:G` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_HIST}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [cabecera, ...rows] },
    });

    res.json({ ok: true, total: rows.length, timestamp: ahora });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
