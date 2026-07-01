const cors = require('../lib/cors');
const { getSheetsClient, SHEET_ID } = require('../lib/sheets');

const SHEET_VUELOS = 'Vuelos JetSMART';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A2:R500`,
    });

    const data = resp.data.values || [];
    const result = [];
    for (const r of data) {
      if (!r[0] || !/^[A-Z0-9]{6}$/.test(r[0].trim())) continue;
      result.push({
        codigo:        (r[0] || '').trim(),
        estado:        (r[1] || '').trim(),
        reprog:        (r[2] || '').trim(),
        titular:       (r[3] || '').trim(),
        anio:          (r[4] || '').trim(),
        mes:           (r[5] || '').trim(),
        fechaIda:      (r[6] || '').trim(),
        vueloIda:      (r[7] || '').trim(),
        origenIda:     (r[8] || '').trim(),
        salidaIda:     (r[9] || '').trim(),
        destinoIda:    (r[10] || '').trim(),
        llegadaIda:    (r[11] || '').trim(),
        fechaVuelta:   (r[12] || '').trim(),
        vueloVuelta:   (r[13] || '').trim(),
        origenVuelta:  (r[14] || '').trim(),
        salidaVuelta:  (r[15] || '').trim(),
        destinoVuelta: (r[16] || '').trim(),
        llegadaVuelta: (r[17] || '').trim(),
      });
    }
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
