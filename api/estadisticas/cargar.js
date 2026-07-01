const cors = require('../../lib/cors');
const { getSheetsClient, SHEET_ID } = require('../../lib/sheets');
const { calcularEstadisticasHist, cargarUltimosCambios } = require('../../lib/jetsmart');

const SHEET_HIST    = 'VuelosHistorial';
const SHEET_CAMBIOS = 'CambiosHorarios';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sheets = getSheetsClient();

    const histRows = await safeGet(sheets, `${SHEET_HIST}!A2:G`);
    const vuelos = [];
    let baseTimestamp = '';
    histRows.filter(r => r[0]).forEach(r => {
      vuelos.push({ fecha: r[0], vuelo: r[1], origen: r[2], destino: r[3], salida: r[4], llegada: r[5] });
      baseTimestamp = r[6] || baseTimestamp;
    });

    const filasCambios = await safeGet(sheets, `${SHEET_CAMBIOS}!A2:I`);

    res.json({
      vuelos,
      estadisticas: calcularEstadisticasHist(filasCambios),
      ultimosCambios: cargarUltimosCambios(filasCambios, 100),
      baseTimestamp,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function safeGet(sheets, range) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
    return resp.data.values || [];
  } catch (e) {
    return [];
  }
}
