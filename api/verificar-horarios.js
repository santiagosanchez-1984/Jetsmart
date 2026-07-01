const cors = require('../lib/cors');
const { isAuthenticated } = require('../lib/auth');
const { getSheetsClient, SHEET_ID } = require('../lib/sheets');
const { dmyAiso, isoDmy, ciudadAIata, padHora, diffMinutos, fetchDisponibilidad, getHoy } = require('../lib/jetsmart');

const SHEET_VUELOS = 'Vuelos JetSMART';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A1:R500`,
    });
    const data  = resp.data.values || [];
    const filas = data.slice(1).filter(r => r[0] && /^[A-Z0-9]{6}$/.test(r[0]));
    const hoy   = getHoy();

    const aChequear = [];
    filas.forEach(f => {
      if ((f[1] || '').trim() !== 'Pendiente') return;
      const fechaIda    = dmyAiso(f[6]);
      const fechaVuelta = dmyAiso(f[12]);
      if (fechaIda && fechaIda >= hoy && f[7]) {
        aChequear.push({ codigo: f[0], leg: 'IDA', vuelo: f[7], origen: ciudadAIata(f[8]),
                         fecha: fechaIda, horaGuardada: padHora(f[9]) });
      }
      if (fechaVuelta && fechaVuelta >= hoy && f[13]) {
        aChequear.push({ codigo: f[0], leg: 'VUELTA', vuelo: f[13], origen: ciudadAIata(f[14]),
                         fecha: fechaVuelta, horaGuardada: padHora(f[15]) });
      }
    });

    const cacheDisp = {};
    const cambios   = [];
    for (const item of aChequear) {
      if (!cacheDisp[item.origen]) cacheDisp[item.origen] = await fetchDisponibilidad(item.origen);
      const vuelos = cacheDisp[item.origen];
      const enc = vuelos.find(v => v.fn === item.vuelo && v.fecha === item.fecha);
      if (enc && enc.hora !== item.horaGuardada) {
        const diff = diffMinutos(item.horaGuardada, enc.hora);
        cambios.push({
          codigo: item.codigo, leg: item.leg, vuelo: item.vuelo, fecha: isoDmy(item.fecha),
          horaAntes: item.horaGuardada, horaAhora: enc.hora, diff,
          estado: (diff > 59 || diff <= -15) ? 'Abierto' : 'No abierto',
        });
      }
    }

    const data2update = [];
    cambios.filter(c => c.estado === 'Abierto').forEach(c => {
      const idx = filas.findIndex(f => f[0].trim() === c.codigo);
      if (idx >= 0) data2update.push({ range: `${SHEET_VUELOS}!B${idx + 2}`, values: [['Abierto']] });
    });
    if (data2update.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: data2update },
      });
    }

    res.json(cambios);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
