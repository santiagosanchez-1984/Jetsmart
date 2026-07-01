const cors = require('../../lib/cors');
const { isAuthenticated } = require('../../lib/auth');
const { getSheetsClient, SHEET_ID, ensureSheetExists } = require('../../lib/sheets');
const {
  obtenerVuelosRutaCompleta, diffMinutos, ahoraStr,
  calcularEstadisticasHist, cargarUltimosCambios,
} = require('../../lib/jetsmart');

const SHEET_HIST    = 'VuelosHistorial';
const SHEET_CAMBIOS = 'CambiosHorarios';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sheets = getSheetsClient();

    const datosBase = await safeGet(sheets, `${SHEET_HIST}!A2:F`);
    if (datosBase.length === 0) {
      return res.json({ error: 'No hay base. Actualizá la base primero con el botón "Actualizar base".' });
    }

    const mapaBase = {};
    datosBase.forEach(row => {
      if (row[0] && row[1]) mapaBase[row[0] + '|' + row[1]] = { salida: row[4], llegada: row[5] };
    });

    const vuelosActuales = await obtenerVuelosRutaCompleta();
    const ahora   = ahoraStr();
    const cambios = [];

    vuelosActuales.forEach(v => {
      const key  = v.fecha + '|' + v.vuelo;
      const base = mapaBase[key];
      if (!base) return;
      const cambioSalida  = base.salida  && v.salida  && base.salida  !== v.salida;
      const cambioLlegada = base.llegada && v.llegada && base.llegada !== v.llegada;
      if (!cambioSalida && !cambioLlegada) return;
      const diffMin = cambioSalida ? diffMinutos(base.salida, v.salida) : 0;
      cambios.push({
        fecha: v.fecha, vuelo: v.vuelo,
        salidaAnt: base.salida, salidaNueva: v.salida,
        llegadaAnt: base.llegada, llegadaNueva: v.llegada,
        diffMin, tipo: diffMin > 0 ? 'Retraso' : (diffMin < 0 ? 'Adelanto' : 'Cambio llegada'),
      });
    });

    if (cambios.length > 0) {
      await ensureSheetExists(sheets, SHEET_ID, SHEET_CAMBIOS);

      const hayHeader = (await safeGet(sheets, `${SHEET_CAMBIOS}!A1:A1`)).length > 0;
      if (!hayHeader) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_CAMBIOS}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [['FechaRegistro', 'FechaVuelo', 'NroVuelo', 'SalidaAnterior', 'SalidaNueva',
                       'LlegadaAnterior', 'LlegadaNueva', 'MinutosCambio', 'Tipo']],
          },
        });
      }

      const filasNuevas = cambios.map(c =>
        [ahora, c.fecha, c.vuelo, c.salidaAnt, c.salidaNueva, c.llegadaAnt, c.llegadaNueva, c.diffMin, c.tipo]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_CAMBIOS}!A:I`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: filasNuevas },
      });

      const mapaNuevo = {};
      vuelosActuales.forEach(v => { mapaNuevo[v.fecha + '|' + v.vuelo] = v; });
      const updRows = datosBase.map(row => {
        if (!row[0]) return row;
        const v = mapaNuevo[row[0] + '|' + row[1]];
        return v ? [row[0], row[1], row[2], row[3], v.salida, v.llegada || '', ahora] : row.concat([ahora]);
      });
      const hdr = (await safeGet(sheets, `${SHEET_HIST}!A1:G1`))[0] ||
        ['Fecha', 'NroVuelo', 'Origen', 'Destino', 'HoraSalida', 'HoraLlegada', 'Actualizado'];

      await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${SHEET_HIST}!A:G` });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_HIST}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [hdr, ...updRows] },
      });
    }

    const filasCambiosFinal = await safeGet(sheets, `${SHEET_CAMBIOS}!A2:I`);

    res.json({
      cambios,
      estadisticas: calcularEstadisticasHist(filasCambiosFinal),
      ultimosCambios: cargarUltimosCambios(filasCambiosFinal, 100),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
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
